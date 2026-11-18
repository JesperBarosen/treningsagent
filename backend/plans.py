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

# Load rules (docs/training-plans.md section 5). Placeholders: the values come
# from the sources in docs/design-research.md once they are reviewed. Nothing
# in #116 enforces them; the coach's tools (#119) turn them into warnings.
RULES: dict[str, dict] = {
    name: {"value": None, "status": "needs source"}
    for name in ("max_run_vs_longest_30d", "max_weekly_run_increase", "max_weekly_increase",
                 "deload_every", "deload_factor", "taper_weeks", "taper_factor",
                 "max_hard_days_in_a_row", "finger_rest_days", "return_start_factor",
                 "replan_threshold")
}


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
    duration_min, effort (1-10); distance_km (running); grades (climbing,
    a list of grade targets); values (template field values, as in a session)."""
    target = {} if target is None else target
    if not isinstance(target, dict):
        raise ValueError("target must be an object")
    allowed = {"duration_min", "effort"}
    allowed |= {"distance_km"} if sport == "running" else set()
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


def get_plan(store, plan_id: int) -> dict:
    plan = next((p for p in store.plans() if p["id"] == plan_id), None)
    if plan is None:
        raise LookupError(f"plan {plan_id} not found")
    return with_sessions(plan, store.planned_sessions(plan_id=plan_id))


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
