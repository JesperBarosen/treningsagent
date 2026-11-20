"""HTTP API for the training agent. Run: uv run uvicorn api:app --reload

In production it runs as a Vercel Python function (entrypoint set in
pyproject.toml, limits in vercel.json); see docs/deploy.md.
"""

import json
import uuid
from datetime import date, timedelta
from typing import Literal
from collections.abc import Iterator
from functools import cache

import anthropic
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import auth
import chat
import db
import env
import forms
import gyms
import limits
import pauses
import plans
import tools
import training_profile

env.load()  # ANTHROPIC_API_KEY, DATABASE_URL, SUPABASE_URL and the limits (limits.py) from the root .env

app = FastAPI(title="treningsagent")


@app.exception_handler(limits.LimitHit)
def limit_hit(_request: Request, e: limits.LimitHit) -> JSONResponse:
    """A usage limit (#129, #130): its JSON as is, e.g. 429 {"limit": "hourly",
    "retry_after_minutes": 12}. The app keeps the words in frontend/lib/limits.ts."""
    return JSONResponse(status_code=e.status, content=e.body)

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
    # Plans propose_program made this turn (#119). Never stored, even with
    # auto_save (Q5): the app shows a card, and Accept POSTs `accept` to /plans.
    proposals: list[dict] = []
    # Profile changes propose_profile_update made this turn (#137): never stored
    # until the user's Save sends `changes` to PATCH /profile.
    profile_updates: list[dict] = []


@cache
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()  # one client (and connection pool) for the process


def get_store(user: dict = Depends(auth.get_user)) -> Iterator[db.PostgresStore]:
    """A store for the signed-in user: RLS limits every query to their rows.
    Closed beta (#130): only invited emails get one, so an unlisted user can't
    use any endpoint (403 {"limit": "closed_beta"})."""
    conn = db.connect()
    try:
        store = db.PostgresStore(conn, user["id"])
        limits.check_invite(store, user.get("email"))
        yield store
    finally:
        conn.close()


@app.post("/chat")
def post_chat(
    req: ChatRequest,
    client: anthropic.Anthropic = Depends(get_client),
    store: db.PostgresStore = Depends(get_store),
) -> ChatResponse:
    # Global budget, then the user's own limits, before Claude is called (limits.py).
    limits.check_chat(store)
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
                        drafts=tool_results(messages[turn_start:], "draft_session"),
                        proposals=tool_results(messages[turn_start:], "propose_program"),
                        profile_updates=tool_results(messages[turn_start:], "propose_profile_update"))


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
    # A colour of the climb's gym (gym_id, else the last gym used), or with
    # grade_system "v" or "font" a V or Font grade (#98).
    grade: str
    style: str
    sent: bool
    attempts: int | None = None
    notes: str | None = None
    grade_system: Literal["gym", "v", "font"] | None = None
    gym_id: int | None = None


class SessionChanges(BaseModel, extra="forbid"):
    sport: str | None = None
    date: str | None = None
    duration_min: int | None = None
    effort: int | None = None
    notes: str | None = None
    distance_km: float | None = None
    elevation_m: int | None = None
    # Context tags (N6); [] clears them. Checked against tools.TAGS.
    tags: list[str] | None = None
    climbs: list[ClimbIn] | None = None
    # A session template (#100) and its fields by key; template_id null on an
    # edit goes back to the built-in form. Checked by forms.validate_values.
    template_id: int | None = None
    values: dict | None = None


class SessionIn(SessionChanges):
    sport: str
    date: str
    duration_min: int
    effort: int
    # "Log this" on a planned session (#132): saving links the two (#117).
    planned_id: int | None = None


def _fields(body: SessionChanges) -> dict:
    """The fields the client sent. A null `notes` clears it; other nulls are
    treated as not sent, so a running field can't be set on a climb by null."""
    fields = body.model_dump(exclude_unset=True, exclude={"climbs", "planned_id"})
    fields = {k: v for k, v in fields.items() if v is not None or k in ("notes", "template_id")}
    if body.climbs is not None:
        fields["climbs"] = [c.model_dump(exclude_none=True) for c in body.climbs]
    return fields


