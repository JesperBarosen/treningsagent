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

import hashlib
import json
import re
from collections import Counter
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
RUN_TYPES = ("easy", "long", "strides", "intervals", "tempo", "recovery")
# Quality sessions (#147): strides (an easy run with short fast pick-ups), tempo, intervals.
QUALITY = ("strides", "intervals", "tempo")
# The starting point (#147): week 1 starts near current form, then grows within
# L1a/L1b. App defaults, not research: the load rules are ceilings on increases,
# and nothing says to start below what the user already does. With reported
# pain or injury the floor is lower, and quality waits.
START_FLOOR = {"long_run": 0.8, "weekly": 0.7}
START_FLOOR_WITH_PAIN = {"long_run": 0.6, "weekly": 0.5}
MAX_PAIN_FOR_QUALITY = 2  # quality sessions only while pain stays at or below 2/10
STATED_RUN_DAYS = 30      # a run the user mentions counts for P31 only within 30 days
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
    # Not a load rule, so never cited as research (#147): where week 1 starts.
    "start_floor": {"value": START_FLOOR, "with_pain": START_FLOOR_WITH_PAIN, "status": "app default",
                    "text": "week 1 starts near current form: long run at least 80% of the recent longest, "
                            "weekly running at least 70% of the 4-week average (60% and 50% with pain)"},
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


# --- Linking logged sessions to planned ones (#117, section 6, Q6 option A) -----------

# A session counts for a planned one logged from the day before to two days after it.
LINK_DAYS_BEFORE, LINK_DAYS_AFTER = 1, 2


def _linked_to(store, session_id: int) -> dict | None:
    """The planned session a logged one is linked to, if any."""
    return next((p for p in store.planned_sessions() if p.get("session_id") == session_id), None)


def check_linkable(store, planned_id: int, sport: str, session_id: int | None = None) -> dict:
    """The planned session `planned_id`, if a `sport` session may be linked to
    it. LookupError if it doesn't exist; ValueError if it is another sport or
    already done by another session."""
    p = _planned(store, planned_id)
    if p["sport"] != sport:
        raise ValueError(f"{p['title']} on {p['date']} is planned as {p['sport']}, not {sport}")
    if p.get("session_id") and p["session_id"] != session_id:
        raise ValueError(f"{p['title']} on {p['date']} is already done by another session; unlink that one first")
    return p


def link_planned(store, planned_id: int, session_id: int) -> dict:
    """Link a logged session to a planned one: the planned session is done.
    A skipped one counts as done again. A session does one planned session."""
    session = store.get_session(session_id)
    if session is None:
        raise LookupError(f"session {session_id} not found")
    p = check_linkable(store, planned_id, session["sport"], session_id)
    other = _linked_to(store, session_id)
    if other is not None and other["id"] != planned_id:
        raise ValueError(f"that session already counts for {other['title']} on {other['date']}; unlink it first")
    changes = {"session_id": session_id}
    if p.get("status") == "skipped":
        changes |= {"status": "planned", "skip_reason": None}
    return decorate(store.update_planned(planned_id, changes), _plan_of(store, p.get("plan_id")))


def unlink_planned(store, planned_id: int) -> dict:
    """Undo a link: the planned session is open again; the logged one stays."""
    p = _planned(store, planned_id)
    return decorate(store.update_planned(planned_id, {"session_id": None}), _plan_of(store, p.get("plan_id")))


def link_candidates(store, session: dict) -> list[dict]:
    """Open planned sessions a logged one may be: same sport (and template, if
    one is planned), not done or skipped, in a current plan or a one-off, from
    two days before to the day after the session (so the session falls from the
    day before to two days after the planned day)."""
    if not hasattr(store, "planned_sessions"):
        return []
    day = _date(session["date"], "date")
    rows = store.planned_sessions(since=(day - timedelta(days=LINK_DAYS_AFTER)).isoformat(),
                                  until=(day + timedelta(days=LINK_DAYS_BEFORE)).isoformat())
    plans = {p["id"]: p for p in store.plans()}
    out = []
    for p in rows:
        plan = plans.get(p.get("plan_id"))
        if p.get("plan_id") is not None and (plan is None or plan["status"] not in CURRENT):
            continue
        if (p.get("session_id") or p.get("status") == "skipped" or p["sport"] != session["sport"]
                or (p.get("template_id") is not None and p["template_id"] != session.get("template_id"))):
            continue
        out.append(decorate(p, plan))
    return sorted(out, key=lambda p: (abs((_date(p["date"], "date") - day).days), p["date"], p["slot"]))


def link_after_logging(store, session: dict, planned_id: int | None = None) -> dict:
    """After a session is logged (form, chat or later imports). With
    `planned_id` ("Log this" in the Plan view) it links that one. Otherwise,
    exactly one candidate on the same day is linked automatically, and the app
    offers Undo; one on another day, or several, come back as `candidates` for
    the app or the coach to ask about. Nothing matching: {}."""
    if planned_id is not None:
        return {"linked": link_planned(store, planned_id, session["id"]), "auto": False}
    found = link_candidates(store, session)
    if len(found) == 1 and found[0]["date"] == session["date"]:
        return {"linked": link_planned(store, found[0]["id"], session["id"]), "auto": True}
    return {"candidates": found} if found else {}


