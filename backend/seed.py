"""Fill about 8 weeks of realistic fake history for the fixed test user, for
frontend development and screenshots. Undo with unseed.py.

    cd backend && uv run python seed.py

Sessions go through tools.log_session and the RLS store, exactly like the
agent's own writes. The ids of the inserted sessions are written to
SEED_IDS_FILE so unseed.py deletes exactly those rows and nothing else.
"""

import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv

import db
import tools

SEED_IDS_FILE = Path(__file__).parent / ".seed_ids.json"
WEEKS = 8
LIGHT_WEEK = 3  # weeks before the current one: a deload week with less of everything

# (weekday, kind) per normal week. Monday = 0.
WEEK_PLAN = [(0, "easy_run"), (1, "climb"), (3, "tempo_run"), (4, "climb"), (6, "long_run")]
LIGHT_PLAN = [(1, "climb"), (5, "easy_run")]


def seed_sessions(today: date, rng: random.Random | None = None) -> list[dict]:
    """log_session arguments for WEEKS calendar weeks up to `today`, oldest
    first. Runs get slowly faster and climbing slowly harder, so the trends
    have something to show. Never dated after today."""
    rng = rng or random.Random(42)
    this_monday = today - timedelta(days=today.weekday())
    sessions = []
    for weeks_ago in range(WEEKS - 1, -1, -1):
        monday = this_monday - timedelta(weeks=weeks_ago)
        progress = (WEEKS - 1 - weeks_ago) / (WEEKS - 1)  # 0 in the first week, 1 now
        plan = LIGHT_PLAN if weeks_ago == LIGHT_WEEK else WEEK_PLAN
        for weekday, kind in plan:
            day = monday + timedelta(days=weekday)
            if day > today:
                continue
            light = weeks_ago == LIGHT_WEEK
            sessions.append(_run(kind, day, progress, light, rng) if kind.endswith("run")
                            else _climb(day, progress, light, rng))
    return sessions


def _run(kind: str, day: date, progress: float, light: bool, rng: random.Random) -> dict:
    km, pace, effort, note = {
        "easy_run": (rng.choice([5.0, 6.0, 6.5]), 6.0, 4, "Easy, conversational pace"),
        "tempo_run": (rng.choice([8.0, 9.0, 10.0]), 5.2, 7, "Tempo in the middle 5 km"),
        "long_run": (rng.choice([14.0, 16.0, 18.0]), 5.8, 6, "Long and steady"),
    }[kind]
    if light:
        km, effort = 5.0, 3
    pace = pace * (1 - 0.05 * progress) + rng.uniform(-0.08, 0.08)  # ~5% faster over the block
    return {"sport": "running", "date": day.isoformat(), "duration_min": round(km * pace),
            "effort": effort, "distance_km": km, "notes": note,
            "elevation_m": rng.choice([20, 40, 60, 120])}


GRADES = tools.GRADES


def _climb(day: date, progress: float, light: bool, rng: random.Random) -> dict:
    top = 4 + round(progress * 1.6)  # hardest grade tried: purple early, red/black late
    climbs = []
    for _ in range(rng.randint(4, 5) if light else rng.randint(7, 10)):
        ordinal = max(2, min(top, top - int(rng.expovariate(0.45))))
        hard = top - ordinal  # 0 = at the limit
        sent = rng.random() < (0.35, 0.7, 0.9, 0.97)[min(hard, 3)]
        attempts = 1 if sent and rng.random() < (0.1, 0.35, 0.7, 0.9)[min(hard, 3)] \
            else rng.randint(2, 5)
        climbs.append({"grade": GRADES[ordinal - 1], "style": rng.choice(
            ["boulder", "boulder", "boulder", "kilter"]), "sent": sent,
            "attempts": attempts if rng.random() < 0.9 else None})
    climbs.sort(key=lambda c: GRADES.index(c["grade"]))
    return {"sport": "climbing", "date": day.isoformat(),
            "duration_min": 60 if light else rng.choice([75, 90, 105]),
            "effort": 5 if light else rng.choice([6, 7, 8]),
            "notes": rng.choice(["Bouldering session", "Board night with friends",
                                 "Worked on crimps", None]),
            "climbs": climbs}


def main() -> int:
    load_dotenv()
    if SEED_IDS_FILE.exists():
        print(f"Already seeded ({SEED_IDS_FILE.name} exists). Run unseed.py first.")
        return 1
    conn = db.connect()
    db.ensure_auth_user(conn, db.TEST_USER_ID)
    store = db.PostgresStore(conn, db.TEST_USER_ID)
    ids = []
    try:
        for s in seed_sessions(date.today()):
            ids.append(tools.log_session(store, **s)["id"])
    finally:
        # Written even after a failure, so unseed can remove what got in.
        SEED_IDS_FILE.write_text(json.dumps({"user_id": db.TEST_USER_ID, "session_ids": ids}))
        conn.close()
    print(f"Seeded {len(ids)} sessions for the test user.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
