"""Outcome goals (docs/design-proposals-2.md, N2).

Two kinds, both measured from the user's own logged sessions:

- climb_grade: send (or flash) `grade`. Progress is the hardest grade reached
  so far, as steps on the gym's scale ("4 of 5 steps"). Reached by the first
  qualifying send on or after the day the goal was set.
- run_pace: run a distance `band` at `target_pace` (min/km) or faster.
  Progress runs from `start_pace` (the recent pace in that band when the goal
  was set) to the target, via the pace "now" (the average of the last 28 days).
  Reached by the first run in the band at the target pace or faster.

A goal is never "failed" (Consolvo et al. 2009: no punishment). When its date
passes unreached it is only marked `overdue`, so the app can ask whether to
keep it, move the date or let it go.
"""

from datetime import date, timedelta

from progression import distance_band

GRADES = ("yellow", "green", "blue", "purple", "red", "black", "white")
BANDS = ("under_7km", "7_to_15km", "over_15km")
KINDS = ("climb_grade", "run_pace")
STATUSES = ("active", "paused", "achieved", "dropped")
NOW_DAYS = 28   # "now" for a pace goal: the last four weeks
LOOKBACK = 56   # how far back the starting point of a grade goal looks


def validate_goal(kind: str, grade: str | None = None, climb_mode: str | None = None,
                  band: str | None = None, target_pace: float | None = None,
                  target_date: str | None = None, today: date | None = None) -> dict:
    """The fields of a new goal, or ValueError. start_pace is added by the caller."""
    today = today or date.today()
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}, got {kind!r}")
    if target_date is not None:
        try:
            when = date.fromisoformat(target_date)
        except ValueError:
            raise ValueError(f"target_date must be YYYY-MM-DD, got {target_date!r}") from None
        if when < today:
            raise ValueError("target_date can't be in the past")
    if kind == "climb_grade":
        if grade not in GRADES:
            raise ValueError(f"grade must be one of {GRADES}, got {grade!r}")
        if climb_mode not in ("send", "flash"):
            raise ValueError("climb_mode must be 'send' or 'flash'")
        if band is not None or target_pace is not None:
            raise ValueError("a grade goal has no band or pace")
        return {"kind": kind, "grade": grade, "climb_mode": climb_mode, "band": None,
                "target_pace": None, "target_date": target_date}
    if band not in BANDS:
        raise ValueError(f"band must be one of {BANDS}, got {band!r}")
    if not isinstance(target_pace, (int, float)) or not 2.0 <= target_pace <= 15.0:
        raise ValueError("target_pace must be between 2:00 and 15:00 min/km")
    if grade is not None or climb_mode is not None:
        raise ValueError("a pace goal has no grade")
    return {"kind": kind, "grade": None, "climb_mode": None, "band": band,
            "target_pace": round(float(target_pace), 2), "target_date": target_date}


def _d(value) -> date:
    return value if isinstance(value, date) else date.fromisoformat(value)


def _runs_in_band(sessions: list[dict], band: str) -> list[dict]:
    return [s for s in sessions if s["sport"] == "running" and s.get("distance_km")
            and distance_band(s["distance_km"]) == band]


def _pace(run: dict) -> float:
    return run["duration_min"] / run["distance_km"]


def start_pace(sessions: list[dict], band: str, today: date) -> float | None:
    """The average pace in `band` over the last 28 days: where a new pace goal starts."""
    since = today - timedelta(days=NOW_DAYS - 1)
    runs = [r for r in _runs_in_band(sessions, band) if since <= _d(r["date"]) <= today]
    if not runs:
        return None
    return round(sum(r["duration_min"] for r in runs) / sum(r["distance_km"] for r in runs), 2)


def progress(goal: dict, sessions: list[dict], climbs: list[dict], today: date) -> dict:
    """How far the goal has come. `sessions` and `climbs` must reach back
    LOOKBACK days before the goal was set."""
    created = _d(goal["created_on"])
    if goal["kind"] == "climb_grade":
        target = GRADES.index(goal["grade"]) + 1
        dates = {s["id"]: _d(s["date"]) for s in sessions}

        def qualifies(c: dict) -> bool:
            return c["sent"] and (goal["climb_mode"] == "send" or c.get("attempts") == 1)

        done = [c for c in climbs if qualifies(c) and c["session_id"] in dates]
        recent = [c for c in done if dates[c["session_id"]] >= created - timedelta(days=LOOKBACK)]
        best = max((c["grade_ordinal"] for c in recent), default=0)
        hits = sorted(dates[c["session_id"]] for c in done
                      if c["grade_ordinal"] >= target and dates[c["session_id"]] >= created)
        month = today - timedelta(days=NOW_DAYS - 1)
        best_count = sum(1 for c in recent if c["grade_ordinal"] == best
                         and dates[c["session_id"]] >= month)
        return {"steps": min(best, target), "of": target,
                "best_grade": GRADES[best - 1] if best else None,
                "best_count_28d": best_count,
                "reached_on": hits[0].isoformat() if hits else None}

    runs = _runs_in_band(sessions, goal["band"])
    target = float(goal["target_pace"])
    hits = sorted(_d(r["date"]) for r in runs if _d(r["date"]) >= created and _pace(r) <= target)
    now = start_pace(sessions, goal["band"], today)
    start = float(goal["start_pace"]) if goal.get("start_pace") is not None else None
    fraction = None
    if start is not None and now is not None and start > target:
        fraction = round(max(0.0, min(1.0, (start - now) / (start - target))), 2)
    return {"start_pace": start, "now_pace": now, "target_pace": target,
            "fraction": fraction, "reached_on": hits[0].isoformat() if hits else None}


def with_progress(goal: dict, sessions: list[dict], climbs: list[dict], today: date) -> dict:
    """The goal, its progress, and whether its date passed while still open."""
    p = progress(goal, sessions, climbs, today)
    overdue = (goal["status"] == "active" and not p["reached_on"]
               and goal.get("target_date") is not None and _d(goal["target_date"]) < today)
    return {**goal, "progress": p, "overdue": overdue}


def describe(goal: dict) -> str:
    """'send a red by 2027-03-01' or 'run 7_to_15km at 5:00/km', for the coach."""
    if goal["kind"] == "climb_grade":
        text = f"{goal['climb_mode']} a {goal['grade']}"
    else:
        pace = float(goal["target_pace"])
        text = f"run {goal['band']} at {int(pace)}:{round(pace % 1 * 60):02d}/km"
    return text + (f" by {goal['target_date']}" if goal.get("target_date") else "")
