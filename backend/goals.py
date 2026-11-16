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

import grades
from progression import distance_band

GRADES = grades.LEGACY_COLOURS
BANDS = ("under_7km", "7_to_15km", "over_15km")
KINDS = ("climb_grade", "run_pace")
STATUSES = ("active", "paused", "achieved", "dropped")
NOW_DAYS = 28   # "now" for a pace goal: the last four weeks
LOOKBACK = 56   # how far back the starting point of a grade goal looks


def validate_goal(kind: str, grade: str | None = None, climb_mode: str | None = None,
                  band: str | None = None, target_pace: float | None = None,
                  target_date: str | None = None, today: date | None = None,
                  grade_system: str | None = None, gym: dict | None = None) -> dict:
    """The fields of a new goal, or ValueError. start_pace is added by the caller.

    A grade goal is a colour of `gym` (grade_system "gym", the default; the
    caller passes the gym, "My gym" if none) or a V or Font grade (#98)."""
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
        system = grade_system or "gym"
        if system not in grades.SYSTEMS:
            raise ValueError(f"grade_system must be one of {grades.SYSTEMS}, got {system!r}")
        if system == "gym":
            gym = gym or grades.legacy_gym()
            wanted = str(grade or "").strip().lower()
            match = next((g for g in grades.active_grades(gym) if g["name"] == wanted), None)
            if match is None:
                names = tuple(g["name"] for g in grades.active_grades(gym))
                raise ValueError(f"grade must be one of {names} at {gym['name']}, got {grade!r}")
            target = {"grade": match["name"], "grade_system": "gym", "gym_id": gym["id"],
                      "gym_grade_id": match["id"]}
        else:
            target = {"grade": grades.normalise(system, grade or ""), "grade_system": system,
                      "gym_id": None, "gym_grade_id": None}
        if climb_mode not in ("send", "flash"):
            raise ValueError("climb_mode must be 'send' or 'flash'")
        if band is not None or target_pace is not None:
            raise ValueError("a grade goal has no band or pace")
        return {"kind": kind, **target, "climb_mode": climb_mode, "band": None,
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


def goal_scale(goal: dict, gym_list: list[dict]) -> grades.Scale:
    """The scale a grade goal counts steps on: its gym's circuit, or V or Font."""
    system = goal.get("grade_system") or "gym"
    if system == "v":
        return grades.v_scale()
    if system == "font":
        return grades.font_scale()
    gym = next((g for g in gym_list if g["id"] == goal.get("gym_id")), None)
    return grades.gym_scale(gym or grades.legacy_gym())


def _target(goal: dict, scale: grades.Scale) -> tuple[int, bool]:
    """The goal grade's step on its scale, and whether it has an index (only
    then do equally hard climbs elsewhere count)."""
    system = goal.get("grade_system") or "gym"
    if system == "gym":
        step = scale.positions.get(goal.get("gym_grade_id"))
        if step is None:  # a row from before gyms, or "My gym" not stored yet
            step = scale.names.index(goal["grade"]) + 1
        ranged = any(abs(p - step) < 1e-9 for _, p in scale.anchors)
        return step, ranged
    return scale.names.index(goal["grade"]) + 1, True


def progress(goal: dict, sessions: list[dict], climbs: list[dict], today: date,
             gym_list: list[dict] | None = None) -> dict:
    """How far the goal has come. `sessions` and `climbs` must reach back
    LOOKBACK days before the goal was set. Climbs need their `index`
    (grades.annotate) for a goal to count climbs at other gyms or outdoors."""
    created = _d(goal["created_on"])
    if goal["kind"] == "climb_grade":
        scale = goal_scale(goal, gym_list or [])
        target, ranged = _target(goal, scale)
        dates = {s["id"]: _d(s["date"]) for s in sessions}

        def level(c: dict) -> float | None:
            """Where the climb sits on the goal's scale. A goal whose grade has
            no range only counts climbs at its own gym (docs 3.6)."""
            at_gym = scale.system == "gym" and c.get("gym_grade_id") in scale.positions
            if at_gym:
                return float(scale.positions[c["gym_grade_id"]])
            if (scale.system == "gym" and goal.get("gym_id") is None and "gym_grade_id" not in c
                    and c.get("grade") in scale.names):
                return float(scale.names.index(c["grade"]) + 1)  # a plain row from before gyms
            return scale.level_of_index(c.get("index")) if ranged else None

        def qualifies(c: dict) -> bool:
            return c["sent"] and (goal["climb_mode"] == "send" or c.get("attempts") == 1)

        done = [(c, level(c)) for c in climbs if qualifies(c) and c["session_id"] in dates]
        done = [(c, lv) for c, lv in done if lv is not None]
        recent = [(c, lv) for c, lv in done
                  if dates[c["session_id"]] >= created - timedelta(days=LOOKBACK)]
        # A step is reached when the climb is at least as hard as that grade.
        best = max((int(lv + 1e-9) for _, lv in recent), default=0)
        best = min(max(best, 0), len(scale.names))
        hits = sorted(((dates[c["session_id"]], c["session_id"], c) for c, lv in done
                       if lv >= target - 1e-9 and dates[c["session_id"]] >= created),
                      key=lambda h: (h[0], h[1]))
        month = today - timedelta(days=NOW_DAYS - 1)
        best_count = sum(1 for c, lv in recent if int(lv + 1e-9) == best
                         and dates[c["session_id"]] >= month)
        out = {"steps": min(best, target), "of": target,
               "best_grade": scale.names[best - 1] if best else None,
               "best_count_28d": best_count,
               "reached_on": hits[0][0].isoformat() if hits else None}
        if hits:  # where it was reached, for the goal card (Q4)
            c = hits[0][2]
            out["reached_with"] = {"grade": c["grade"], "grade_system": c.get("grade_system") or "gym",
                                   "gym": c.get("gym"),
                                   "about": grades.label("v", c["index"]) if c.get("index") is not None else None}
        return out

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


def with_progress(goal: dict, sessions: list[dict], climbs: list[dict], today: date,
                  gym_list: list[dict] | None = None) -> dict:
    """The goal, its progress, and whether its date passed while still open."""
    p = progress(goal, sessions, climbs, today, gym_list)
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
