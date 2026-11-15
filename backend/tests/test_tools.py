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


def test_draft_session_checks_like_log_session_but_stores_nothing(store):
    d = tools.draft_session(store, "climbing", "2026-11-10", 90, 8,
                            climbs=[BLUE_FLASH, RED_PROJECT])
    assert d["draft"] is True and "id" not in d
    assert [(c["grade"], c["grade_ordinal"]) for c in d["climbs"]] == [("blue", 3), ("red", 5)]
    assert store.rows == [] and store.climbs == []
    with pytest.raises(ValueError):
        tools.draft_session(store, "running", "2026-11-10", 30, 11)
    with pytest.raises(ValueError):
        tools.draft_session(store, "running", "2026-11-10", 30, 5, climbs=[BLUE_FLASH])


def test_tools_for_drafts_by_default_and_logs_with_auto_save():
    by_name = lambda ts: {t["name"]: t for t in ts}  # noqa: E731
    drafting = by_name(tools.tools_for(auto_save=False))
    assert "draft_session" in drafting
    assert drafting["log_session"]["description"].startswith("Not available")
    assert drafting["draft_session"]["input_schema"] == drafting["log_session"]["input_schema"]
    assert "draft_session" not in by_name(tools.tools_for(auto_save=True))
    assert json.dumps(tools.run_tool(None, "draft_session",
                                     {"sport": "running", "date": "2026-11-10",
                                      "duration_min": 30, "effort": 5}))


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
    assert load["history_days"] == 29                # since 2026-10-14
    assert load["ratio_status"] == "ok"
    assert [d["date"] for d in load["daily"]] == ["2026-11-09", "2026-11-10", "2026-11-11"]


def test_training_load_with_no_sessions(store):
    load = tools.get_training_load(store, today=WED)
    assert len(load["weekly"]) == 4
    assert load["acute_chronic_ratio"] is None
    assert load["ratio_status"] == "not_enough_data"
    assert load["history_days"] == 0


@pytest.mark.parametrize(("first", "days", "status"), [
    ("2026-10-15", 28, "ok"),               # exactly 28 days, today included
    ("2026-10-16", 27, "not_enough_data"),
])
def test_ratio_status_needs_28_days_of_history(store, first, days, status):
    tools.log_session(store, "running", first, 30, 5)
    tools.log_session(store, "running", "2026-11-11", 30, 5)
    load = tools.get_training_load(store, weeks=1, today=WED)
    assert load["acute_chronic_ratio"] is not None
    assert (load["history_days"], load["ratio_status"]) == (days, status)


def test_ratio_status_counts_history_outside_the_shown_weeks(store):
    tools.log_session(store, "running", "2026-06-01", 30, 5)  # long before the 28-day window
    tools.log_session(store, "running", "2026-11-10", 30, 5)
    assert tools.get_training_load(store, weeks=1, today=WED)["ratio_status"] == "ok"


def test_ratio_status_without_recent_load(store):
    tools.log_session(store, "running", "2026-06-01", 30, 5)  # long history, nothing in 28 days
    load = tools.get_training_load(store, weeks=1, today=WED)
    assert load["acute_chronic_ratio"] is None
    assert load["ratio_status"] == "not_enough_data"


def test_training_load_for_one_sport_counts_only_that_sport(store):
    # #46: the Dashboard filter. Running started 2026-10-01; climbing 2026-11-10.
    tools.log_session(store, "running", "2026-10-01", 30, 5)    # 150, long ago
    tools.log_session(store, "running", "2026-11-02", 30, 5)    # 150
    tools.log_session(store, "climbing", "2026-11-10", 60, 7)   # 420
    tools.log_session(store, "running", "2026-11-11", 40, 6)    # 240, today

    run = tools.get_training_load(store, weeks=2, today=WED, sport="running")
    assert [w["load_by_sport"] for w in run["weekly"]] == [{"running": 150}, {"running": 240}]
    assert [w["sessions"] for w in run["weekly"]] == [1, 1]
    assert {d["date"]: d["load"] for d in run["daily"]}["2026-11-10"] == 0  # the climb is left out
    assert run["acute_7d_avg"] == round(240 / 7, 1)
    assert run["history_days"] == 42 and run["ratio_status"] == "ok"

    climb = tools.get_training_load(store, weeks=2, today=WED, sport="climbing")
    assert [w["load"] for w in climb["weekly"]] == [0, 420]
    assert climb["history_days"] == 2 and climb["ratio_status"] == "not_enough_data"

    every = tools.get_training_load(store, weeks=2, today=WED)
    assert every["weekly"][1]["load"] == 660 and every["history_days"] == 42


def test_training_load_for_one_sport_still_respects_a_break(store):
    tools.log_session(store, "running", "2026-09-01", 30, 5)
    store.start_pause({"start_date": "2026-11-09", "planned_end": None, "reason": "travel",
                       "body_part": None, "pain": None, "note": None})
    load = tools.get_training_load(store, weeks=1, today=WED, sport="running")
    assert load["ratio_status"] == "paused" and load["pause"]["reason"] == "travel"
    assert load["paused_days"] == 3


def test_training_load_rejects_an_unknown_sport(store):
    with pytest.raises(ValueError, match="sport must be one of"):
        tools.get_training_load(store, sport="swimming")


@pytest.mark.parametrize("weeks", [0, 13])
def test_training_load_rejects_bad_weeks(store, weeks):
    with pytest.raises(ValueError, match="weeks"):
        tools.get_training_load(store, weeks=weeks)


def test_run_tool_dispatches_training_load(store):
    assert json.loads(tools.run_tool(store, "get_training_load", {}))["acute_chronic_ratio"] is None
