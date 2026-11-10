import json
from datetime import date

import pytest

import tools


@pytest.fixture
def conn():
    conn = tools.connect(":memory:")
    yield conn
    conn.close()


def test_log_running_session(conn):
    s = tools.log_session(conn, "running", "2026-11-10", 50, 6, distance_km=10.0)
    assert s["id"] == 1
    assert s["distance_km"] == 10.0


def test_log_climbing_session(conn):
    s = tools.log_session(conn, "climbing", "2026-11-10", 90, 8,
                          climbing_style="boulder", hardest_grade="7A", routes_count=12)
    assert s["hardest_grade"] == "7A"


@pytest.mark.parametrize("kwargs, message", [
    ({"sport": "swimming"}, "sport"),
    ({"effort": 0}, "effort"),
    ({"effort": 11}, "effort"),
    ({"duration_min": 0}, "duration_min"),
    ({"date": "10.11.2026"}, "date"),
])
def test_log_session_rejects_invalid_input(conn, kwargs, message):
    args = {"sport": "running", "date": "2026-11-10", "duration_min": 30, "effort": 5} | kwargs
    with pytest.raises(ValueError, match=message):
        tools.log_session(conn, **args)


def test_log_session_rejects_fields_from_other_sport(conn):
    with pytest.raises(ValueError, match="not valid for running"):
        tools.log_session(conn, "running", "2026-11-10", 30, 5, hardest_grade="6a")


def test_log_session_rejects_unknown_climbing_style(conn):
    with pytest.raises(ValueError, match="climbing_style"):
        tools.log_session(conn, "climbing", "2026-11-10", 60, 5, climbing_style="ice")


def test_derived_values_are_computed_not_stored(conn):
    tools.log_session(conn, "running", "2026-11-10", 50, 6, distance_km=10.0)

    stored = dict(conn.execute("SELECT * FROM sessions").fetchone())
    assert "load" not in stored and "pace_min_per_km" not in stored

    [s] = tools.get_history(conn, 7, today=date(2026, 11, 10))
    assert s["load"] == 300
    assert s["pace_min_per_km"] == 5.0


def test_climbing_session_has_load_but_no_pace(conn):
    tools.log_session(conn, "climbing", "2026-11-10", 60, 7)
    [s] = tools.get_history(conn, 1, today=date(2026, 11, 10))
    assert s["load"] == 420
    assert "pace_min_per_km" not in s


def test_get_history_window_includes_today_and_excludes_older(conn):
    for d in ["2026-11-03", "2026-11-04", "2026-11-10"]:
        tools.log_session(conn, "running", d, 30, 5)

    sessions = tools.get_history(conn, 7, today=date(2026, 11, 10))  # 11-04 .. 11-10
    assert [s["date"] for s in sessions] == ["2026-11-04", "2026-11-10"]


def test_get_history_rejects_non_positive_days(conn):
    with pytest.raises(ValueError):
        tools.get_history(conn, 0)


def test_run_tool_returns_json(conn):
    out = tools.run_tool(conn, "log_session",
                         {"sport": "running", "date": "2026-11-10", "duration_min": 30, "effort": 4})
    assert json.loads(out)["id"] == 1


def test_run_tool_rejects_unknown_tool(conn):
    with pytest.raises(ValueError, match="unknown tool"):
        tools.run_tool(conn, "delete_everything", {})
