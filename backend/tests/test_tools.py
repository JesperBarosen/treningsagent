import json
from datetime import date

import pytest

import tools


def test_log_running_session(store):
    s = tools.log_session(store, "running", "2026-11-10", 50, 6, distance_km=10.0)
    assert s["id"] == 1
    assert s["distance_km"] == 10.0


BLUE_FLASH = {"grade": "blue", "style": "boulder", "sent": True, "attempts": 1}
RED_PROJECT = {"grade": "Red", "style": "kilter", "sent": False, "notes": "crimpy"}


def test_log_climbing_session_with_climbs(store):
    s = tools.log_session(store, "climbing", "2026-11-10", 90, 8,
                          climbs=[BLUE_FLASH, RED_PROJECT])
    assert s["id"] == 1
    assert [(c["grade"], c["grade_ordinal"]) for c in s["climbs"]] == [("blue", 3), ("red", 5)]
    assert [c["session_id"] for c in store.climbs] == [1, 1]
    assert store.climbs[1]["attempts"] is None  # not stated, not guessed


def test_log_climbing_session_without_climbs(store):
    s = tools.log_session(store, "climbing", "2026-11-10", 60, 5)
    assert "climbs" not in s and store.climbs == []


@pytest.mark.parametrize("climb, message", [
    ({**BLUE_FLASH, "grade": "orange"}, "grade"),
    ({**BLUE_FLASH, "style": "lead"}, "style"),
    ({**BLUE_FLASH, "sent": "yes"}, "sent"),
    ({**BLUE_FLASH, "attempts": 0}, "attempts"),
    ({**BLUE_FLASH, "hardest": True}, "unknown climb fields"),
    ({k: v for k, v in BLUE_FLASH.items() if k != "sent"}, "sent"),
])
def test_log_session_rejects_invalid_climbs(store, climb, message):
    with pytest.raises(ValueError, match=message):
        tools.log_session(store, "climbing", "2026-11-10", 60, 5, climbs=[BLUE_FLASH, climb])
    assert store.rows == [] and store.climbs == []  # nothing half-stored


def test_climbs_only_for_climbing(store):
    with pytest.raises(ValueError, match="climbing sessions"):
        tools.log_session(store, "running", "2026-11-10", 30, 5, climbs=[BLUE_FLASH])


@pytest.mark.parametrize("kwargs, message", [
    ({"sport": "swimming"}, "sport"),
    ({"effort": 0}, "effort"),
    ({"effort": 11}, "effort"),
    ({"duration_min": 0}, "duration_min"),
    ({"date": "10.11.2026"}, "date"),
])
def test_log_session_rejects_invalid_input(store, kwargs, message):
    args = {"sport": "running", "date": "2026-11-10", "duration_min": 30, "effort": 5} | kwargs
    with pytest.raises(ValueError, match=message):
        tools.log_session(store, **args)


def test_log_session_rejects_fields_from_other_sport(store):
    with pytest.raises(ValueError, match="not valid for climbing"):
        tools.log_session(store, "climbing", "2026-11-10", 30, 5, distance_km=3.0)


def test_derived_values_are_computed_not_stored(store):
    tools.log_session(store, "running", "2026-11-10", 50, 6, distance_km=10.0)

    [stored] = store.rows
    assert "load" not in stored and "pace_min_per_km" not in stored

    [s] = tools.get_history(store, 7, today=date(2026, 11, 10))
    assert s["load"] == 300
    assert s["pace_min_per_km"] == 5.0


def test_climbing_session_has_load_but_no_pace(store):
    tools.log_session(store, "climbing", "2026-11-10", 60, 7)
    [s] = tools.get_history(store, 1, today=date(2026, 11, 10))
    assert s["load"] == 420
    assert "pace_min_per_km" not in s


