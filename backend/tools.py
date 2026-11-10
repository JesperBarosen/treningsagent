"""Training-session storage and the tool functions the agent can call.

Only raw, user-reported facts are stored. Derived values (pace, load) are
computed when history is read, so they can never go stale or disagree.
"""

import json
import sqlite3
from datetime import date, timedelta

SPORTS = ("running", "climbing")
CLIMBING_STYLES = ("boulder", "lead", "top_rope")
RUNNING_FIELDS = ("distance_km", "elevation_m")
CLIMBING_FIELDS = ("climbing_style", "hardest_grade", "routes_count")

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id             INTEGER PRIMARY KEY,
    sport          TEXT    NOT NULL CHECK (sport IN ('running', 'climbing')),
    date           TEXT    NOT NULL,              -- ISO date, YYYY-MM-DD
    duration_min   INTEGER NOT NULL CHECK (duration_min > 0),
    effort         INTEGER NOT NULL CHECK (effort BETWEEN 1 AND 10),
    notes          TEXT,
    -- running only
    distance_km    REAL    CHECK (distance_km > 0),
    elevation_m    INTEGER CHECK (elevation_m >= 0),
    -- climbing only
    climbing_style TEXT    CHECK (climbing_style IN ('boulder', 'lead', 'top_rope')),
    hardest_grade  TEXT,
    routes_count   INTEGER CHECK (routes_count >= 0)
)
"""


def connect(path: str) -> sqlite3.Connection:
    """Open the database and make sure the table exists."""
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row  # rows behave like dicts
    conn.execute(SCHEMA)
    return conn


def log_session(
    conn: sqlite3.Connection,
    sport: str,
    date: str,
    duration_min: int,
    effort: int,
    notes: str | None = None,
    **sport_fields,
) -> dict:
    """Validate and store one session. Returns the stored session with its id."""
    if sport not in SPORTS:
        raise ValueError(f"sport must be one of {SPORTS}, got {sport!r}")
    _parse_date(date)
    if duration_min <= 0:
        raise ValueError("duration_min must be positive")
    if not 1 <= effort <= 10:
        raise ValueError("effort must be between 1 and 10")

    allowed = RUNNING_FIELDS if sport == "running" else CLIMBING_FIELDS
    unexpected = set(sport_fields) - set(allowed)
    if unexpected:
        raise ValueError(f"fields not valid for {sport}: {sorted(unexpected)}")
    style = sport_fields.get("climbing_style")
    if style is not None and style not in CLIMBING_STYLES:
        raise ValueError(f"climbing_style must be one of {CLIMBING_STYLES}")

    row = {"sport": sport, "date": date, "duration_min": duration_min,
           "effort": effort, "notes": notes, **sport_fields}
    columns = ", ".join(row)
    placeholders = ", ".join("?" for _ in row)  # parameterized: no SQL injection
    with conn:  # commits on success, rolls back on error
        cur = conn.execute(
            f"INSERT INTO sessions ({columns}) VALUES ({placeholders})",
            tuple(row.values()),
        )
    return {"id": cur.lastrowid, **row}


def get_history(conn: sqlite3.Connection, days: int, today: date | None = None) -> list[dict]:
    """Sessions from the last `days` days (today included), oldest first,
    with derived metrics computed on the fly."""
    if days < 1:
        raise ValueError("days must be at least 1")
    today = today or date.today()
    since = (today - timedelta(days=days - 1)).isoformat()
    rows = conn.execute(
        "SELECT * FROM sessions WHERE date >= ? ORDER BY date, id", (since,)
    ).fetchall()

    sessions = []
    for row in rows:
        s = {k: v for k, v in dict(row).items() if v is not None}
        s.update(derived_metrics(s))
        sessions.append(s)
    return sessions


def derived_metrics(session: dict) -> dict:
    """Values computed from stored facts. Never written to the database."""
    metrics = {
        # Session-RPE load (Foster): minutes x perceived effort.
        "load": session["duration_min"] * session["effort"],
    }
    if session.get("distance_km"):
        metrics["pace_min_per_km"] = round(session["duration_min"] / session["distance_km"], 2)
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
            "guess numbers. Use running fields only for running and climbing fields "
            "only for climbing."
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
                "climbing_style": {"type": "string", "enum": list(CLIMBING_STYLES),
                                   "description": "Climbing only"},
                "hardest_grade": {"type": "string",
                                  "description": "Climbing only, e.g. '6b+' or 'V4'"},
                "routes_count": {"type": "integer",
                                 "description": "Climbing only: routes or problems sent"},
            },
            "required": ["sport", "date", "duration_min", "effort"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_history",
        "description": (
            "Get logged sessions from the last N days, including computed load "
            "(minutes x effort) and running pace. Use this before answering questions "
            "about past training."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "minimum": 1}},
            "required": ["days"],
            "additionalProperties": False,
        },
    },
]


def run_tool(conn: sqlite3.Connection, name: str, tool_input: dict) -> str:
    """Dispatch a tool call from Claude and return the result as JSON text."""
    if name == "log_session":
        result = log_session(conn, **tool_input)
    elif name == "get_history":
        result = get_history(conn, **tool_input)
    else:
        raise ValueError(f"unknown tool {name!r}")
    return json.dumps(result)
