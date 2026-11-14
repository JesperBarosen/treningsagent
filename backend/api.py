"""HTTP API for the training agent. Run: uv run uvicorn api:app --reload

In production it runs as a Vercel Python function (entrypoint set in
pyproject.toml, limits in vercel.json); see docs/deploy.md.
"""

import json
import os
import uuid
from datetime import date, timedelta
from typing import Literal
from collections.abc import Iterator
from functools import cache

import anthropic
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import auth
import chat
import db
import env
import pauses
import tools

env.load()  # ANTHROPIC_API_KEY, DATABASE_URL, SUPABASE_URL, CHAT_DAILY_LIMIT from the root .env

# /chat requests per user in any 24 hours, to cap what one account can spend.
CHAT_DAILY_LIMIT = int(os.environ.get("CHAT_DAILY_LIMIT", "50"))

app = FastAPI(title="treningsagent")

# Only these origins may call the API from a browser: the frontend's URL(s)
# from ALLOWED_ORIGINS, or the Next.js dev server when it is unset.
app.add_middleware(
    CORSMiddleware,
    allow_origins=env.allowed_origins(),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["content-type", "authorization"],
)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    # The `history` returned by the previous /chat call, unchanged. The server
    # keeps no conversation state. Thinking blocks from earlier turns are
    # stripped before each call (chat.run_turn), so they are optional here.
    history: list[dict] = []
    # Returned by the first /chat call; send it back to group cost per conversation.
    conversation_id: uuid.UUID | None = None
    # The user's "Save chat sessions without asking" setting. Off (the default):
    # the agent drafts sessions for the user to save (N4); on: it stores them.
    auto_save: bool = False


class ChatResponse(BaseModel):
    reply: str
    history: list[dict]
    conversation_id: uuid.UUID
    # Sessions stored by log_session during this turn, as the tool returned them,
    # so a client can show what was logged without parsing `history`.
    logged_sessions: list[dict] = []
    # Sessions draft_session prepared this turn, for the user to save or review.
    # Not stored: they have no id.
    drafts: list[dict] = []


@cache
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()  # one client (and connection pool) for the process


def get_store(user_id: str = Depends(auth.get_user_id)) -> Iterator[db.PostgresStore]:
    """A store for the signed-in user: RLS limits every query to their rows."""
    conn = db.connect()
    try:
        yield db.PostgresStore(conn, user_id)
    finally:
        conn.close()


@app.post("/chat")
def post_chat(
    req: ChatRequest,
    client: anthropic.Anthropic = Depends(get_client),
    store: db.PostgresStore = Depends(get_store),
) -> ChatResponse:
    if not store.claim_chat_request(CHAT_DAILY_LIMIT):
        raise HTTPException(429, f"You've reached the limit of {CHAT_DAILY_LIMIT} messages "
                                 "in 24 hours. Try again later.")
    conversation_id = req.conversation_id or uuid.uuid4()
    messages = [*req.history, {"role": "user", "content": req.message}]
    turn_start = len(req.history)
    try:
        reply = chat.run_turn(client, store, messages, str(conversation_id),
                              auto_save=req.auto_save)
    except anthropic.APIError as e:
        raise HTTPException(502, f"Claude API error: {e.message}") from e
    return ChatResponse(reply=reply, history=messages, conversation_id=conversation_id,
                        logged_sessions=logged_sessions(messages[turn_start:]),
                        drafts=tool_results(messages[turn_start:], "draft_session"))


def logged_sessions(turn: list[dict]) -> list[dict]:
    """The sessions log_session stored in these messages."""
    return tool_results(turn, "log_session")


def tool_results(turn: list[dict], name: str) -> list[dict]:
    """The JSON results of the `name` calls that succeeded in these messages,
    in call order."""
    calls = {block["id"] for m in turn if m["role"] == "assistant"
             for block in _blocks(m) if block.get("type") == "tool_use"
             and block.get("name") == name}
    return [json.loads(block["content"]) for m in turn if m["role"] == "user"
            for block in _blocks(m) if block.get("type") == "tool_result"
            and block.get("tool_use_id") in calls and not block.get("is_error")]


def _blocks(message: dict) -> list[dict]:
    content = message["content"]
    return content if isinstance(content, list) else []


# Read-only views for the frontend. Each reuses the agent's own tool function,
# so the app and the agent always show the same numbers, and runs through the
# same store, so Row Level Security limits it to the user's own rows.

