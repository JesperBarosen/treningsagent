import json
from datetime import date

import pytest

import progression
import tools

# A Wednesday. Recent window: 2026-10-29..2026-11-11; baseline: 2026-10-01..2026-10-28.
TODAY = date(2026, 11, 11)
RECENT = ("2026-11-03", "2026-11-06", "2026-11-10")
BASELINE = ("2026-10-05", "2026-10-12", "2026-10-20")


def run(store, day, km, minutes):
    tools.log_session(store, "running", day, minutes, 5, distance_km=km)


def climb(grade, sent, attempts=None):
    return {"grade": grade, "style": "boulder", "sent": sent, "attempts": attempts}


def session(store, day, *climbs):
    tools.log_session(store, "climbing", day, 90, 7, climbs=list(climbs))


def progress(store, **kwargs):
    return tools.calculate_progression(store, today=TODAY, **kwargs)


def all_trends(trends: dict) -> list[str]:
    """Every trend value, including nested per-band and per-grade ones."""
    out = []
    for t in trends.values():
        out += [t["trend"]] if "trend" in t else all_trends(t)
    return out


def test_no_data(store):
    p = progress(store)
    assert p["weeks"] == 8 and "14 days" in p["trend_rule"]
    for sport in ("running", "climbing"):
        assert p[sport]["sessions"] == 0
        assert len(p[sport]["weekly"]) == 8
        assert set(all_trends(p[sport]["trends"])) == {"not enough data"}
    assert p["running"]["weekly"][-1] == {
        "week_start": "2026-11-09", "runs": 0, "distance_km": 0, "duration_min": 0,
        "pace_min_per_km": None, "pace_by_distance": {}}
    assert p["climbing"]["weekly"][-1]["hardest_sent"] is None
    assert p["climbing"]["trends"]["send_rate_by_grade"] == {}


def test_weeks_are_calendar_weeks_ending_with_the_current_one(store):
    run(store, "2026-11-11", 10, 50)
    run(store, "2026-11-02", 5, 30)
    p = progress(store, weeks=3)
    weekly = p["running"]["weekly"]
    assert [w["week_start"] for w in weekly] == ["2026-10-26", "2026-11-02", "2026-11-09"]
    assert [w["runs"] for w in weekly] == [0, 1, 1]
    assert weekly[2]["pace_by_distance"] == {"7_to_15km": {"runs": 1, "pace_min_per_km": 5.0}}
    assert weekly[1]["pace_by_distance"] == {"under_7km": {"runs": 1, "pace_min_per_km": 6.0}}


def test_one_sport_only(store):
    for day in BASELINE:
        run(store, day, 10, 55)
    for day in RECENT:
        run(store, day, 10, 50)
    p = progress(store)
    pace = p["running"]["trends"]["pace_min_per_km"]
    assert pace == {"recent": 5.0, "baseline": 5.5, "recent_sessions": 3,
                    "baseline_sessions": 3, "trend": "improving"}
    distance = p["running"]["trends"]["distance_km_per_week"]
    assert (distance["recent"], distance["baseline"], distance["trend"]) == (15.0, 7.5, "improving")
    assert p["climbing"]["sessions"] == 0
    assert set(all_trends(p["climbing"]["trends"])) == {"not enough data"}


def test_pace_is_compared_within_distance_bands(store):
    for day in BASELINE:
        run(store, day, 5, 25)
    for day in RECENT:
        run(store, day, 5, 24)
    run(store, "2026-11-08", 20, 120)  # one slow long run
    trends = progress(store)["running"]["trends"]
    assert trends["pace_min_per_km"]["trend"] == "declining"  # mixed distances mislead
    assert trends["pace_by_distance"]["under_7km"]["trend"] == "improving"
    assert trends["pace_by_distance"]["over_15km"]["trend"] == "not enough data"


def test_small_changes_are_flat(store):
    for day in BASELINE:
        run(store, day, 10, 50)
    for day in RECENT[:2]:
        run(store, day, 10, 50)
    run(store, RECENT[2], 10, 51)  # 0.7% slower
    assert progress(store)["running"]["trends"]["pace_min_per_km"]["trend"] == "flat"


def test_needs_three_sessions_on_each_side(store):
    for day in BASELINE:
        run(store, day, 10, 55)
    for day in RECENT[:2]:
        run(store, day, 10, 45)
    pace = progress(store)["running"]["trends"]["pace_min_per_km"]
    assert pace["trend"] == "not enough data"
    assert (pace["recent_sessions"], pace["baseline_sessions"]) == (2, 3)
    assert pace["recent"] == 4.5  # the numbers are still there to quote


def test_unsent_hard_climbs_do_not_count_as_hardest_sent(store):
    session(store, "2026-11-10", climb("blue", True, 2), climb("black", False, 5),
            climb("white", False))
    week = progress(store)["climbing"]["weekly"][-1]
    assert week["hardest_sent"] == "blue"
    assert week["climbs"] == 3


