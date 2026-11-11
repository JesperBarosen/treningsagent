"""The tool functions the agent can call, and their validation.

Storage is passed in as a Store, so these functions never touch a database
directly and can be tested offline. Only raw, user-reported facts are stored.
Derived values (pace, load) are computed when history is read, so they can
never go stale or disagree.
"""

import json
from datetime import date, timedelta
from typing import Protocol

import progression

SPORTS = ("running", "climbing")
RUNNING_FIELDS = ("distance_km", "elevation_m")
# The gym's colour scale, easiest first. A grade's ordinal is its position + 1.
GRADES = ("yellow", "green", "blue", "purple", "red", "black", "white")
CLIMB_STYLES = ("boulder", "kilter", "rope")


class Store(Protocol):
    """Where sessions are kept. db.PostgresStore in the app, a fake in tests."""

    def insert_session(self, row: dict, climbs: list[dict] = ()) -> int: ...
    def sessions_since(self, since: str) -> list[dict]: ...
    def climbs_since(self, since: str) -> list[dict]: ...
    def log_model_call(self, call: dict) -> None: ...


def log_session(
    store: Store,
    sport: str,
    date: str,
    duration_min: int,
    effort: int,
    notes: str | None = None,
    climbs: list[dict] | None = None,
    **sport_fields,
) -> dict:
    """Validate and store one session, and for climbing its individual climbs,
    in one go. Returns the stored session with its id."""
    if sport not in SPORTS:
        raise ValueError(f"sport must be one of {SPORTS}, got {sport!r}")
    _parse_date(date)
    if duration_min <= 0:
        raise ValueError("duration_min must be positive")
    if not 1 <= effort <= 10:
        raise ValueError("effort must be between 1 and 10")

    allowed = RUNNING_FIELDS if sport == "running" else ()
    unexpected = set(sport_fields) - set(allowed)
    if unexpected:
        raise ValueError(f"fields not valid for {sport}: {sorted(unexpected)}")
    if climbs and sport != "climbing":
        raise ValueError("climbs can only be logged for climbing sessions")
    climb_rows = [_climb_row(c) for c in climbs or []]

    row = {"sport": sport, "date": date, "duration_min": duration_min,
           "effort": effort, "notes": notes, **sport_fields}
    session_id = store.insert_session(row, climb_rows)
    result = {"id": session_id, **row}
    if climb_rows:
        result["climbs"] = climb_rows
    return result


def _climb_row(climb: dict) -> dict:
    """Validate one climb and add its grade ordinal."""
    unexpected = set(climb) - {"grade", "attempts", "sent", "style", "notes"}
    if unexpected:
        raise ValueError(f"unknown climb fields: {sorted(unexpected)}")
    grade = str(climb.get("grade", "")).strip().lower()
    if grade not in GRADES:
        raise ValueError(f"climb grade must be one of {GRADES}, got {climb.get('grade')!r}")
    if climb.get("style") not in CLIMB_STYLES:
        raise ValueError(f"climb style must be one of {CLIMB_STYLES}, got {climb.get('style')!r}")
    if not isinstance(climb.get("sent"), bool):
        raise ValueError("climb sent must be true or false")
    attempts = climb.get("attempts")
    if attempts is not None and (not isinstance(attempts, int) or attempts < 1):
        raise ValueError("climb attempts must be a positive integer")
    return {"grade": grade, "grade_ordinal": GRADES.index(grade) + 1,
            "attempts": attempts, "sent": climb["sent"], "style": climb["style"],
            "notes": climb.get("notes")}


def get_history(store: Store, days: int, today: date | None = None) -> list[dict]:
    """Sessions from the last `days` days (today included), oldest first,
    with derived metrics computed on the fly."""
    if days < 1:
        raise ValueError("days must be at least 1")
    today = today or date.today()
    since = (today - timedelta(days=days - 1)).isoformat()
    climbs_by_session: dict[int, list[dict]] = {}
    for c in store.climbs_since(since):
        climb = {k: v for k, v in c.items() if v is not None and k not in ("id", "session_id")}
        climbs_by_session.setdefault(c["session_id"], []).append(climb)

    sessions = []
    for row in store.sessions_since(since):
        s = {k: v for k, v in row.items() if v is not None}
        if s["id"] in climbs_by_session:
            s["climbs"] = climbs_by_session[s["id"]]
        s.update(derived_metrics(s))
        sessions.append(s)
    return sessions


def session_load(session: dict) -> int:
    """Session-RPE load (Foster et al. 2001): minutes x perceived effort (1-10)."""
    return session["duration_min"] * session["effort"]


def get_training_load(store: Store, weeks: int = 4, today: date | None = None) -> dict:
    """Session-RPE load per day and per calendar week (Monday start) across all
    sports, for the current week and the `weeks - 1` before it, plus the
    acute:chronic workload ratio: average daily load over the last 7 days
    divided by the average over the last 28 (today included in both)."""
    if not 1 <= weeks <= 12:
        raise ValueError("weeks must be between 1 and 12")
    today = today or date.today()
    start = today - timedelta(days=today.weekday() + 7 * (weeks - 1))
    chronic_start = today - timedelta(days=27)
    sessions = store.sessions_since(min(start, chronic_start).isoformat())

    by_day: dict[date, int] = {}
    for s in sessions:
        d = _parse_date(s["date"])
        by_day[d] = by_day.get(d, 0) + session_load(s)

    def days_from(first: date):
        return (first + timedelta(days=i) for i in range((today - first).days + 1))

    weekly = []
    for i in range(weeks):
        week_start = start + timedelta(days=7 * i)
        week = [s for s in sessions
                if week_start <= _parse_date(s["date"]) < week_start + timedelta(days=7)]
        by_sport: dict[str, int] = {}
        for s in week:
            by_sport[s["sport"]] = by_sport.get(s["sport"], 0) + session_load(s)
        weekly.append({"week_start": week_start.isoformat(), "load": sum(by_sport.values()),
                       "sessions": len(week), "load_by_sport": by_sport})

    acute = sum(by_day.get(d, 0) for d in days_from(today - timedelta(days=6))) / 7
    chronic = sum(by_day.get(d, 0) for d in days_from(chronic_start)) / 28
    return {
        "daily": [{"date": d.isoformat(), "load": by_day.get(d, 0)} for d in days_from(start)],
        "weekly": weekly,
        "acute_7d_avg": round(acute, 1),
        "chronic_28d_avg": round(chronic, 1),
        "acute_chronic_ratio": round(acute / chronic, 2) if chronic else None,
    }