@app.post("/sessions", status_code=201)
def post_session(body: SessionIn, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Log a session from the form, with log_session's validation, and link it
    to a planned session (#117): the one it was logged from (`planned_id`), or
    a single same-day match automatically. `plan_link` says which, for the
    app's Undo, or lists the candidates for it to ask about."""
    try:
        if body.planned_id is not None:  # checked before anything is stored
            plans.check_linkable(store, body.planned_id, body.sport)
        session = tools.log_session(store, **_fields(body))
    except LookupError:
        raise HTTPException(404, "Planned session not found.") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return {**session, "plan_link": plans.link_after_logging(store, session, body.planned_id)}


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


# --- Gyms (#98) --------------------------------------------------------------------

class GymColourIn(BaseModel, extra="forbid"):
    id: int | None = None
    name: str
    # A palette name ("blue") or its hex value.
    colour: str
    # [lowest, highest] in the gym's range_system, e.g. ["V1", "V3"]; null = unknown.
    range: list[str] | None = None
    range_text: str | None = None  # as GET returns it; ignored
    archived: bool = False


class GymIn(BaseModel, extra="forbid"):
    name: str
    range_system: Literal["v", "font"] = "v"
    colours: list[GymColourIn]


class GymChange(BaseModel, extra="forbid"):
    name: str | None = None
    range_system: Literal["v", "font"] | None = None
    archived: bool | None = None
    # The whole new list, easiest first; colours left out are deleted (only if unused).
    colours: list[GymColourIn] | None = None


@app.get("/gyms")
def get_gyms(store: db.PostgresStore = Depends(get_store)) -> dict:
    """The user's gyms with their colours, and the gym used last."""
    return gyms.list_gyms(store)


@app.post("/gyms", status_code=201)
def post_gym(body: GymIn, store: db.PostgresStore = Depends(get_store)) -> dict:
    try:
        return gyms.create_gym(store, body.name, body.range_system,
                               [c.model_dump(exclude_none=True) for c in body.colours])
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.patch("/gyms/{gym_id}")
def patch_gym(gym_id: int, body: GymChange, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Rename, archive or restore a gym, or replace its colours."""
    changes = body.model_dump(include=body.model_fields_set, exclude_none=True)
    if body.colours is not None:
        changes["colours"] = [c.model_dump(exclude_none=True) for c in body.colours]
    if not changes:
        raise HTTPException(422, "Nothing to change.")
    try:
        return gyms.update_gym(store, gym_id, changes)
    except LookupError:
        raise HTTPException(404, "Gym not found.") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.delete("/gyms/{gym_id}", status_code=204)
def delete_gym(gym_id: int, store: db.PostgresStore = Depends(get_store)) -> None:
    """Delete a gym nothing uses; a used gym can only be archived (409)."""
    try:
        gyms.delete_gym(store, gym_id)
    except LookupError:
        raise HTTPException(404, "Gym not found.") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from None


# --- Session templates (#100) -------------------------------------------------------

class TemplateIn(BaseModel, extra="forbid"):
    name: str
    sport: Literal["running", "climbing", "strength", "other"]
    # The field schema (docs/custom-log-forms.md 3.2); forms.validate_template checks it.
    fields: list[dict] = []
    core_fields: list[str] = []


class TemplateChange(BaseModel, extra="forbid"):
    name: str | None = None
    sport: Literal["running", "climbing", "strength", "other"] | None = None
    fields: list[dict] | None = None
    core_fields: list[str] | None = None
    position: int | None = None
    archived: bool | None = None


class StartersIn(BaseModel, extra="forbid"):
    names: list[str] = Field(min_length=1)


@app.get("/templates")
def get_templates(store: db.PostgresStore = Depends(get_store)) -> dict:
    """The user's templates, live ones first, and the starters they can add."""
    return {"templates": tools.list_templates(store),
            "starters": [{"name": n, "sport": s["sport"]} for n, s in forms.STARTERS.items()]}


@app.post("/templates", status_code=201)
def post_template(body: TemplateIn, store: db.PostgresStore = Depends(get_store)) -> dict:
    try:
        return tools.create_template(store, body.name, body.sport, body.fields, body.core_fields)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.post("/templates/starters", status_code=201)
def post_starters(body: StartersIn, store: db.PostgresStore = Depends(get_store)) -> list[dict]:
    """Add starter templates (Fingerboard, Strength, Intervals, Mobility) on first use."""
    try:
        return tools.add_starters(store, body.names)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.patch("/templates/{template_id}")
def patch_template(template_id: int, body: TemplateChange,
                   store: db.PostgresStore = Depends(get_store)) -> dict:
    changes = body.model_dump(include=body.model_fields_set, exclude_none=True)
    if not changes:
        raise HTTPException(422, "Nothing to change.")
    try:
        return tools.update_template(store, template_id, changes)
    except LookupError:
        raise HTTPException(404, "Template not found.") from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.delete("/templates/{template_id}", status_code=204)
def delete_template(template_id: int, store: db.PostgresStore = Depends(get_store)) -> None:
    """Delete a template no session uses; a used one can only be archived (409)."""
    try:
        tools.delete_template(store, template_id)
    except LookupError:
        raise HTTPException(404, "Template not found.") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from None


@app.get("/training-load")
def get_training_load(weeks: int = Query(8, ge=1, le=12),
                      sport: Literal["running", "climbing", "strength", "other"] | None = None,
                      by_sport: bool = False,
                      store: db.PostgresStore = Depends(get_store)) -> dict:
    """get_training_load: weekly and daily load by sport and the acute:chronic
    ratio; with `sport` (the Dashboard filter, #46), that sport's only. With
    `by_sport`, the all-sports result also carries each sport's own under
    "by_sport", so the Dashboard switches filters without another request."""
    result = tools.get_training_load(store, weeks, sport=sport)
    if by_sport and sport is None:
        result["by_sport"] = {s: tools.get_training_load(store, weeks, sport=s) for s in tools.SPORTS}
    return result


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


@app.patch("/pause")
def patch_pause(body: PauseStart, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Edit the pause that is on (#82): reason, injury details, note and planned
    end. The start date stays. 404 if no pause is on."""
    active = store.active_pause()
    if active is None:
        raise HTTPException(404, "No pause is on.")
    try:
        changes = pauses.validate_edit(active, **body.model_dump())
        updated = store.update_pause(changes)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except RuntimeError as e:  # the migration isn't applied yet
        raise HTTPException(503, str(e)) from None
    if updated is None:  # ended between the read and the update
        raise HTTPException(404, "No pause is on.")
    return updated


@app.post("/pause/end")
def post_pause_end(body: PauseEnd, store: db.PostgresStore = Depends(get_store)) -> dict:
    """End the pause that is on, today. 404 if there is none."""
    ended = store.end_pause(date.today().isoformat(), body.resume_choice)
    if ended is None:
        raise HTTPException(404, "No pause is on.")
    return ended


# --- Goals (N2) --------------------------------------------------------------------

class GoalIn(BaseModel):
    kind: Literal["climb_grade", "run_pace"]
    grade: str | None = None
    # A gym colour (gym_id, else the last gym used) or a V or Font grade (#98).
    grade_system: Literal["gym", "v", "font"] | None = None
    gym_id: int | None = None
    climb_mode: Literal["send", "flash"] | None = None
    band: str | None = None
    target_pace: float | None = None
    target_date: str | None = None


class GoalChange(BaseModel):
    # Send target_date: null to remove the date ("keep it, without a date").
    target_date: str | None = None
    # A goal can be paused, resumed or let go; "achieved" is set by progress only.
    status: Literal["active", "paused", "dropped"] | None = None


@app.get("/profile")
def get_profile(store: db.PostgresStore = Depends(get_store)) -> dict:
    """The training profile (#137), every field present; onboarding null until
    the first-login step was shown."""
    return training_profile.read(store)


@app.patch("/profile")
def patch_profile(body: dict, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Change the given fields of the profile (the You tab, the first-login step,
    or a coach's change the user saved). Creates the profile on first save."""
    try:
        changes = training_profile.validate_changes(body)
        if not changes:
            raise ValueError("nothing to change")
        return {**training_profile.EMPTY, **store.save_profile(changes)}
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.get("/goals")
def get_goals(store: db.PostgresStore = Depends(get_store)) -> list[dict]:
    """Every goal with its progress, from the user's own sessions."""
    return tools.list_goals(store)


@app.post("/goals", status_code=201)
def post_goal(body: GoalIn, store: db.PostgresStore = Depends(get_store)) -> dict:
    try:
        return tools.set_goal(store, **body.model_dump())
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@app.patch("/goals/{goal_id}")
def patch_goal(goal_id: int, body: GoalChange, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Move or remove the date, pause, resume or let go of a goal."""
    changes = body.model_dump(include=body.model_fields_set)
    if not changes:
        raise HTTPException(422, "Nothing to change.")
    if changes.get("target_date"):
        try:
            if date.fromisoformat(changes["target_date"]) < date.today():
                raise HTTPException(422, "The date can't be in the past.")
        except ValueError:
            raise HTTPException(422, "target_date must be YYYY-MM-DD.") from None
    if changes.get("status") is None:
        changes.pop("status", None)
    try:
        goal = store.update_goal(goal_id, changes)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    if goal is None:
        raise HTTPException(404, "Goal not found.")
    return goal


@app.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, store: db.PostgresStore = Depends(get_store)) -> None:
    if not store.delete_goal(goal_id):
        raise HTTPException(404, "Goal not found.")


# --- Training plans (#116, docs/training-plans.md) -------------------------------------
# Plans are stored only from an accepted proposal or the user's own edits; the
# coach never writes here (#119 proposes through the approval flow). plans.py
# validates everything; these routes map its errors: ValueError 422,
# LookupError 404, RuntimeError (another plan is active) 409.

def _plans_call(fn, *args, missing: str = "Plan not found."):
    try:
        return fn(*args)
    except LookupError:
        raise HTTPException(404, missing) from None
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


class PlannedIn(BaseModel):
    date: str
    sport: str
    title: str
    template_id: int | None = None
    target: dict = {}


class PlanIn(BaseModel):
    name: str
    start_date: str
    # Left out: from the goal's date when it is 4-12 weeks away (Q4).
    weeks: int | None = None
    goal_id: int | None = None
    week_meta: list[dict] = []
    rationale: str | None = None
    source: Literal["coach", "user"] = "user"
    sessions: list[PlannedIn] = []


class PlanChange(BaseModel):
    name: str | None = None
    rationale: str | None = None
    week_meta: list[dict] | None = None
    status: Literal["active", "paused", "finished"] | None = None


class PlannedAdd(PlannedIn):
    # Left out: a one-off planned session with no plan (#38, Q3).
    plan_id: int | None = None


class PlannedChange(BaseModel):
    sport: str | None = None
    template_id: int | None = None
    title: str | None = None
    target: dict | None = None


class PlannedMove(BaseModel):
    date: str


class PlannedSkip(BaseModel):
    reason: str | None = None


@app.get("/plans")
def get_plans(store: db.PostgresStore = Depends(get_store)) -> dict:
    """The current plan (active or paused) with its sessions and planned load
    per week, and every plan without sessions (newest first)."""
    current = plans.current_plan(store)
    return {"current": plans.get_plan(store, current["id"]) if current else None,
            "plans": store.plans()}


@app.post("/plans", status_code=201)
def post_plan(body: PlanIn, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Store a plan the user accepted (Q5: never without their tap)."""
    data = body.model_dump(exclude_none=True)
    data["sessions"] = [s.model_dump(exclude_none=True) for s in body.sessions]
    return _plans_call(plans.create_plan, store, data)


@app.get("/plans/{plan_id}")
def get_plan(plan_id: int, store: db.PostgresStore = Depends(get_store)) -> dict:
    return _plans_call(plans.get_plan, store, plan_id)


@app.patch("/plans/{plan_id}")
def patch_plan(plan_id: int, body: PlanChange, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Rename, change week kinds or the rationale, pause, resume or finish a plan."""
    return _plans_call(plans.update_plan, store, plan_id, body.model_dump(exclude_unset=True))


@app.post("/plans/{plan_id}/leave")
def post_leave_plan(plan_id: int, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Leave a plan. Nothing is deleted; its sessions stay as a record (P23)."""
    return _plans_call(plans.leave_plan, store, plan_id)


@app.get("/planned-sessions")
def get_planned_sessions(since: str = Query(alias="from"), until: str = Query(alias="to"),
                         store: db.PostgresStore = Depends(get_store)) -> list[dict]:
    """Planned sessions between two dates, from the plan and one-offs alike."""
    return _plans_call(plans.list_planned, store, since, until)


@app.post("/planned-sessions", status_code=201)
def post_planned(body: PlannedAdd, store: db.PostgresStore = Depends(get_store)) -> dict:
    return _plans_call(plans.add_planned, store, body.model_dump(exclude_none=True))


@app.patch("/planned-sessions/{planned_id}")
def patch_planned(planned_id: int, body: PlannedChange, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Change a planned session's sport, template, title or target."""
    return _plans_call(plans.edit_planned, store, planned_id, body.model_dump(exclude_unset=True),
                       missing="Planned session not found.")


@app.post("/planned-sessions/{planned_id}/move")
def post_move_planned(planned_id: int, body: PlannedMove,
                      store: db.PostgresStore = Depends(get_store)) -> dict:
    return _plans_call(plans.move_planned, store, planned_id, body.date,
                       missing="Planned session not found.")


@app.post("/planned-sessions/{planned_id}/skip")
def post_skip_planned(planned_id: int, body: PlannedSkip,
                      store: db.PostgresStore = Depends(get_store)) -> dict:
    return _plans_call(plans.skip_planned, store, planned_id, body.reason,
                       missing="Planned session not found.")


@app.delete("/planned-sessions/{planned_id}/skip")
def delete_skip_planned(planned_id: int, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Undo a skip."""
    return _plans_call(lambda s, i: plans.skip_planned(s, i, skip=False), store, planned_id,
                       missing="Planned session not found.")


class PlannedLink(BaseModel):
    session_id: int


@app.post("/planned-sessions/{planned_id}/link")
def post_link_planned(planned_id: int, body: PlannedLink,
                      store: db.PostgresStore = Depends(get_store)) -> dict:
    """Count a logged session as this planned one: the answer to "Was this
    Thursday's Easy run?", or a link changed from the session sheet (#117)."""
    return _plans_call(plans.link_planned, store, planned_id, body.session_id,
                       missing="Planned session or session not found.")


@app.delete("/planned-sessions/{planned_id}/link")
def delete_link_planned(planned_id: int, store: db.PostgresStore = Depends(get_store)) -> dict:
    """Undo a link: the planned session is open again, the logged one stays."""
    return _plans_call(plans.unlink_planned, store, planned_id, missing="Planned session not found.")


@app.delete("/planned-sessions/{planned_id}", status_code=204)
def delete_planned(planned_id: int, store: db.PostgresStore = Depends(get_store)) -> None:
    _plans_call(plans.remove_planned, store, planned_id, missing="Planned session not found.")
