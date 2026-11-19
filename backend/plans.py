"""Training plans and planned sessions (#116, docs/training-plans.md).

A plan runs 4 to 12 weeks from a Monday and may serve one goal. Its planned
sessions have a day, a sport, an optional template, a title and a target; a
planned session without a plan is a one-off suggestion (#38, Q3). Every
target is optional: "an easy 30-minute run" is a valid target.

This module validates plans and targets and computes planned load
(duration x effort, the same session-RPE the app uses for done load). The
API stores only what the user accepted; the coach's tools (#119) will use the
same validation without storing anything.

Status: only the user's own choices are stored ("planned", "skipped"). Done,
not done and paused are derived when read, in #117.
"""

import json
from datetime import date, timedelta

import forms
import grades

SPORTS = forms.SPORTS
WEEK_KINDS = ("build", "deload", "taper", "test")
PLAN_STATUSES = ("active", "paused", "finished", "left")
CURRENT = ("active", "paused")  # at most one such plan per user (Q3)
SOURCES = ("coach", "user")
MIN_WEEKS, MAX_WEEKS = 4, 12
PER_DAY = 2                     # planned sessions on one day
MAX_SESSIONS = 7 * MAX_WEEKS * PER_DAY
MAX_TARGET_BYTES = 8192
MAX_GRADE_TARGETS = 10
# Kinds of run (#135): most volume easy, a long run, and a few quality sessions.
RUN_TYPES = ("easy", "long", "intervals", "tempo", "recovery")
QUALITY = ("intervals", "tempo")
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

# Load rules (docs/training-plans.md section 5, principles P25-P33 in
# docs/design-research.md section 1.7). Sourced values are cautious defaults:
# none is shown to prevent injury. propose_program refuses a proposal that
# breaks a sourced rule; rules marked "needs source" have no value and are
# never applied or claimed.
_SOURCED = {
    "max_run_vs_longest_30d": {
        "value": 1.10, "rule": "L1a", "source": "P31 (Frandsen 2025)",
        "text": "no planned run more than 10% longer than the longest run in the 30 days before it"},
    "max_weekly_run_increase": {
        "value": 0.10, "rule": "L1b", "source": "P29 (Damsted 2019), P30 (Fredette 2022)",
        "text": "weekly running distance at most 10% above the last full (not lighter) week, "
                "a cautious default: the 10% rule itself isn't evidence-based"},
    "deload_every": {
        "value": 4, "rule": "L2", "source": "P27 (Bell 2023)",
        "text": "every 4th week is a lighter week, with less planned load than the week before"},
}
_UNSOURCED = ("max_weekly_increase", "deload_factor", "taper_weeks", "taper_factor",
              "max_hard_days_in_a_row", "finger_rest_days", "return_start_factor",
              "replan_threshold",
              # L8 intensity distribution (#135): no paper in research/ gives these numbers.
              "easy_share_min", "quality_sessions_per_week_max", "taper_quality_free_days")
RULES: dict[str, dict] = {
    **{k: {**v, "status": "sourced"} for k, v in _SOURCED.items()},
    **{k: {"value": None, "status": "needs source"} for k in _UNSOURCED},
}
ROUNDING_KM = 0.05  # tolerance for distances rounded to 0.1 km


# --- Small checks -----------------------------------------------------------------

def _date(value, what: str) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValueError(f"{what} must be YYYY-MM-DD, got {value!r}") from None


def _text(value, what: str, longest: int, *, optional: bool = False) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        if optional:
            return None
        raise ValueError(f"{what} is required")
    if not isinstance(value, str):
        raise ValueError(f"{what} must be text")
    text = value.strip()
    if len(text) > longest:
        raise ValueError(f"{what} can be at most {longest} characters")
    return text