def test_history_includes_climbs_and_hardest_send(store):
    purple_send = {"grade": "purple", "style": "rope", "sent": True}
    tools.log_session(store, "climbing", "2026-11-10", 90, 7,
                      climbs=[BLUE_FLASH, RED_PROJECT, purple_send])
    [s] = tools.get_history(store, 1, today=date(2026, 11, 10))
    assert [c["grade"] for c in s["climbs"]] == ["blue", "red", "purple"]
    assert "session_id" not in s["climbs"][0]
    assert s["climbs_sent"] == 2
    assert s["hardest_sent_grade"] == "purple"  # red is harder but wasn't sent


def test_get_history_window_includes_today_and_excludes_older(store):
    for d in ["2026-11-03", "2026-11-04", "2026-11-10"]:
        tools.log_session(store, "running", d, 30, 5)

    sessions = tools.get_history(store, 7, today=date(2026, 11, 10))  # 11-04 .. 11-10
    assert [s["date"] for s in sessions] == ["2026-11-04", "2026-11-10"]


def test_get_history_rejects_non_positive_days(store):
    with pytest.raises(ValueError):
        tools.get_history(store, 0)


def test_run_tool_returns_json(store):
    out = tools.run_tool(store, "log_session",
                         {"sport": "running", "date": "2026-11-10", "duration_min": 30, "effort": 4})
    assert json.loads(out)["id"] == 1


def test_run_tool_rejects_unknown_tool(store):
    with pytest.raises(ValueError, match="unknown tool"):
        tools.run_tool(store, "delete_everything", {})


WED = date(2026, 11, 11)  # a Wednesday; its week starts Monday 2026-11-09


def test_training_load_per_day_and_week_across_sports(store):
    tools.log_session(store, "running", "2026-10-30", 10, 5)   # before the shown weeks
    tools.log_session(store, "running", "2026-11-02", 30, 5)   # 150
    tools.log_session(store, "climbing", "2026-11-10", 60, 7)  # 420
    tools.log_session(store, "running", "2026-11-10", 20, 5)   # 100
    tools.log_session(store, "running", "2026-11-11", 40, 6)   # 240

    load = tools.get_training_load(store, weeks=2, today=WED)

    daily = {d["date"]: d["load"] for d in load["daily"]}
    assert list(daily)[0] == "2026-11-02" and list(daily)[-1] == "2026-11-11"
    assert daily["2026-11-03"] == 0  # rest days are included
    assert daily["2026-11-10"] == 520
    assert load["weekly"] == [
        {"week_start": "2026-11-02", "load": 150, "sessions": 1,
         "load_by_sport": {"running": 150}},
        {"week_start": "2026-11-09", "load": 760, "sessions": 3,
         "load_by_sport": {"climbing": 420, "running": 340}},
    ]
    assert store.rows[0].keys() == {"id", "sport", "date", "duration_min", "effort", "notes"}


def test_acute_chronic_ratio_uses_7_and_28_day_averages(store):
    tools.log_session(store, "running", "2026-10-14", 100, 10)  # 28 days ago: outside
    tools.log_session(store, "running", "2026-10-15", 60, 5)    # 300, first chronic day
    tools.log_session(store, "climbing", "2026-11-11", 70, 10)  # 700, today

    load = tools.get_training_load(store, weeks=1, today=WED)

    assert load["acute_7d_avg"] == 100.0             # 700 / 7
    assert load["chronic_28d_avg"] == 35.7           # 1000 / 28
    assert load["acute_chronic_ratio"] == 2.8        # 100 / 35.71
    assert [d["date"] for d in load["daily"]] == ["2026-11-09", "2026-11-10", "2026-11-11"]


def test_training_load_with_no_sessions(store):
    load = tools.get_training_load(store, today=WED)
    assert len(load["weekly"]) == 4
    assert load["acute_chronic_ratio"] is None


@pytest.mark.parametrize("weeks", [0, 13])
def test_training_load_rejects_bad_weeks(store, weeks):
    with pytest.raises(ValueError, match="weeks"):
        tools.get_training_load(store, weeks=weeks)


def test_run_tool_dispatches_training_load(store):
    assert json.loads(tools.run_tool(store, "get_training_load", {}))["acute_chronic_ratio"] is None