def test_null_attempts_count_as_tried_but_not_as_flash(store):
    session(store, "2026-11-10", climb("red", True), climb("red", False),
            climb("green", True, 1), climb("blue", True, 1), climb("blue", False, 3))
    week = progress(store)["climbing"]["weekly"][-1]
    assert week["flash_grade"] == "blue"  # the red send had no attempt count
    assert week["hardest_sent"] == "red"
    assert week["send_rate_by_grade"] == {
        "green": {"sent": 1, "tried": 1, "rate": 1.0},
        "blue": {"sent": 1, "tried": 2, "rate": 0.5},
        "red": {"sent": 1, "tried": 2, "rate": 0.5},
    }
    assert list(week["send_rate_by_grade"]) == ["green", "blue", "red"]  # easiest first


def test_climbing_trends(store):
    for day in BASELINE:
        session(store, day, climb("blue", True, 1), climb("purple", False, 4),
                climb("purple", False, 3))
    for day in RECENT:
        session(store, day, climb("purple", True, 1), climb("purple", True, 2),
                climb("red", True))
    p = progress(store)
    trends = p["climbing"]["trends"]
    assert trends["avg_session_hardest_sent"] == {
        "recent": 5.0, "baseline": 3.0, "recent_sessions": 3, "baseline_sessions": 3,
        "trend": "improving"}
    assert trends["avg_session_flash_grade"]["recent"] == 4.0  # red had null attempts
    assert trends["avg_session_flash_grade"]["trend"] == "improving"
    assert trends["send_rate_by_grade"]["purple"]["trend"] == "improving"
    assert trends["send_rate_by_grade"]["blue"]["trend"] == "not enough data"  # none recent
    assert trends["send_rate_by_grade"]["red"]["trend"] == "not enough data"
    assert trends["climbs_per_week"]["recent"] == 4.5
    assert trends["climbs_per_week"]["baseline"] == pytest.approx(2.2)  # 9 / 4, rounded
    assert p["climbing"]["grade_scale"][0] == "yellow"


def test_sessions_with_only_unsent_climbs_have_no_top_grade(store):
    for day in BASELINE + RECENT:
        session(store, day, climb("black", False, 6))
    trends = progress(store)["climbing"]["trends"]
    assert trends["avg_session_hardest_sent"]["recent_sessions"] == 0
    assert trends["avg_session_hardest_sent"]["trend"] == "not enough data"
    assert trends["send_rate_by_grade"]["black"]["trend"] == "flat"  # 0% both sides


@pytest.mark.parametrize("weeks", [0, 27])
def test_rejects_bad_weeks(store, weeks):
    with pytest.raises(ValueError, match="weeks"):
        progress(store, weeks=weeks)


def test_short_view_still_uses_full_trend_windows(store):
    for day in BASELINE:
        run(store, day, 10, 55)
    for day in RECENT:
        run(store, day, 10, 50)
    p = progress(store, weeks=1)
    assert len(p["running"]["weekly"]) == 1
    assert p["running"]["trends"]["pace_min_per_km"]["trend"] == "improving"


def test_sport_modules_are_pluggable(store, monkeypatch):
    def strength(sessions, climbs_by_session, weeks, windows):
        return {"sessions": 0, "weekly": [], "trends": {}}
    monkeypatch.setitem(progression.SPORT_MODULES, "strength", strength)
    assert progress(store)["strength"] == {
        "last_session": None, "days_since_last_session": None,
        "sessions": 0, "weekly": [], "trends": {}}


def test_last_session_per_sport(store):
    run(store, "2026-11-02", 10, 50)
    run(store, "2026-11-09", 8, 42)
    session(store, "2026-11-05", climb("blue", True))
    session(store, "2026-11-12", climb("blue", True))  # after today: ignored
    p = progress(store)
    assert (p["running"]["last_session"], p["running"]["days_since_last_session"]) == (
        "2026-11-09", 2)
    assert (p["climbing"]["last_session"], p["climbing"]["days_since_last_session"]) == (
        "2026-11-05", 6)


def test_last_session_today_is_zero_days_and_none_without_data(store):
    run(store, "2026-11-11", 5, 30)
    p = progress(store)
    assert p["running"]["days_since_last_session"] == 0
    assert p["climbing"]["last_session"] is None


def test_run_tool_dispatches_progression(store):
    out = json.loads(tools.run_tool(store, "calculate_progression", {"weeks": 2}))
    assert len(out["running"]["weekly"]) == 2 and out["climbing"]["sessions"] == 0


def test_tool_schema_matches_function_limits():
    schema = next(t for t in tools.TOOLS if t["name"] == "calculate_progression")
    weeks = schema["input_schema"]["properties"]["weeks"]
    assert (weeks["minimum"], weeks["maximum"]) == (1, 26)
    assert "not enough data" in schema["description"]