def _int(value, what: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != int(value):
        raise ValueError(f"{what} must be a whole number")
    if not low <= value <= high:
        raise ValueError(f"{what} must be between {low} and {high}")
    return int(value)


def monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def plan_end(plan: dict) -> date:
    """The plan's last day (a Sunday)."""
    return _date(plan["start_date"], "start_date") + timedelta(days=7 * int(plan["weeks"]) - 1)


def week_index(plan: dict, day) -> int | None:
    """1-based week of `day` in the plan, or None outside it."""
    start = _date(plan["start_date"], "start_date")
    day = _date(day, "date")
    if not start <= day <= plan_end(plan):
        return None
    return (day - start).days // 7 + 1


# --- Targets ----------------------------------------------------------------------

def _grade_target(item, gym_list: list[dict]) -> dict:
    """{"system": "gym", "grade": "red", "count": 3, "gym_id": 2}, checked
    against the gym's live colours (the default gym without gym_id) or V/Font."""
    if not isinstance(item, dict):
        raise ValueError("each grade target must be an object")
    unknown = set(item) - {"system", "grade", "count", "gym_id"}
    if unknown:
        raise ValueError(f"unknown grade target fields: {sorted(unknown)}")
    system = item.get("system") or "gym"
    if system not in grades.SYSTEMS:
        raise ValueError(f"grade system must be one of {grades.SYSTEMS}, got {system!r}")
    count = _int(item.get("count", 1), "grade count", 1, 50)
    if system != "gym":
        if item.get("gym_id") is not None:
            raise ValueError("a V or Font grade has no gym")
        return {"system": system, "grade": grades.normalise(system, str(item.get("grade") or "")),
                "count": count}
    gym_id = item.get("gym_id")
    if gym_id is None:
        gym = gym_list[0] if gym_list else grades.legacy_gym()
    else:
        gym = next((g for g in gym_list if g["id"] == gym_id), None)
        if gym is None:
            raise ValueError(f"gym {gym_id} not found")
    wanted = str(item.get("grade") or "").strip().lower()
    names = [g["name"] for g in grades.active_grades(gym)]
    if wanted not in names:
        raise ValueError(f"grade must be one of {tuple(names)} at {gym['name']}, got {item.get('grade')!r}")
    out = {"system": "gym", "grade": wanted, "count": count}
    if gym_id is not None:
        out["gym_id"] = gym_id
    return out


def _optional_fields(template: dict) -> dict:
    """The template with every field optional: a target may set any of them."""
    return {**template, "fields": [{**f, "required": False} for f in template["fields"]]}


def validate_target(sport: str, target, template: dict | None = None,
                    gym_list: list[dict] | None = None) -> dict:
    """A planned session's target, or ValueError. Keys, all optional:
    duration_min, effort (1-10); distance_km and session_type (running);
    workout (a concrete description, e.g. "6 x 800 m at 10 km pace, 90 s jog
    rest"); grades (climbing, a list of grade targets); values (template field
    values, as in a session)."""
    target = {} if target is None else target
    if not isinstance(target, dict):
        raise ValueError("target must be an object")
    allowed = {"duration_min", "effort", "workout"}
    allowed |= {"distance_km", "session_type"} if sport == "running" else set()
    allowed |= {"grades"} if sport == "climbing" else set()
    allowed |= {"values"} if template is not None else set()
    unknown = set(target) - allowed
    if unknown:
        raise ValueError(f"target fields not valid for this {sport} session: {sorted(unknown)}")
    out: dict = {}
    if target.get("duration_min") is not None:
        out["duration_min"] = _int(target["duration_min"], "target duration_min", 1, 600)
    if target.get("effort") is not None:
        out["effort"] = _int(target["effort"], "target effort", 1, 10)
    if target.get("distance_km") is not None:
        d = target["distance_km"]
        if isinstance(d, bool) or not isinstance(d, (int, float)) or not 0 < d <= 200:
            raise ValueError("target distance_km must be between 0 and 200")
        out["distance_km"] = round(float(d), 2)
    if target.get("session_type") is not None:
        if target["session_type"] not in RUN_TYPES:
            raise ValueError(f"session_type must be one of {RUN_TYPES}, got {target['session_type']!r}")
        out["session_type"] = target["session_type"]
    if target.get("workout") is not None:
        out["workout"] = _text(target["workout"], "workout", 160)
    if target.get("grades") is not None:
        items = target["grades"]
        if not isinstance(items, list) or len(items) > MAX_GRADE_TARGETS:
            raise ValueError(f"target grades must be a list of at most {MAX_GRADE_TARGETS}")
        if items:
            out["grades"] = [_grade_target(i, gym_list or []) for i in items]
    if target.get("values") is not None:
        values = forms.validate_values(_optional_fields(template), target["values"], sport)
        if values:
            out["values"] = values
    if len(json.dumps(out)) > MAX_TARGET_BYTES:
        raise ValueError("the target is too large")
    return out


def planned_load(target: dict) -> int | None:
    """Duration x effort when both are planned, the same measure as done load."""
    if target.get("duration_min") is None or target.get("effort") is None:
        return None
    return int(target["duration_min"]) * int(target["effort"])


# --- Planned sessions ---------------------------------------------------------------

def _template(template_id, templates: list[dict], sport: str, *, keep: int | None = None) -> dict | None:
    if template_id is None:
        return None
    t = next((t for t in templates if t["id"] == template_id), None)
    if t is None:
        raise ValueError(f"template {template_id} not found")
    if t.get("archived_at") and t["id"] != keep:  # an edit may keep an archived template
        raise ValueError(f"the {t['name']} template is archived")
    if t["sport"] != sport:
        raise ValueError(f"the {t['name']} template is for {t['sport']}, not {sport}")
    return t


def validate_planned(item: dict, templates: list[dict], gym_list: list[dict] | None = None,
                     plan: dict | None = None, keep_template: int | None = None) -> dict:
    """One planned session's row (without plan_id and slot), or ValueError.
    With `plan`, its date must fall inside the plan."""
    if not isinstance(item, dict):
        raise ValueError("each planned session must be an object")
    unknown = set(item) - {"date", "sport", "template_id", "title", "target"}
    if unknown:
        raise ValueError(f"unknown planned session fields: {sorted(unknown)}")
    day = _date(item.get("date"), "date")
    if plan is not None and week_index(plan, day) is None:
        raise ValueError(f"{day.isoformat()} is outside the plan "
                         f"({plan['start_date']} to {plan_end(plan).isoformat()})")
    sport = item.get("sport")
    if sport not in SPORTS:
        raise ValueError(f"sport must be one of {SPORTS}, got {sport!r}")
    template = _template(item.get("template_id"), templates, sport, keep=keep_template)
    return {"date": day.isoformat(), "sport": sport,
            "template_id": template["id"] if template else None,
            "title": _text(item.get("title"), "title", 60),
            "target": validate_target(sport, item.get("target"), template, gym_list)}


def slots(rows: list[dict], taken: list[dict] = ()) -> list[dict]:
    """Give each new row a free slot on its day, after the `taken` rows; at most
    PER_DAY planned sessions a day (skipped ones count: they're still there)."""
    used: dict[str, set[int]] = {}
    for r in taken:
        used.setdefault(r["date"], set()).add(r["slot"])
    out = []
    for r in rows:
        day = used.setdefault(r["date"], set())
        free = [s for s in range(PER_DAY) if s not in day]
        if not free:
            raise ValueError(f"at most {PER_DAY} planned sessions a day ({r['date']})")
        day.add(free[0])
        out.append({**r, "slot": free[0]})
    return out


# --- Plans --------------------------------------------------------------------------

def _week_meta(raw, weeks: int) -> list[dict]:
    """One {index, kind, note} per week; weeks left out are build weeks."""
    raw = [] if raw is None else raw
    if not isinstance(raw, list):
        raise ValueError("week_meta must be a list")
    given: dict[int, dict] = {}
    for w in raw:
        if not isinstance(w, dict) or set(w) - {"index", "kind", "note"}:
            raise ValueError("each week needs index, kind and an optional note")
        i = _int(w.get("index"), "week index", 1, weeks)
        if i in given:
            raise ValueError(f"week {i} is given twice")
        kind = w.get("kind") or "build"
        if kind not in WEEK_KINDS:
            raise ValueError(f"week kind must be one of {WEEK_KINDS}, got {kind!r}")
        given[i] = {"index": i, "kind": kind, "note": _text(w.get("note"), "week note", 60, optional=True)}
    return [given.get(i, {"index": i, "kind": "build", "note": None}) for i in range(1, weeks + 1)]


def weeks_to_goal(start: date, goal: dict | None) -> int | None:
    """Q4: a goal's date sets the plan's length when it falls within 4-12
    weeks of the start (the week containing the date is the last)."""
    if not goal or not goal.get("target_date"):
        return None
    end = _date(goal["target_date"], "target_date")
    if end < start:
        return None
    weeks = (end - start).days // 7 + 1
    return weeks if MIN_WEEKS <= weeks <= MAX_WEEKS else None


def validate_plan(body: dict, *, goals: list[dict], templates: list[dict],
                  gym_list: list[dict] | None = None, today: date | None = None,
                  taken: list[dict] = ()) -> tuple[dict, list[dict]]:
    """A new plan's row and its planned sessions' rows (with slots), or ValueError.

    `body`: name, start_date (a Monday, this week or later), weeks (4-12; from
    the goal's date when left out, Q4), goal_id, week_meta, rationale, source,
    sessions. `taken`: planned sessions already on those days (one-offs)."""
    today = today or date.today()
    unknown = set(body) - {"name", "start_date", "weeks", "goal_id", "week_meta", "rationale",
                           "source", "sessions"}
    if unknown:
        raise ValueError(f"unknown plan fields: {sorted(unknown)}")
    start = _date(body.get("start_date"), "start_date")
    if start.weekday() != 0:
        raise ValueError("a plan starts on a Monday")
    if start < monday(today):
        raise ValueError("a plan can't start before this week")
    goal = None
    if body.get("goal_id") is not None:
        goal = next((g for g in goals if g["id"] == body["goal_id"]), None)
        if goal is None:
            raise ValueError(f"goal {body['goal_id']} not found")
        if goal["status"] not in ("active", "paused"):
            raise ValueError("a plan can only serve an open goal")
    weeks = body.get("weeks")
    if weeks is None:
        weeks = weeks_to_goal(start, goal)
        if weeks is None:
            raise ValueError(f"weeks is required ({MIN_WEEKS}-{MAX_WEEKS}) unless the goal's date "
                             f"is {MIN_WEEKS}-{MAX_WEEKS} weeks away")
    weeks = _int(weeks, "weeks", MIN_WEEKS, MAX_WEEKS)
    source = body.get("source") or "user"
    if source not in SOURCES:
        raise ValueError(f"source must be one of {SOURCES}")
    row = {"name": _text(body.get("name"), "name", 60), "goal_id": goal["id"] if goal else None,
           "start_date": start.isoformat(), "weeks": weeks,
           "week_meta": _week_meta(body.get("week_meta"), weeks),
           "rationale": _text(body.get("rationale"), "rationale", 300, optional=True),
           "source": source}
    items = body.get("sessions") or []
    if not isinstance(items, list) or len(items) > MAX_SESSIONS:
        raise ValueError(f"sessions must be a list of at most {MAX_SESSIONS}")
    rows = [validate_planned(i, templates, gym_list, plan=row) for i in items]
    return row, slots(rows, taken)


def weekly_load(plan: dict, planned: list[dict]) -> list[dict]:
    """Planned load per week of the plan, with the week's kind. Skipped
    sessions don't count; sessions without duration and effort add no load."""
    weeks = [{"index": w["index"], "kind": w["kind"], "week_start":
              (_date(plan["start_date"], "start_date") + timedelta(days=7 * (w["index"] - 1))).isoformat(),
              "sessions": 0, "planned_load": 0} for w in _week_meta(plan.get("week_meta"), int(plan["weeks"]))]
    for p in planned:
        i = week_index(plan, p["date"])
        if i is None or p.get("status") == "skipped":
            continue
        weeks[i - 1]["sessions"] += 1
        weeks[i - 1]["planned_load"] += planned_load(p.get("target") or {}) or 0
    return weeks


def with_sessions(plan: dict, planned: list[dict]) -> dict:
    """The plan as the API returns it: its sessions (by date and slot, each with
    its week and planned load) and the planned load per week."""
    mine = sorted((p for p in planned if p.get("plan_id") == plan["id"]),
                  key=lambda p: (p["date"], p["slot"], p["id"]))
    return {**plan, "week_meta": _week_meta(plan.get("week_meta"), int(plan["weeks"])),
            "end_date": plan_end(plan).isoformat(),
            "sessions": [decorate(p, plan) for p in mine],
            "weekly": weekly_load(plan, mine)}


def decorate(planned: dict, plan: dict | None = None) -> dict:
    return {**planned, "week": week_index(plan, planned["date"]) if plan else None,
            "planned_load": planned_load(planned.get("target") or {})}


# --- Operations (what the API calls) -------------------------------------------------

def current_plan(store) -> dict | None:
    return next((p for p in store.plans() if p["status"] in CURRENT), None)


def get_plan(store, plan_id: int, today: date | None = None) -> dict:
    """The plan with its sessions, planned load per week, and each session's
    derived status (done, today, upcoming, not done, skipped, paused)."""
    plan = next((p for p in store.plans() if p["id"] == plan_id), None)
    if plan is None:
        raise LookupError(f"plan {plan_id} not found")
    out = with_sessions(plan, store.planned_sessions(plan_id=plan_id))
    today = today or date.today()
    logged = store.sessions_since(plan["start_date"]) if hasattr(store, "sessions_since") else []
    pause_rows = store.pauses_since(plan["start_date"]) if hasattr(store, "pauses_since") else []
    with_status(out["sessions"], logged, pause_rows, today)
    out["today"] = today.isoformat()
    out["current_week"] = week_index(plan, today)
    return out


def create_plan(store, body: dict, today: date | None = None) -> dict:
    """Store an accepted plan and its sessions. ValueError if invalid;
    RuntimeError (a conflict) while another plan is active or paused (Q3)."""
    if current_plan(store):
        raise RuntimeError("there is already an active plan; leave or finish it first")
    # One-offs already on the plan's days keep their slots.
    taken = store.planned_sessions(since=monday(today or date.today()).isoformat()) if body.get("sessions") else []
    row, rows = validate_plan(body, goals=store.goals(), templates=store.templates(),
                              gym_list=store.gyms(), today=today, taken=taken)
    plan = store.insert_plan(row, rows)
    return get_plan(store, plan["id"])


def update_plan(store, plan_id: int, changes: dict, today: date | None = None) -> dict:
    """Rename, change the rationale or week kinds, pause, resume or finish a plan."""
    plan = next((p for p in store.plans() if p["id"] == plan_id), None)
    if plan is None:
        raise LookupError(f"plan {plan_id} not found")
    unknown = set(changes) - {"name", "rationale", "week_meta", "status"}
    if unknown:
        raise ValueError(f"can't change {sorted(unknown)}")
    out: dict = {}
    if "name" in changes:
        out["name"] = _text(changes["name"], "name", 60)
    if "rationale" in changes:
        out["rationale"] = _text(changes["rationale"], "rationale", 300, optional=True)
    if "week_meta" in changes:
        out["week_meta"] = _week_meta(changes["week_meta"], int(plan["weeks"]))
    if "status" in changes:
        status = changes["status"]
        if status not in ("active", "paused", "finished"):
            raise ValueError("status must be active, paused or finished (leave a plan with /leave)")
        if plan["status"] in ("finished", "left") and status != plan["status"]:
            if status in CURRENT and current_plan(store):
                raise RuntimeError("there is already an active plan; leave or finish it first")
        out["status"] = status
        out["ended_on"] = (today or date.today()).isoformat() if status == "finished" else None
    if not out:
        raise ValueError("nothing to change")
    store.update_plan(plan_id, out)
    return get_plan(store, plan_id)


def leave_plan(store, plan_id: int, today: date | None = None) -> dict:
    """Leave a plan: nothing is deleted, its sessions stay as a record (P23)."""
    plan = next((p for p in store.plans() if p["id"] == plan_id), None)
    if plan is None:
        raise LookupError(f"plan {plan_id} not found")
    if plan["status"] != "left":
        store.update_plan(plan_id, {"status": "left", "ended_on": (today or date.today()).isoformat()})
    return get_plan(store, plan_id)


def _planned(store, planned_id: int) -> dict:
    p = store.get_planned(planned_id)
    if p is None:
        raise LookupError(f"planned session {planned_id} not found")
    return p


def _plan_of(store, plan_id) -> dict | None:
    if plan_id is None:
        return None
    plan = next((p for p in store.plans() if p["id"] == plan_id), None)
    if plan is None:
        raise ValueError(f"plan {plan_id} not found")
    return plan


def _day_rows(store, day: str, but: int | None = None) -> list[dict]:
    return [p for p in store.planned_sessions(since=day, until=day) if p["id"] != but]


def add_planned(store, body: dict) -> dict:
    """Add a planned session to a plan (plan_id) or as a one-off (no plan_id)."""
    body = dict(body)
    plan = _plan_of(store, body.pop("plan_id", None))
    if plan is not None and plan["status"] not in CURRENT:
        raise ValueError("this plan has ended")
    row = validate_planned(body, store.templates(), store.gyms(), plan=plan)
    [row] = slots([row], _day_rows(store, row["date"]))
    stored = store.insert_planned({**row, "plan_id": plan["id"] if plan else None})
    return decorate(stored, plan)


def edit_planned(store, planned_id: int, changes: dict) -> dict:
    """Change a planned session's sport, template, title or target."""
    current = _planned(store, planned_id)
    unknown = set(changes) - {"sport", "template_id", "title", "target"}
    if unknown:
        raise ValueError(f"can't change {sorted(unknown)} here (use move or skip)")
    if not changes:
        raise ValueError("nothing to change")
    plan = _plan_of(store, current.get("plan_id"))
    merged = {k: current[k] for k in ("date", "sport", "template_id", "title", "target")} | changes
    row = validate_planned(merged, store.templates(), store.gyms(), plan=plan,
                           keep_template=current.get("template_id"))
    out = {k: row[k] for k in ("sport", "template_id", "title", "target")}
    return decorate(store.update_planned(planned_id, out), plan)


def move_planned(store, planned_id: int, day: str) -> dict:
    """Move a planned session to another day (inside its plan)."""
    current = _planned(store, planned_id)
    plan = _plan_of(store, current.get("plan_id"))
    new_day = _date(day, "date")
    if plan is not None and week_index(plan, new_day) is None:
        raise ValueError(f"{new_day.isoformat()} is outside the plan")
    if new_day.isoformat() == current["date"]:
        return decorate(current, plan)
    [row] = slots([{"date": new_day.isoformat()}], _day_rows(store, new_day.isoformat(), but=planned_id))
    return decorate(store.update_planned(planned_id, {"date": row["date"], "slot": row["slot"]}), plan)


def skip_planned(store, planned_id: int, reason: str | None = None, *, skip: bool = True) -> dict:
    """Skip a planned session (optional reason), or undo the skip."""
    current = _planned(store, planned_id)
    plan = _plan_of(store, current.get("plan_id"))
    changes = ({"status": "skipped", "skip_reason": _text(reason, "reason", 200, optional=True)}
               if skip else {"status": "planned", "skip_reason": None})
    return decorate(store.update_planned(planned_id, changes), plan)


def remove_planned(store, planned_id: int) -> None:
    if not store.delete_planned(planned_id):
        raise LookupError(f"planned session {planned_id} not found")


def list_planned(store, since: str, until: str) -> list[dict]:
    """Planned sessions between two dates, from plans and one-offs alike."""
    start, end = _date(since, "from"), _date(until, "to")
    if end < start or (end - start).days > 7 * MAX_WEEKS * 2:
        raise ValueError("the range must run forwards and span at most 24 weeks")
    plans = {p["id"]: p for p in store.plans()}
    return [decorate(p, plans.get(p.get("plan_id"))) for p in
            store.planned_sessions(since=start.isoformat(), until=end.isoformat())]


# --- Derived status (read only; storing links is #117) -------------------------------

def _paused(day: date, pause_rows: list[dict]) -> bool:
    """Whether `day` falls inside a pause: from its start to the day before it
    ended, or, while it is on, to its planned end (or open-ended)."""
    for p in pause_rows:
        start = _date(p["start_date"], "start_date")
        if p.get("ended_on"):
            end = _date(p["ended_on"], "ended_on") - timedelta(days=1)
        elif p.get("planned_end"):
            end = _date(p["planned_end"], "planned_end")
        else:
            end = date.max
        if start <= day <= end:
            return True
    return False


def with_status(planned: list[dict], logged: list[dict], pause_rows: list[dict], today: date) -> list[dict]:
    """Give each planned session (in place) its status and the session that
    did it. A planned session is done when it is linked (session_id) or, until
    #117 stores links, when a session of the same sport (and template, if
    planned) was logged that day and isn't already counted for another planned
    session. Never judgemental: "not done" is only a past day with nothing
    logged, and nothing about it is stored (P17, P24, Q7)."""
    by_id = {s["id"]: s for s in logged}
    used = {p["session_id"] for p in planned if p.get("session_id")}
    for p in sorted(planned, key=lambda p: (p["date"], p["slot"])):
        done = by_id.get(p.get("session_id"))
        if done is None and not p.get("session_id"):
            done = next((s for s in logged if s["id"] not in used and s["date"] == p["date"]
                         and s["sport"] == p["sport"]
                         and (p.get("template_id") is None or s.get("template_id") == p["template_id"])),
                        None)
            if done is not None:
                used.add(done["id"])
        day = _date(p["date"], "date")
        if done is not None:
            status = "done"
        elif p.get("status") == "skipped":
            status = "skipped"
        elif _paused(day, pause_rows):
            status = "paused"
        elif day == today:
            status = "today"
        elif day > today:
            status = "upcoming"
        else:
            status = "not_done"
        p["state"] = status
        p["done"] = ({k: done.get(k) for k in ("id", "date", "duration_min", "effort", "distance_km")}
                     if done is not None else None)
    return planned


# --- Load rules (section 5) -----------------------------------------------------------

def _km(p: dict) -> float:
    return float((p.get("target") or {}).get("distance_km") or 0)


def check_rules(row: dict, rows: list[dict], history: list[dict], today: date) -> dict:
    """Check a proposed plan against the sourced load rules. Returns the
    violations (the proposal is refused while there are any), notes, and what
    the rules allow by the plan's end (`capacity`), so the coach can say
    plainly when a goal can't be reached in time.

    `history`: the user's logged sessions from at least 30 days before the plan."""
    violations: list[str] = []
    notes: list[str] = []
    plan = {**row, "id": 0}
    start = _date(row["start_date"], "start_date")
    runs = sorted((p for p in rows if p["sport"] == "running"), key=lambda p: (p["date"], p["slot"]))
    for p in runs:
        if not _km(p):
            violations.append(f"the run on {p['date']} needs a target distance_km, so the "
                              "running rules can be checked")
    past_runs = [(_date(s["date"], "date"), float(s.get("distance_km") or 0))
                 for s in history if s["sport"] == "running" and s.get("distance_km")
                 and _date(s["date"], "date") <= today]
    rule = RULES["max_run_vs_longest_30d"]

    # L1a: each planned run against the longest run in the 30 days before it,
    # counting earlier planned runs too.
    seen = list(past_runs)
    for p in runs:
        day, km = _date(p["date"], "date"), _km(p)
        window = [d for when, d in seen if day - timedelta(days=30) <= when < day]
        if km and not window:
            violations.append(f"no run in the 30 days before {p['date']} to build from (L1a): ask the "
                              "user what they run now before planning runs")
        elif km and km > max(window) * rule["value"] + ROUNDING_KM:
            violations.append(f"the {km:g} km run on {p['date']} is more than 10% longer than the "
                              f"longest run in the 30 days before it ({max(window):g} km) (L1a, P31)")
        if km:
            seen.append((day, km))

    # L1b: weekly running distance against the last full (not lighter) week.
    base_end = min(today, start - timedelta(days=1))
    base = sum(d for when, d in past_runs if base_end - timedelta(days=6) <= when <= base_end)
    weekly_km = [0.0] * int(row["weeks"])
    for p in runs:
        weekly_km[week_index(plan, p["date"]) - 1] += _km(p)
    kinds = [w["kind"] for w in row["week_meta"]]
    step = RULES["max_weekly_run_increase"]["value"]
    for i, km in enumerate(weekly_km):
        if km and not base:
            notes.append(f"week {i + 1}: no running in the last 7 days to compare with; only L1a applies")
        elif km > base * (1 + step) + ROUNDING_KM:
            violations.append(f"week {i + 1} plans {km:g} km of running, more than 10% above "
                              f"{base:g} km (L1b, P29/P30)")
        if kinds[i] == "build" and km:
            base = km  # lighter weeks don't reset the base

    # L2: every 4th week is lighter, with less planned load than the week before.
    loads = [w["planned_load"] for w in weekly_load(plan, rows)]
    every = RULES["deload_every"]["value"]
    for i in range(every - 1, int(row["weeks"]), every):
        if kinds[i] not in ("deload", "taper"):
            violations.append(f"week {i + 1} must be a lighter week (kind deload) (L2, P27)")
        elif i and loads[i] >= loads[i - 1] and loads[i - 1]:
            violations.append(f"week {i + 1} is marked lighter but its planned load ({loads[i]}) isn't "
                              f"below week {i}'s ({loads[i - 1]}) (L2, P27)")
    if "taper" in kinds:
        notes.append("taper has no sourced rule yet (L3, needs source): don't claim a number for it")

    # What the rules allow by the end: one 10% step per full week.
    longest = max((d for when, d in past_runs if when > today - timedelta(days=30)), default=0.0)
    last_week = sum(d for when, d in past_runs if when > today - timedelta(days=7))
    build_weeks = sum(1 for k in kinds if k == "build")
    capacity = {
        "longest_run_30d_km": round(longest, 1),
        "running_last_7d_km": round(last_week, 1),
        "max_long_run_by_end_km": round(longest * rule["value"] ** build_weeks, 1),
        "max_weekly_running_by_end_km": round(last_week * (1 + step) ** build_weeks, 1),
        "note": "upper limits under L1a and L1b, not targets",
    }
    return {"violations": violations, "notes": notes, "capacity": capacity,
            "weekly_running_km": [round(k, 1) for k in weekly_km]}


# --- The coach's tools (#119) -----------------------------------------------------------

def _context(sessions_per_week, available_days, injury_or_pain, user_said) -> dict:
    """What the coach must know before proposing (#135): how often and on which
    days the user can train, and any injury or pain, in their words. Missing
    parts mean the coach should have asked first."""
    spw = _int(sessions_per_week, "sessions_per_week", 1, 14)
    if not isinstance(available_days, list) or not available_days:
        raise ValueError("available_days is required: ask the user which days they can train")
    days = []
    for d in available_days:
        name = str(d).strip().lower()
        match = next((w for w in WEEKDAYS if w.startswith(name[:3])), None) if len(name) >= 3 else None
        if match is None:
            raise ValueError(f"available_days must be weekday names, got {d!r}")
        days.append(match)
    pain = _text(injury_or_pain, "injury_or_pain", 200)  # "none" when the user said so
    said = user_said or []
    if not isinstance(said, list) or len(said) > 5:
        raise ValueError("user_said must be a list of at most 5 short quotes")
    said = [_text(s, "a user_said quote", 80) for s in said]
    return {"sessions_per_week": spw, "available_days": sorted(set(days), key=WEEKDAYS.index),
            "injury_or_pain": pain, "user_said": said}


def _check_proposal(rows: list[dict], ctx: dict, plan: dict) -> list[str]:
    """Stricter than a plan the user edits (#135): every session has duration
    and effort, so planned load can be shown; every run has a type; a quality
    run has a concrete workout; sessions fall on the user's days and don't
    exceed how many they said a week."""
    problems = []
    per_week: dict[int, int] = {}
    for r in rows:
        t = r["target"]
        if t.get("duration_min") is None or t.get("effort") is None:
            problems.append(f"{r['date']} {r['title']}: needs duration_min and effort, so planned load can be shown")
        if r["sport"] == "running":
            if t.get("session_type") is None:
                problems.append(f"{r['date']} {r['title']}: needs a session_type ({', '.join(RUN_TYPES)})")
            elif t["session_type"] in QUALITY and not t.get("workout"):
                problems.append(f"{r['date']} {r['title']}: a {t['session_type']} session needs a concrete "
                                "workout, e.g. '6 x 800 m at 10 km pace, 90 s jog rest'")
        weekday = WEEKDAYS[_date(r["date"], "date").weekday()]
        if weekday not in ctx["available_days"]:
            problems.append(f"{r['date']} is a {weekday.title()}, not one of the user's days "
                            f"({', '.join(d.title() for d in ctx['available_days'])})")
        week = week_index(plan, r["date"])
        per_week[week] = per_week.get(week, 0) + 1
    for week, n in sorted(per_week.items()):
        if n > ctx["sessions_per_week"]:
            problems.append(f"week {week} has {n} sessions; the user said {ctx['sessions_per_week']} a week")
    return problems


def intensity(rows: list[dict], plan: dict) -> dict:
    """L8, intensity distribution (needs source): per week, running km by
    session type, the easy share and the quality sessions. Reported, with
    notes, but not enforced: no paper in research/ gives the numbers."""
    weeks = []
    notes = []
    kinds = [w["kind"] for w in plan["week_meta"]]
    for i in range(int(plan["weeks"])):
        runs = [r for r in rows if r["sport"] == "running" and week_index(plan, r["date"]) == i + 1]
        km = sum(_km(r) for r in runs)
        quality = [r for r in runs if r["target"].get("session_type") in QUALITY]
        easy_km = sum(_km(r) for r in runs if r["target"].get("session_type") in ("easy", "long", "recovery"))
        weeks.append({"week": i + 1, "runs": len(runs), "quality_sessions": len(quality),
                      "easy_share": round(easy_km / km, 2) if km else None})
        if len(runs) >= 3 and not quality and kinds[i] == "build":
            notes.append(f"week {i + 1}: 3+ runs and no quality session (intervals or tempo); "
                         "consider one, unless the user's form or pain says otherwise")
        if kinds[i] == "taper" and quality:
            notes.append(f"week {i + 1} is a taper week with a quality session: keep it well before "
                         "the goal date (L8 needs source: no number for how many days)")
    return {"weeks": weeks, "notes": notes}


def propose_program(store, today: date | None = None, *, sessions_per_week=None, available_days=None,
                    injury_or_pain=None, user_said=None, **body) -> dict:
    """A plan the coach proposes: validated and checked against the load rules,
    never stored. The app shows it as a card; only the user's Accept stores it
    (POST /plans), whatever the "Save without asking" setting (Q5).

    The coach must first know the user's sessions per week, available days and
    any injury or pain (#135): without them the tool refuses, so the coach asks.
    During an active injury or illness pause it proposes no regular plan."""
    today = today or date.today()
    current = current_plan(store) if hasattr(store, "plans") else None
    if current:
        raise ValueError(f"the user already has a plan ({current['name']!r}, {current['status']}); "
                         "they can leave or finish it in the Plan view before a new one (Q3)")
    pause = store.active_pause() if hasattr(store, "active_pause") else None
    if pause and pause.get("reason") in ("injury", "illness"):
        raise ValueError(f"the user is on an {pause['reason']} pause: propose no regular plan. Offer a "
                         "gentle restart for after the pause, never diagnose, and suggest a "
                         "physiotherapist or doctor if pain persists")
    # The training profile (#137) fills what the coach would otherwise ask. No
    # injuries counts as "none" only if the user filled in the profile.
    prof = (store.get_profile() if hasattr(store, "get_profile") else None) or {}
    from_profile = []
    if sessions_per_week in (None, "") and prof.get("sessions_per_week"):
        sessions_per_week = prof["sessions_per_week"]
        from_profile.append("sessions_per_week")
    if available_days in (None, []) and prof.get("preferred_days"):
        available_days = prof["preferred_days"]
        from_profile.append("available_days")
    if injury_or_pain in (None, ""):
        injuries = prof.get("injuries") or []
        if injuries:
            injury_or_pain = "; ".join(i["body_part"] + (f" (pain {i['pain']}/10)" if i.get("pain") is not None else "")
                                       for i in injuries)
            from_profile.append("injury_or_pain")
        elif prof.get("onboarding") == "done":
            injury_or_pain = "none"
            from_profile.append("injury_or_pain")
    missing = [k for k, v in (("sessions_per_week", sessions_per_week), ("available_days", available_days),
                              ("injury_or_pain", injury_or_pain)) if v in (None, "", [])]
    if missing:
        raise ValueError(f"missing {', '.join(missing)}: ask the user in one short message (how many "
                         "sessions a week, which days, any injury or pain) instead of guessing")
    ctx = _context(sessions_per_week, available_days, injury_or_pain, user_said)
    if from_profile:
        ctx["from_profile"] = from_profile
    row, rows = validate_plan({**body, "source": "coach"},
                              goals=store.goals() if hasattr(store, "goals") else [],
                              templates=store.templates() if hasattr(store, "templates") else [],
                              gym_list=store.gyms() if hasattr(store, "gyms") else [], today=today)
    problems = _check_proposal(rows, ctx, row)
    if problems:
        raise ValueError("fix the proposal: " + "; ".join(problems))
    history = store.sessions_since((today - timedelta(days=45)).isoformat())
    checks = check_rules(row, rows, history, today)
    if checks["violations"]:
        raise ValueError("the proposal breaks the load rules; change it or tell the user "
                         "plainly what can't be reached in time: " + "; ".join(checks["violations"])
                         + f". Capacity: {json.dumps(checks['capacity'])}")
    goal = next((g for g in (store.goals() if hasattr(store, "goals") else [])
                 if g["id"] == row["goal_id"]), None)
    plan = {**row, "id": None, "status": "proposed"}
    sessions = [{**r, "id": None, "plan_id": None} for r in rows]
    shown = {**plan, "end_date": plan_end(plan).isoformat(),
             "sessions": [decorate(s, plan) for s in sessions],
             "weekly": weekly_load(plan, sessions),
             "weekly_running_km": checks["weekly_running_km"]}
    # What the app sends back to POST /plans on Accept.
    accept = {"name": row["name"], "start_date": row["start_date"], "weeks": row["weeks"],
              "goal_id": row["goal_id"], "week_meta": row["week_meta"], "rationale": row["rationale"],
              "source": "coach",
              "sessions": [{k: r[k] for k in ("date", "sport", "template_id", "title", "target")}
                           for r in rows]}
    mix = intensity(rows, row)
    notes = checks["notes"] + mix["notes"]
    if ctx["injury_or_pain"].strip().lower() not in ("none", "no", "nothing"):
        notes.append("the user mentioned injury or pain: keep the plan conservative, never diagnose, "
                     "and suggest a physiotherapist if the pain persists or gets worse")
    return {"proposal": True, "stored": False, "plan": shown, "accept": accept,
            "goal": goal, "context": ctx, "intensity": mix["weeks"],
            "rules_applied": [f"{v['rule']}: {v['text']} [{v['source']}]" for v in _SOURCED.values()],
            "needs_source": list(_UNSOURCED), "notes": notes, "capacity": checks["capacity"]}


def plan_for_coach(store, today: date | None = None) -> dict:
    """get_plan for the coach: the current plan with this week's and next
    week's sessions and their status, or that there is none."""
    current = current_plan(store) if hasattr(store, "plans") else None
    if current is None:
        return {"plan": None}
    plan = get_plan(store, current["id"], today)
    week = plan["current_week"]
    near = [s for s in plan["sessions"] if week and s["week"] in (week, week + 1)]
    return {"plan": {k: plan[k] for k in ("id", "name", "status", "start_date", "end_date", "weeks",
                                          "week_meta", "goal_id", "current_week", "weekly")},
            "this_and_next_week": near}