def calculate_progression(store: Store, weeks: int = 8, today: date | None = None) -> dict:
    """Per-sport progression for the current calendar week (Monday start,
    partial) and the `weeks - 1` before it, with a trend per metric. See
    progression.py for the metrics and the trend rule."""
    if not 1 <= weeks <= 26:
        raise ValueError("weeks must be between 1 and 26")
    today = today or date.today()
    start = today - timedelta(days=today.weekday() + 7 * (weeks - 1))
    windows = progression.Windows(today)
    since = min(start, windows.baseline_start).isoformat()
    shown = [start + timedelta(days=7 * i) for i in range(weeks)]
    result = progression.calculate(store.sessions_since(since), store.climbs_since(since),
                                   shown, today)
    result["climbing"]["grade_scale"] = list(GRADES)
    return {"weeks": weeks, "today": today.isoformat(),
            "trend_rule": progression.TREND_RULE, **result}


def derived_metrics(session: dict) -> dict:
    """Values computed from stored facts. Never written to the database."""
    metrics = {"load": session_load(session)}
    if session.get("distance_km"):
        metrics["pace_min_per_km"] = round(session["duration_min"] / session["distance_km"], 2)
    climbs = session.get("climbs", [])
    if climbs:
        sent = [c for c in climbs if c["sent"]]
        metrics["climbs_sent"] = len(sent)
        if sent:
            metrics["hardest_sent_grade"] = max(sent, key=lambda c: c["grade_ordinal"])["grade"]
    return metrics


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"date must be YYYY-MM-DD, got {value!r}") from None


# JSON schemas sent to Claude. The descriptions are prompts: they tell the
# model when and how to call each tool.
TOOLS = [
    {
        "name": "log_session",
        "description": (
            "Store one completed training session. Call this when the user describes "
            "a workout they did. Only include fields the user actually stated; never "
            "guess numbers. Use running fields only for running. For climbing, list "
            "each climb the user mentions in `climbs`, all in this one call."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sport": {"type": "string", "enum": list(SPORTS)},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "duration_min": {"type": "integer", "minimum": 1},
                "effort": {"type": "integer", "minimum": 1, "maximum": 10,
                           "description": "Perceived effort (RPE), 1 = very easy, 10 = max"},
                "notes": {"type": "string"},
                "distance_km": {"type": "number", "description": "Running only"},
                "elevation_m": {"type": "integer", "description": "Running only: elevation gain"},
                "climbs": {
                    "type": "array",
                    "description": "Climbing only: one item per climb the user mentions. "
                                   "'3 blues' is three items.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "grade": {"type": "string", "enum": list(GRADES),
                                      "description": "Gym colour, easiest to hardest: "
                                                     + ", ".join(GRADES)},
                            "style": {"type": "string", "enum": list(CLIMB_STYLES),
                                      "description": "boulder = gym boulder, kilter = Kilter "
                                                     "board, rope = top rope or lead"},
                            "sent": {"type": "boolean",
                                     "description": "true if topped, false if not (yet)"},
                            "attempts": {"type": "integer", "minimum": 1,
                                         "description": "Only if the user said; a flash is 1"},
                            "notes": {"type": "string"},
                        },
                        "required": ["grade", "style", "sent"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["sport", "date", "duration_min", "effort"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_history",
        "description": (
            "Get logged sessions from the last N days, including computed load "
            "(minutes x effort), running pace, and for climbing the individual climbs "
            "with the hardest sent grade. Use this before answering questions about "
            "past training or climbing progression."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "minimum": 1}},
            "required": ["days"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_training_load",
        "description": (
            "Get training load across all sports: session-RPE load (minutes x effort, "
            "Foster et al. 2001) per day and per calendar week (Monday start, current week "
            "is partial), and the acute:chronic workload ratio (average daily load over "
            "the last 7 days / last 28 days). Use this when the user asks about load, "
            "fatigue, how hard a week was, whether to train harder or rest, or injury "
            "risk. Ratios around 0.8-1.3 are commonly cited as a moderate range and above "
            "~1.5 as a sharp spike (Gabbett 2016); treat this as a rough guide, not a "
            "prediction. The ratio is unreliable until about 4 weeks have been logged."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"weeks": {"type": "integer", "minimum": 1, "maximum": 12,
                                     "description": "Calendar weeks to show, default 4"}},
            "additionalProperties": False,
        },
    },
]


def run_tool(store: Store, name: str, tool_input: dict) -> str:
    """Dispatch a tool call from Claude and return the result as JSON text."""
    if name == "log_session":
        result = log_session(store, **tool_input)
    elif name == "get_history":
        result = get_history(store, **tool_input)
    elif name == "get_training_load":
        result = get_training_load(store, **tool_input)
    else:
        raise ValueError(f"unknown tool {name!r}")
    return json.dumps(result)
