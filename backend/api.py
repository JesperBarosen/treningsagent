"""HTTP API for the training agent. Run: uv run uvicorn api:app --reload

In production it runs as a Vercel Python function (entrypoint set in
pyproject.toml, limits in vercel.json); see docs/deploy.md.
"""

import json
import os
import uuid
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
    # keeps no conversation state; it must include Claude's thinking blocks as-is.
    history: list[dict] = []
    # Returned by the first /chat call; send it back to group cost per conversation.
    conversation_id: uuid.UUID | None = None


class ChatResponse(BaseModel):
    reply: str
    history: list[dict]
    conversation_id: uuid.UUID
    # Sessions stored by log_session during this turn, as the tool returned them,
    # so a client can show what was logged without parsing `history`.
    logged_sessions: list[dict] = []


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
        reply = chat.run_turn(client, store, messages, str(conversation_id))
    except anthropic.APIError as e:
        raise HTTPException(502, f"Claude API error: {e.message}") from e
    return ChatResponse(reply=reply, history=messages, conversation_id=conversation_id,
                        logged_sessions=logged_sessions(messages[turn_start:]))


def logged_sessions(turn: list[dict]) -> list[dict]:
    """The sessions log_session stored in these messages: the JSON results of
    log_session calls that succeeded, in call order."""
    log_calls = {block["id"] for m in turn if m["role"] == "assistant"
                 for block in _blocks(m) if block.get("type") == "tool_use"
                 and block.get("name") == "log_session"}
    return [json.loads(block["content"]) for m in turn if m["role"] == "user"
            for block in _blocks(m) if block.get("type") == "tool_result"
            and block.get("tool_use_id") in log_calls and not block.get("is_error")]


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