@app.get("/health")
def get_health() -> dict:
    """Liveness check that touches neither the database nor Claude."""
    return {"status": "ok"}


@app.get("/sessions")
def get_sessions(days: int = Query(56, ge=1, le=366),
                 store: db.PostgresStore = Depends(get_store)) -> list[dict]:
    """Sessions from the last `days` days, oldest first, as get_history returns them."""
    return tools.get_history(store, days)


# Writes from the Log form. The models only check JSON types; the rules live in
# tools.validate_session, shared with the agent's log_session.

class ClimbIn(BaseModel, extra="forbid"):
    grade: str
    style: str
    sent: bool
    attempts: int | None = None
    notes: str | None = None


class SessionChanges(BaseModel, extra="forbid"):
    sport: str | None = None
    date: str | None = None
    duration_min: int | None = None
    effort: int | None = None
    notes: str | None = None
    distance_km: float | None = None
    elevation_m: int | None = None
    climbs: list[ClimbIn] | None = None


class SessionIn(SessionChanges):
    sport: str
    date: str
    duration_min: int
    effort: int


def _fields(body: SessionChanges) -> dict:
    """The fields the client sent. A null `notes` clears it; other nulls are
    treated as not sent, so a running field can't be set on a climb by null."""
    fields = body.model_dump(exclude_unset=True, exclude={"climbs"})
    fields = {k: v for k, v in fields.items() if v is not None or k == "notes"}
    if body.climbs is not None:
        fields["climbs"] = [c.model_dump(exclude_none=True) for c in body.climbs]
    return fields


@app.post("/sessions", status_code=201)
def post_session(body: SessionIn, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Log a session from the form, with log_session's validation."""
    try:
        return tools.log_session(store, **_fields(body))
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.patch("/sessions/{session_id}")
def patch_session(session_id: int, body: SessionChanges,
                  store: db.PostgresStore = Depends(get_store)) -> dict:
    """Change some fields of a session; `climbs` replaces all its climbs."""
    try:
        return tools.update_session(store, session_id, _fields(body))
    except LookupError:
        raise HTTPException(404, "Session not found.") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, store: db.PostgresStore = Depends(get_store)) -> None:
    try:
        tools.delete_session(store, session_id)
    except LookupError:
        raise HTTPException(404, "Session not found.") from None


@app.get("/training-load")
def get_training_load(weeks: int = Query(8, ge=1, le=12),
                      store: db.PostgresStore = Depends(get_store)) -> dict:
    """get_training_load: weekly and daily load by sport and the acute:chronic ratio."""
    return tools.get_training_load(store, weeks)


@app.get("/progression")
def get_progression(weeks: int = Query(8, ge=1, le=26),
                    store: db.PostgresStore = Depends(get_store)) -> dict:
    """calculate_progression: weekly running and climbing numbers with trends."""
    return tools.calculate_progression(store, weeks)


# --- Pauses (N5) -------------------------------------------------------------------

class PauseStart(BaseModel):
    reason: Literal["injury", "illness", "travel", "other"]
    body_part: str | None = None
    pain: int | None = None
    note: str | None = None
    planned_end: str | None = None


class PauseEnd(BaseModel):
    # "continue": keep the history as the baseline; "fresh": leave the old
    # baseline out of trends for four weeks.
    resume_choice: Literal["continue", "fresh"]


@app.get("/pause")
def get_pause(store: db.PostgresStore = Depends(get_store)) -> dict:
    """The pause that is on, if any, and the last one that ended in the past
    four weeks (the Dashboard explains a fresh start with it)."""
    recent_since = (date.today() - timedelta(days=pauses.FRESH_DAYS)).isoformat()
    rows = store.pauses_since(recent_since)
    ended = [p for p in rows if p.get("ended_on")]
    return {"active": next((p for p in rows if not p.get("ended_on")), None),
            "recent": ended[-1] if ended else None}


@app.post("/pause", status_code=201)
def post_pause(body: PauseStart, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Start a pause today. 409 if one is already on."""
    try:
        row = pauses.validate_pause(**body.model_dump())
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    try:
        return store.start_pause(row)
    except ValueError as e:
        raise HTTPException(409, str(e)) from None


@app.post("/pause/end")
def post_pause_end(body: PauseEnd, store: db.PostgresStore = Depends(get_store)) -> dict:
    """End the pause that is on, today. 404 if there is none."""
    ended = store.end_pause(date.today().isoformat(), body.resume_choice)
    if ended is None:
        raise HTTPException(404, "No pause is on.")
    return ended