# --- Derived status (read only) ------------------------------------------------------

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
    did it. A planned session is done only when a logged session is linked to
    it (session_id, #117); the link is made when logging, never guessed here.
    Never judgemental: "not done" is only a past day with nothing linked, and
    nothing about it is stored (P17, P24, Q7)."""
    by_id = {s["id"]: s for s in logged}
    for p in planned:
        done = None
        if p.get("session_id"):
            # A session logged before the plan's start isn't in `logged`; it still did it.
            done = by_id.get(p["session_id"], {"id": p["session_id"], "date": None})
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


def check_rules(row: dict, rows: list[dict], history: list[dict], today: date, pain: bool = False, *,
                reduced: dict[int, float] | None = None, l2_in_a_row: bool = False) -> dict:
    """Check a proposed plan against the sourced load rules and the starting
    floor. Returns the violations (the proposal is refused while there are
    any), notes, and what the rules allow (`capacity`), so the coach can say
    plainly when a goal can't be reached in time.

    `history`: the user's sessions from at least 30 days before the plan,
    including runs they stated but didn't log (#147). `pain`: injury or pain
    was reported, which lowers the starting floor.

    For a change to a plan underway (#131): `reduced` weeks (made lighter,
    or with a session skipped or moved out; week -> its running km as planned
    before) count as lighter weeks and keep their planned km as the base, so
    less in one week never makes the next look like a jump; and `l2_in_a_row`
    reads L2 as "no more than 3 full weeks in a row", so a break week after
    a pause counts as the lighter week it is."""
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
    # Week 1 compares with the higher of the last 7 days and the 4-week average,
    # so one light week doesn't drag the start below the user's usual (#147).
    base_end = min(today, start - timedelta(days=1))
    last_7 = sum(d for when, d in past_runs if base_end - timedelta(days=6) <= when <= base_end)
    avg_28 = sum(d for when, d in past_runs if today - timedelta(days=27) <= when <= today) / 4
    base = max(last_7, avg_28)
    weekly_km = [0.0] * int(row["weeks"])
    for p in runs:
        weekly_km[week_index(plan, p["date"]) - 1] += _km(p)
    kinds = [w["kind"] for w in row["week_meta"]]
    reduced = reduced or {}
    lighter = [k in ("deload", "taper") or i + 1 in reduced for i, k in enumerate(kinds)]
    step = RULES["max_weekly_run_increase"]["value"]

    # The starting point (#147): week 1 near current form, not below it. The
    # rules above are ceilings on increases, never a reason to start lower.
    longest_30 = max((d for when, d in past_runs if when > today - timedelta(days=30)), default=0.0)
    floor = START_FLOOR_WITH_PAIN if pain else START_FLOOR
    week1 = [p for p in runs if week_index(plan, p["date"]) == 1]
    if week1 and kinds[0] == "build" and not lighter[0]:
        long1 = max(_km(p) for p in week1)
        if longest_30 and long1 + ROUNDING_KM < longest_30 * floor["long_run"]:
            violations.append(
                f"week 1's longest run ({long1:g} km) starts far below the recent longest ({longest_30:g} km): "
                f"start near current form, at least {longest_30 * floor['long_run']:.1f} km, and grow from there "
                "(the load rules cap increases; they don't ask for a lower start)")
        if avg_28 and weekly_km[0] + ROUNDING_KM < avg_28 * floor["weekly"]:
            violations.append(
                f"week 1 plans {weekly_km[0]:g} km of running, far below the recent weekly average "
                f"({avg_28:.1f} km): start at least at {avg_28 * floor['weekly']:.1f} km")

    for i, km in enumerate(weekly_km):
        if km and not base:
            notes.append(f"week {i + 1}: no running in the last 4 weeks to compare with; only L1a applies")
        elif km > base * (1 + step) + ROUNDING_KM:
            violations.append(f"week {i + 1} plans {km:g} km of running, more than 10% above "
                              f"{base:g} km (L1b, P29/P30)")
        if i + 1 in reduced:
            base = reduced[i + 1] or base  # the week as it was planned before the change
        elif kinds[i] == "build" and not lighter[i] and km:
            base = km  # lighter weeks don't reset the base

    # L2: every 4th week is lighter, with less planned load than the week before.
    loads = [w["planned_load"] for w in weekly_load(plan, rows)]
    every = RULES["deload_every"]["value"]
    in_a_row = 0  # full weeks in a row, for l2_in_a_row
    for i in range(int(row["weeks"])):
        marked = kinds[i] in ("deload", "taper")
        due = in_a_row == every - 1 if l2_in_a_row else i % every == every - 1
        if due and not marked and not (l2_in_a_row and lighter[i]):
            violations.append(f"week {i + 1} must be a lighter week (kind deload) (L2, P27)")
            in_a_row = 0
            continue
        # A week a change made lighter, or a break, is checked by the change itself.
        checked = due or (l2_in_a_row and i + 1 not in reduced and row["week_meta"][i].get("note") != "break")
        if marked and checked and i and loads[i] >= loads[i - 1] and loads[i - 1]:
            violations.append(f"week {i + 1} is marked lighter but its planned load ({loads[i]}) isn't "
                              f"below week {i}'s ({loads[i - 1]}) (L2, P27)")
        in_a_row = 0 if lighter[i] else in_a_row + 1
    if "taper" in kinds:
        notes.append("taper has no sourced rule yet (L3, needs source): don't claim a number for it")

    # Where to start, and what the rules allow by the end: one 10% step per full week.
    longest = longest_30
    last_week = sum(d for when, d in past_runs if when > today - timedelta(days=7))
    build_weeks = sum(1 for k in kinds if k == "build")
    capacity = {
        "longest_run_30d_km": round(longest, 1),
        "running_last_7d_km": round(last_week, 1),
        "running_weekly_avg_28d_km": round(avg_28, 1),
        "start_long_run_km_at_least": round(longest * floor["long_run"], 1),
        "start_weekly_km_at_least": round(avg_28 * floor["weekly"], 1),
        "max_long_run_by_end_km": round(longest * rule["value"] ** build_weeks, 1),
        "max_weekly_running_by_end_km": round(max(last_week, avg_28) * (1 + step) ** build_weeks, 1),
        "note": "start near the 'at least' values, then grow within the 'max' limits (L1a, L1b)",
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
    days = _weekdays(available_days)
    pain = _text(injury_or_pain, "injury_or_pain", 200)  # "none" when the user said so
    said = user_said or []
    if not isinstance(said, list) or len(said) > 5:
        raise ValueError("user_said must be a list of at most 5 short quotes")
    said = [_text(s, "a user_said quote", 80) for s in said]
    return {"sessions_per_week": spw, "available_days": days,
            "injury_or_pain": pain, "user_said": said}


def _weekdays(values: list) -> list[str]:
    """Weekday names ("tue", "Thursday") as full lowercase names, Monday first."""
    days = []
    for d in values:
        name = str(d).strip().lower()
        match = next((w for w in WEEKDAYS if w.startswith(name[:3])), None) if len(name) >= 3 else None
        if match is None:
            raise ValueError(f"available_days must be weekday names, got {d!r}")
        days.append(match)
    return sorted(set(days), key=WEEKDAYS.index)


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
        if kinds[i] == "taper" and quality:
            notes.append(f"week {i + 1} is a taper week with a quality session: keep it well before "
                         "the goal date (L8 needs source: no number for how many days)")
    return {"weeks": weeks, "notes": notes}


def quality_check(rows: list[dict], plan: dict, pain: bool, pain_level: int | None) -> tuple[list[str], list[str]]:
    """Quality sessions (#147, L8): without pain, every build week with 3+ runs
    has at least one (strides, tempo or intervals). With pain or injury: none
    in week 1, and none at all above MAX_PAIN_FOR_QUALITY/10; later ones only
    while pain stays at or below it, which the reason must say. Returns
    (problems that refuse the proposal, notes)."""
    problems, notes = [], []
    kinds = [w["kind"] for w in plan["week_meta"]]
    for i in range(int(plan["weeks"])):
        runs = [r for r in rows if r["sport"] == "running" and week_index(plan, r["date"]) == i + 1]
        quality = [r for r in runs if r["target"].get("session_type") in QUALITY]
        if not pain and kinds[i] == "build" and len(runs) >= 3 and not quality:
            problems.append(f"week {i + 1} has {len(runs)} runs and no quality session: add one (strides, tempo "
                            "or intervals) with a concrete workout (L8); most volume stays easy")
        if pain and quality and (i == 0 or (pain_level is not None and pain_level > MAX_PAIN_FOR_QUALITY)):
            why = "the first week" if i == 0 else f"pain at {pain_level}/10"
            problems.append(f"week {i + 1} has a quality session with reported pain ({why}): start without hard "
                            f"sessions, and add them later only while pain stays at or below {MAX_PAIN_FOR_QUALITY}/10")
    if pain:
        notes.append(f"pain or injury reported: no hard sessions at the start; any later quality session only while "
                     f"pain stays at or below {MAX_PAIN_FOR_QUALITY}/10 — say this in the reason")
    return problems, notes


def stated_runs(recent_runs, profile: dict, today: date) -> tuple[list[dict], list[str]]:
    """Runs the user said they did in the last 30 days but didn't log (#147):
    from the chat (`recent_runs`) and the profile's longest recent run when the
    profile was updated within 30 days. They count for the P31 baseline like
    logged runs. Older achievements (PBs, races before an injury) never do."""
    runs, said = [], []
    items = recent_runs or []
    if not isinstance(items, list) or len(items) > 10:
        raise ValueError("recent_runs must be a list of at most 10 runs the user stated")
    for r in items:
        if not isinstance(r, dict) or set(r) - {"km", "days_ago"}:
            raise ValueError("each recent run has km and days_ago (how many days ago, 0-30)")
        km = r.get("km")
        if isinstance(km, bool) or not isinstance(km, (int, float)) or not 0 < km <= 100:
            raise ValueError("a recent run's km must be between 0 and 100")
        days = _int(r.get("days_ago"), "days_ago", 0, STATED_RUN_DAYS)
        runs.append({"sport": "running", "date": (today - timedelta(days=days)).isoformat(), "distance_km": float(km)})
        said.append(f"{km:g} km {days} days ago (stated in chat)")
    longest, updated = profile.get("longest_run_km"), profile.get("updated_at")
    if longest and updated:
        when = _date(str(updated)[:10], "updated_at")
        if today - when <= timedelta(days=STATED_RUN_DAYS):
            runs.append({"sport": "running", "date": when.isoformat(), "distance_km": float(longest)})
            said.append(f"{float(longest):g} km longest recent run (from the profile, updated {when.isoformat()})")
    return runs, said


def propose_program(store, today: date | None = None, *, sessions_per_week=None, available_days=None,
                    injury_or_pain=None, user_said=None, pain_level=None, recent_runs=None, **body) -> dict:
    """A plan the coach proposes: validated and checked against the load rules,
    never stored. The app shows it as a card; only the user's Accept stores it
    (POST /plans), whatever the "Save without asking" setting (Q5).

    The coach must first know the user's sessions per week, available days and
    any injury or pain (#135): without them the tool refuses, so the coach asks.
    During an active injury or illness pause it proposes no regular plan."""
    today = today or date.today()
    current = current_plan(store) if hasattr(store, "plans") else None
    if current:
        raise ValueError(f"the user already has a plan ({current['name']!r}, {current['status']}): to "
                         "change it, use propose_plan_change with only the changes they asked for; for "
                         "a new plan they can leave or finish this one in the Plan view first (Q3)")
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
    pain = ctx["injury_or_pain"].strip().lower() not in ("none", "no", "nothing")
    if pain_level is None and prof.get("injuries") and "injury_or_pain" in from_profile:
        known = [i["pain"] for i in prof["injuries"] if i.get("pain") is not None]
        pain_level = max(known) if known else None
    if pain_level is not None:
        pain_level = _int(pain_level, "pain_level", 0, 10)
        ctx["pain_level"] = pain_level
    problems = _check_proposal(rows, ctx, row)
    quality_problems, quality_notes = quality_check(rows, row, pain, pain_level)
    problems += quality_problems
    if problems:
        raise ValueError("fix the proposal: " + "; ".join(problems))
    # Logged runs, plus runs the user stated for the last 30 days (#147).
    extra, baseline_from_user = stated_runs(recent_runs, prof, today)
    if baseline_from_user:
        ctx["baseline_from_user"] = baseline_from_user
    history = store.sessions_since((today - timedelta(days=45)).isoformat()) + extra
    checks = check_rules(row, rows, history, today, pain=pain)
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
    notes = checks["notes"] + mix["notes"] + quality_notes
    if baseline_from_user:
        notes.append("the baseline includes runs the user stated (" + "; ".join(baseline_from_user)
                     + "): say so in the reason")
    if pain:
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
    if week is None and plan["today"] < plan["start_date"]:
        week = 1  # not started yet: its first two weeks, so a change can name their ids (#131)
    near = [s for s in plan["sessions"] if week and s["week"] in (week, week + 1)]
    return {"plan": {k: plan[k] for k in ("id", "name", "status", "start_date", "end_date", "weeks",
                                          "week_meta", "goal_id", "current_week", "weekly")},
            "this_and_next_week": near}


# --- Change proposals (#131, sections 4 and 6, mockup 4) ----------------------------------
# The coach proposes changes to the current plan, never a whole new plan: move,
# remove (skip), add, edit, make a week lighter, or shift what's left after a
# pause. Nothing is stored until the user's Accept (Q5), which may apply all of
# the changes or the ones they picked. The same guardrails as a new plan run
# on the plan as it would be afterwards; a change may not add a rule break
# that wasn't there before (a plan underway is judged against today's history,
# so old weeks can look different from when it was accepted).

CHANGE_TYPES = ("move", "remove", "add", "edit", "lighter", "shift")
CHANGE_LABEL = {"move": "Move", "remove": "Skip", "add": "Add", "edit": "Edit",
                "lighter": "Lighter", "shift": "Shift"}
MAX_CHANGES = 20
MAX_SHIFT_DAYS = 28
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_WRITABLE = ("date", "slot", "title", "target", "status", "skip_reason")
_VERSION_KEYS = ("id", "date", "slot", "sport", "template_id", "title", "target", "status", "session_id")


def plan_version(plan: dict, planned: list[dict]) -> str:
    """A fingerprint of the plan and its planned sessions, so Accept can refuse
    a proposal made for a plan that has changed since (a session moved in the
    Plan view, one logged and linked, the plan paused). The plan's updated_at
    alone wouldn't see edits to its sessions, which live in their own table."""
    data = {"plan": {k: plan.get(k) for k in ("id", "start_date", "weeks", "week_meta", "status")},
            "sessions": sorted(([p.get(k) for k in _VERSION_KEYS] for p in planned
                                if p.get("plan_id") == plan["id"]), key=lambda r: r[0])}
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _when(day, today: date) -> str:
    """"Thursday" within the coming week, else "Thursday 3 Dec"."""
    d = _date(day, "date")
    name = WEEKDAYS[d.weekday()].title()
    return name if 0 <= (d - today).days < 7 else f"{name} {d.day} {_MONTHS[d.month - 1]}"


def _target_text(t: dict) -> str:
    parts = []
    if t.get("duration_min") is not None:
        parts.append(f"{t['duration_min']} min")
    if t.get("distance_km") is not None:
        parts.append(f"{t['distance_km']:g} km")
    if t.get("effort") is not None:
        parts.append(f"effort {t['effort']}")
    if t.get("workout"):
        parts.append(t["workout"])
    return ", ".join(parts) or "no target"


def _change_context(store, available_days=None, sessions_per_week=None, injury_or_pain=None,
                    pain_level=None, user_said=None) -> dict:
    """What the guardrails check a change against: the user's days, sessions a
    week and pain, from the coach (what the user just said) or the profile.
    Unlike a new plan, nothing is required: moving one run shouldn't need a
    questionnaire. Without days, the days check is skipped; without sessions a
    week, no week may grow past the plan's busiest week."""
    prof = (store.get_profile() if hasattr(store, "get_profile") else None) or {}
    days = available_days or prof.get("preferred_days") or None
    if days is not None:
        if not isinstance(days, list):
            raise ValueError("available_days must be a list of weekday names")
        days = _weekdays(days)
    spw = sessions_per_week if sessions_per_week not in (None, "") else prof.get("sessions_per_week")
    spw = _int(spw, "sessions_per_week", 1, 14) if spw is not None else None
    if injury_or_pain in (None, ""):
        injuries = prof.get("injuries") or []
        injury_or_pain = "; ".join(i["body_part"] for i in injuries) if injuries else "none"
        if pain_level is None:
            known = [i["pain"] for i in injuries if i.get("pain") is not None]
            pain_level = max(known) if known else None
    pain_text = _text(injury_or_pain, "injury_or_pain", 200)
    said = user_said or []
    if not isinstance(said, list) or len(said) > 5:
        raise ValueError("user_said must be a list of at most 5 short quotes")
    return {"available_days": days, "sessions_per_week": spw, "injury_or_pain": pain_text,
            "pain_level": _int(pain_level, "pain_level", 0, 10) if pain_level is not None else None,
            "user_said": [_text(s, "a user_said quote", 80) for s in said]}


def _has_pain(ctx: dict) -> bool:
    return ctx["injury_or_pain"].strip().lower() not in ("none", "no", "nothing")


class _Draft:
    """The plan as it would be after the changes, built in memory one change
    at a time, so each change sees the ones before it (a day freed by one
    move can take the next)."""

    def __init__(self, store, plan: dict, today: date):
        self.plan, self.today = plan, today
        self.start = _date(plan["start_date"], "start_date")
        self.weeks = int(plan["weeks"])
        self.meta = _week_meta(plan.get("week_meta"), self.weeks)
        self.original = store.planned_sessions(plan_id=plan["id"])
        self.rows = {p["id"]: json.loads(json.dumps(p)) for p in self.original}
        self.added: list[dict] = []
        self.reduced: dict[int, int] = {}  # weeks the changes made lighter: week now -> week before
        self.gaps: set[int] = set()  # break weeks a shift inserted, as numbered now
        # One-offs share the days: they hold slots too.
        last = (self.start + timedelta(days=7 * MAX_WEEKS - 1)).isoformat()
        self.others = [p for p in store.planned_sessions(since=self.start.isoformat(), until=last)
                       if p.get("plan_id") != plan["id"]]
        pause = store.active_pause() if hasattr(store, "active_pause") else None
        self.blocking = [pause] if pause and pause.get("reason") in ("injury", "illness") else []
        self.templates = store.templates() if hasattr(store, "templates") else []
        self.gyms = store.gyms() if hasattr(store, "gyms") else []

    # -- helpers --
    def view(self) -> dict:
        return {**self.plan, "weeks": self.weeks, "week_meta": self.meta}

    def all(self) -> list[dict]:
        return [*self.rows.values(), *self.added]

    def label(self, r: dict) -> str:
        """"Thursday's Easy run" in the coming week, else "the Easy run on Thursday 3 Dec"."""
        when = _when(r["date"], self.today)
        return f"{when}'s {r['title']}" if " " not in when else f"the {r['title']} on {when}"

    def session(self, planned_id, verb: str, *, open_only: bool = True) -> dict:
        r = self.rows.get(planned_id)
        if r is None:
            raise ValueError(f"planned session {planned_id!r} isn't in this plan (get_plan has the ids)")
        if open_only and r.get("session_id"):
            raise ValueError(f"{r['title']} on {r['date']} is done (a logged session counts for it), "
                             f"so it can't be {verb}")
        if open_only and r.get("status") == "skipped":
            raise ValueError(f"{r['title']} on {r['date']} is already skipped")
        return r

    def lightened(self, week: int) -> None:
        """`week` (as numbered now) has less than before the changes."""
        if week not in self.reduced:
            self.reduced[week] = week - sum(1 for g in self.gaps if g < week)

    def check_day(self, day: str) -> None:
        d = _date(day, "date")
        if d < self.today:
            raise ValueError(f"{day} is in the past: plan only today or later")
        if week_index(self.view(), d) is None:
            raise ValueError(f"{day} is outside the plan ({self.plan['start_date']} to "
                             f"{plan_end(self.view()).isoformat()})")
        if self.blocking and _paused(d, self.blocking):
            raise ValueError(f"{day} falls inside the user's {self.blocking[0]['reason']} pause: plan nothing "
                             "there, and never diagnose")

    def slot(self, day: str, row: dict | None = None, prefer: int | None = None, strict: bool = False) -> int:
        used = {r["slot"] for r in [*self.all(), *self.others] if r["date"] == day and r is not row}
        if prefer is not None:
            prefer = _int(prefer, "slot", 0, PER_DAY - 1)
            if prefer not in used:
                return prefer
            if strict:
                raise ValueError(f"slot {prefer} on {day} is taken")
        free = [s for s in range(PER_DAY) if s not in used]
        if not free:
            raise ValueError(f"at most {PER_DAY} planned sessions a day ({day})")
        return free[0]

    # -- the changes --
    def apply(self, change) -> tuple[dict, str]:
        """Apply one change; returns it normalised and its one-line description."""
        if not isinstance(change, dict):
            raise ValueError("each change must be an object")
        kind = change.get("type")
        if kind not in CHANGE_TYPES:
            raise ValueError(f"a change's type must be one of {CHANGE_TYPES}, got {kind!r}")
        allowed = {"move": {"planned_id", "date", "slot"}, "remove": {"planned_id", "reason"},
                   "add": {"session"}, "edit": {"planned_id", "title", "target"},
                   "lighter": {"week", "sessions"}, "shift": {"days", "from_date"}}[kind]
        unknown = set(change) - allowed - {"type"}
        if unknown:
            raise ValueError(f"unknown fields for a {kind} change: {sorted(unknown)}")
        return getattr(self, f"_{kind}")(change)

    def _move(self, c: dict) -> tuple[dict, str]:
        r = self.session(c.get("planned_id"), "moved")
        new_day = _date(c.get("date") or r["date"], "date").isoformat()
        if new_day == r["date"] and c.get("slot") in (None, r["slot"]):
            raise ValueError(f"moving {r['title']} on {r['date']} changes nothing")
        self.check_day(new_day)
        old = dict(r)
        if week_index(self.view(), new_day) != week_index(self.view(), old["date"]):
            self.lightened(week_index(self.view(), old["date"]))
        r["slot"] = self.slot(new_day, r, c.get("slot"), strict=c.get("slot") is not None)
        r["date"] = new_day
        out = {"type": "move", "planned_id": r["id"], "date": new_day}
        if c.get("slot") is not None:
            out["slot"] = r["slot"]
        if new_day == old["date"]:
            text = f"Do {self.label(old)} {'first' if r['slot'] == 0 else 'second'} that day"
        elif monday(_date(new_day, "date")) == monday(_date(old["date"], "date")):
            text = f"Move {self.label(old)} to {WEEKDAYS[_date(new_day, 'date').weekday()].title()}"
        else:
            text = f"Move {self.label(old)} to {_when(new_day, self.today)}"
        return out, text

    def _remove(self, c: dict) -> tuple[dict, str]:
        r = self.session(c.get("planned_id"), "removed")
        reason = _text(c.get("reason"), "reason", 200, optional=True)
        text = f"Skip {self.label(r)}"
        self.lightened(week_index(self.view(), r["date"]))
        r.update(status="skipped", skip_reason=reason)
        out = {"type": "remove", "planned_id": r["id"]}
        if reason:
            out["reason"] = reason
        return out, text

    def _add(self, c: dict) -> tuple[dict, str]:
        row = validate_planned(c.get("session"), self.templates, self.gyms, plan=self.view())
        self.check_day(row["date"])
        row = {**row, "id": None, "plan_id": self.plan["id"], "status": "planned", "skip_reason": None,
               "session_id": None}
        row["slot"] = self.slot(row["date"], row)
        self.added.append(row)
        out = {"type": "add", "session": {k: row[k] for k in ("date", "sport", "template_id", "title", "target")}}
        return out, f"Add {row['title']} on {_when(row['date'], self.today)} ({_target_text(row['target'])})"

    def _edit(self, c: dict) -> tuple[dict, str]:
        r = self.session(c.get("planned_id"), "edited", open_only=False)
        if c.get("title") is None and c.get("target") is None:
            raise ValueError("an edit changes the title, the target or both")
        merged = {k: r[k] for k in ("date", "sport", "template_id", "title", "target")}
        merged |= {k: c[k] for k in ("title", "target") if c.get(k) is not None}
        row = validate_planned(merged, self.templates, self.gyms, keep_template=r.get("template_id"))
        if row["title"] == r["title"] and row["target"] == r["target"]:
            raise ValueError(f"editing {r['title']} on {r['date']} changes nothing")
        if row["title"] != r["title"] and row["target"] != r["target"]:
            text = f"Rename {self.label(r)} to {row['title']}, {_target_text(row['target'])}"
        elif row["title"] != r["title"]:
            text = f"Rename {self.label(r)} to {row['title']}"
        else:
            text = f"Change {self.label(r)} to {_target_text(row['target'])}"
        r.update(title=row["title"], target=row["target"])
        out = {"type": "edit", "planned_id": r["id"]}
        out |= {k: row[k] for k in ("title", "target") if c.get(k) is not None}
        return out, text

    def _lighter(self, c: dict) -> tuple[dict, str]:
        """Fewer or shorter sessions at the same or lower effort (L2). How much
        lighter has no sourced number (deload_factor), so none is applied: the
        week only has to end up with less planned load than before."""
        week = _int(c.get("week"), "week", 1, self.weeks)
        week_start = self.start + timedelta(days=7 * (week - 1))
        if week_start + timedelta(days=6) < self.today:
            raise ValueError(f"week {week} is over")
        items = c.get("sessions")
        if not isinstance(items, list) or not items:
            raise ValueError("a lighter week lists the sessions to skip or shorten")

        def load() -> int:
            return sum(planned_load(r["target"]) or 0 for r in self.all()
                       if r.get("status") != "skipped" and week_index(self.view(), r["date"]) == week)

        before, parts, out_items = load(), [], []
        for it in items:
            if not isinstance(it, dict) or set(it) - {"planned_id", "remove", "duration_min", "effort", "distance_km"}:
                raise ValueError("each lighter-week session has planned_id and remove, or a shorter "
                                 "duration_min, distance_km or a lower effort")
            r = self.session(it.get("planned_id"), "made lighter")
            if week_index(self.view(), r["date"]) != week:
                raise ValueError(f"{r['title']} on {r['date']} isn't in week {week}")
            if it.get("remove"):
                parts.append(f"skip {self.label(r)}")
                r.update(status="skipped", skip_reason="lighter week")
                out_items.append({"planned_id": r["id"], "remove": True})
                continue
            target, changed, item = dict(r["target"]), [], {"planned_id": r["id"]}
            for key in ("duration_min", "distance_km", "effort"):
                if it.get(key) is None:
                    continue
                new = validate_target(r["sport"], {key: it[key]})[key]
                old = target.get(key)
                if old is None:
                    raise ValueError(f"{r['title']} on {r['date']} has no planned {key} to lower")
                if new > old:
                    raise ValueError(f"a lighter week never raises {key} ({r['title']} on {r['date']}: "
                                     f"{old:g} to {new:g})")
                if new < old:
                    unit = {"duration_min": " min", "distance_km": " km", "effort": ""}[key]
                    changed.append(f"{'effort ' if key == 'effort' else ''}{old:g} → {new:g}{unit}")
                    target[key] = new
                    item[key] = new
            if not changed:
                raise ValueError(f"{r['title']} on {r['date']}: nothing gets lighter")
            parts.append(f"{self.label(r)} {', '.join(changed)}")
            r["target"] = target
            out_items.append(item)
        if before and load() >= before:
            raise ValueError(f"week {week}'s planned load ({load()}) isn't below what it was ({before})")
        if self.meta[week - 1]["kind"] == "build":
            self.meta[week - 1] = {"index": week, "kind": "deload", "note": "lighter week"}
        self.lightened(week)
        return ({"type": "lighter", "week": week, "sessions": out_items},
                f"Make week {week} lighter: {'; '.join(parts)}")

    def _shift(self, c: dict) -> tuple[dict, str]:
        """Move every remaining open session N days later, e.g. after a pause.
        Done and skipped ones stay. The plan grows if it must (at most 12
        weeks); a shift by whole weeks moves the week kinds too, and the
        weeks it opens up are lighter weeks (the break)."""
        days = _int(c.get("days"), "days", 1, MAX_SHIFT_DAYS)
        frm = max(_date(c.get("from_date") or self.today, "from_date"), self.today)
        moving = sorted((r for r in self.all() if _date(r["date"], "date") >= frm
                         and not r.get("session_id") and r.get("status") != "skipped"),
                        key=lambda r: (r["date"], r["slot"]))
        if not moving:
            raise ValueError(f"no open planned sessions from {frm.isoformat()} to shift")
        last = max(_date(r["date"], "date") for r in moving) + timedelta(days=days)
        need = (last - self.start).days // 7 + 1
        if need > MAX_WEEKS:
            raise ValueError(f"shifting by {days} days makes the plan {need} weeks long; at most {MAX_WEEKS}")
        old_weeks, first_week = self.weeks, week_index(self.view(), moving[0]["date"])
        self.weeks = max(self.weeks, need)
        if days % 7 == 0:
            # The break: lighter weeks where the shift opens a gap. A week that keeps
            # some sessions (done, skipped or earlier) keeps its kind, and the gap
            # follows it; otherwise the gap takes its place.
            shifting = {id(r) for r in moving}
            keeps = any(week_index(self.view(), r["date"]) == first_week
                        for r in self.all() if id(r) not in shifting)
            at = first_week if keeps else first_week - 1
            k = days // 7
            gap = [{"index": 0, "kind": "deload", "note": "break"}] * k
            meta = self.meta[:at] + gap + self.meta[at:]
            self.reduced = {(w + k if w > at else w): old for w, old in self.reduced.items()}
            self.gaps = {g + k if g > at else g for g in self.gaps} | set(range(at + 1, at + k + 1))
            if keeps:
                self.lightened(first_week)
        else:
            meta = list(self.meta)
            self.lightened(first_week)
        meta += [{"index": 0, "kind": "build", "note": None}] * max(0, self.weeks - len(meta))
        self.meta = [{**w, "index": i + 1} for i, w in enumerate(meta[:self.weeks])]
        targets = [(_date(r["date"], "date") + timedelta(days=days)).isoformat() for r in moving]
        for r in moving:  # off the calendar while they're placed again
            r["date"] = ""
        for r, day in zip(moving, targets):
            self.check_day(day)
            r["slot"] = self.slot(day, r, r["slot"])
            r["date"] = day
        when = ("a week" if days == 7 else f"{days // 7} weeks" if days % 7 == 0
                else "a day" if days == 1 else f"{days} days")
        text = f"Move the remaining {len(moving)} session{'s' if len(moving) != 1 else ''} {when} later"
        if self.weeks > old_weeks:
            end = plan_end(self.view())
            text += f" (the plan now ends {end.day} {_MONTHS[end.month - 1]})"
        out = {"type": "shift", "days": days}
        if c.get("from_date"):
            out["from_date"] = frm.isoformat()
        return out, text

    # -- the result --
    def writes(self) -> tuple[dict, list[tuple[int, dict]], list[dict]]:
        """What Accept stores: plan fields, session updates, new sessions."""
        plan_changes = {}
        if self.weeks != int(self.plan["weeks"]):
            plan_changes["weeks"] = self.weeks
        if self.meta != _week_meta(self.plan.get("week_meta"), int(self.plan["weeks"])):
            plan_changes["week_meta"] = self.meta
        updates = []
        for p in self.original:
            r = self.rows[p["id"]]
            changed = {k: r.get(k) for k in _WRITABLE if r.get(k) != p.get(k)}
            if changed:
                updates.append((p["id"], changed))
        inserts = [{k: r[k] for k in ("date", "slot", "sport", "template_id", "title", "target")}
                   for r in self.added]
        return plan_changes, updates, inserts


def _per_week(plan: dict, rows: list[dict]) -> dict[int, int]:
    out: dict[int, int] = {}
    for r in rows:
        w = week_index(plan, r["date"])
        if w is not None:
            out[w] = out.get(w, 0) + 1
    return out


def _guardrails(store, before_plan: dict, before: list[dict], after_plan: dict, after: list[dict],
                ctx: dict, today: date, reduced: dict[int, int] | None = None) -> tuple[list[str], list[str]]:
    """The new plan's checks (_check_proposal, the quality rule, L1a, L1b, L2)
    on the plan before and after the changes. Returns the problems the changes
    add, which refuse the proposal, and the new notes."""
    before = [r for r in before if r.get("status") != "skipped"]
    after = [r for r in after if r.get("status") != "skipped"]
    reduced = reduced or {}
    pain = _has_pain(ctx)
    check_ctx = {"available_days": ctx["available_days"] or list(WEEKDAYS),
                 "sessions_per_week": ctx["sessions_per_week"] or 14}
    since = (min(_date(before_plan["start_date"], "start_date"), today) - timedelta(days=45)).isoformat()
    history = store.sessions_since(since) if hasattr(store, "sessions_since") else []

    def problems(plan, rows, reduced_km=None):
        found = _check_proposal(rows, check_ctx, plan) + quality_check(rows, plan, pain, ctx["pain_level"])[0]
        checks = check_rules(plan, rows, history, today, pain=pain, reduced=reduced_km, l2_in_a_row=True)
        return found + checks["violations"], checks["notes"] + intensity(rows, plan)["notes"], checks

    old_problems, old_notes, old_checks = problems(before_plan, before)
    km_before = old_checks["weekly_running_km"]
    reduced_km = {w: km_before[old - 1] if 0 < old <= len(km_before) else 0.0 for w, old in reduced.items()}
    new_problems, new_notes, _ = problems(after_plan, after, reduced_km)
    added = _new_ones(old_problems, new_problems)
    if ctx["sessions_per_week"] is None:  # no week busier than the plan's busiest so far
        was, now = _per_week(before_plan, before), _per_week(after_plan, after)
        cap = max(was.values(), default=0)
        added += [f"week {w} would have {n} sessions, more than the plan's busiest week ({cap})"
                  for w, n in sorted(now.items()) if n > cap and n > was.get(w, 0)]
    return added, _new_ones(old_notes, new_notes)


def _new_ones(old: list[str], new: list[str]) -> list[str]:
    """The messages in `new` that `old` didn't have, counted, with dates and
    week numbers left out: moving a session that already broke a rule to
    another day moves the problem, it doesn't add one; a second one does."""
    def key(text: str) -> str:  # a shift renumbers weeks too
        text = re.sub(r"\d{4}-\d{2}-\d{2}", "<day>", text)
        return re.sub(r"(?<![a-z])weeks? \d+", "week <n>", text)
    seen = Counter(map(key, old))
    out = []
    for text in new:
        if seen[key(text)]:
            seen[key(text)] -= 1
        else:
            out.append(text)
    return out


def _evaluate(store, plan: dict, changes, ctx: dict, today: date) -> dict:
    if plan["status"] not in CURRENT:
        raise ValueError("this plan has ended; changes only apply to the current plan")
    if not isinstance(changes, list) or not changes:
        raise ValueError("changes must be a list with at least one change")
    if len(changes) > MAX_CHANGES:
        raise ValueError(f"at most {MAX_CHANGES} changes at once")
    draft = _Draft(store, plan, today)
    before_plan = {**plan, "week_meta": list(draft.meta)}  # a lighter week edits draft.meta
    applied = []
    for i, change in enumerate(changes, 1):
        try:
            applied.append(draft.apply(change))
        except ValueError as e:
            raise ValueError(f"change {i}: {e}") from None
    after_plan = draft.view()
    problems, notes = _guardrails(store, before_plan, draft.original, after_plan, draft.all(), ctx, today,
                                  draft.reduced)
    if problems:
        raise ValueError("the changes break the plan's rules; change only what the user asked, within "
                         "the rules, or tell them plainly what can't be done: " + "; ".join(problems))
    return {"draft": draft, "applied": applied, "before_plan": before_plan, "after_plan": after_plan,
            "notes": notes}


def propose_plan_change(store, today: date | None = None, *, changes=None, reason=None, plan_id=None,
                        available_days=None, sessions_per_week=None, injury_or_pain=None,
                        pain_level=None, user_said=None) -> dict:
    """Changes to the current plan, as the coach proposes them: validated and
    checked against the same guardrails as a new plan, never stored. The app
    shows only the changes, each with a one-line description; Accept applies
    all of them or the ones the user picked (apply_plan_change)."""
    today = today or date.today()
    current = current_plan(store) if hasattr(store, "plans") else None
    if current is None:
        raise ValueError("the user has no current plan, so there is nothing to change; propose a new "
                         "plan with propose_program only if they ask for one")
    if plan_id is not None and plan_id != current["id"]:
        raise ValueError(f"plan {plan_id} isn't the current plan ({current['id']}, {current['name']!r})")
    reason = _text(reason, "reason", 200)
    ctx = _change_context(store, available_days, sessions_per_week, injury_or_pain, pain_level, user_said)
    ev = _evaluate(store, current, changes, ctx, today)
    draft, after = ev["draft"], ev["after_plan"]
    version = plan_version(current, draft.original)
    warnings = list(ev["notes"])
    if any(c["type"] == "lighter" for c, _ in ev["applied"]):
        warnings.append("How much lighter has no sourced number yet (L2b, needs source): this is "
                        "fewer or shorter sessions at the same or lower effort.")
    notes = ["only the changes listed here are proposed; never call them saved or applied until the "
             "user accepts", "never change the goal without asking"]
    if _has_pain(ctx):
        notes.append("the user mentioned injury or pain: propose less, never more, never diagnose, and "
                     "suggest a physiotherapist or doctor if it persists or gets worse")
    public_ctx = {k: v for k, v in ctx.items() if v not in (None, [])}
    return {
        "change_proposal": True, "stored": False,
        "plan": {"id": current["id"], "name": current["name"], "start_date": current["start_date"],
                 "weeks": after["weeks"], "end_date": plan_end(after).isoformat()},
        "version": version, "reason": reason,
        "changes": [{"index": i, "type": c["type"], "label": CHANGE_LABEL[c["type"]], "description": text}
                    for i, (c, text) in enumerate(ev["applied"])],
        "warnings": warnings, "notes": notes,
        "weekly_before": weekly_load(ev["before_plan"], draft.original),
        "weekly_after": weekly_load(after, draft.all()),
        # What the app sends to POST /plans/{id}/changes on Accept: all of
        # `changes`, or the ones the user ticked in Review.
        "accept": {"version": version, "changes": [c for c, _ in ev["applied"]], "context": public_ctx},
        "context": public_ctx,
        "rules_applied": [f"{v['rule']}: {v['text']} [{v['source']}]" for v in _SOURCED.values()],
    }


def apply_plan_change(store, plan_id: int, version: str, changes, context: dict | None = None,
                      today: date | None = None) -> dict:
    """Apply an accepted change proposal (all its changes, or the ones the user
    picked) in one transaction. RuntimeError (409) if the plan changed since
    the proposal; ValueError (422) if the changes, or the subset picked, break
    the guardrails; LookupError (404) for an unknown plan."""
    today = today or date.today()
    plan = next((p for p in store.plans() if p["id"] == plan_id), None)
    if plan is None:
        raise LookupError(f"plan {plan_id} not found")
    if plan_version(plan, store.planned_sessions(plan_id=plan_id)) != version:
        raise RuntimeError("the plan has changed since this proposal; ask the coach again")
    context = context or {}
    if not isinstance(context, dict) or set(context) - {"available_days", "sessions_per_week", "injury_or_pain",
                                                         "pain_level", "user_said"}:
        raise ValueError("context has unknown fields")
    ctx = _change_context(store, **context)
    ev = _evaluate(store, plan, changes, ctx, today)
    plan_changes, updates, inserts = ev["draft"].writes()
    store.apply_plan_changes(plan_id, version, plan_version, plan_changes, updates, inserts)
    return {"plan": get_plan(store, plan_id, today), "applied": [text for _, text in ev["applied"]]}
