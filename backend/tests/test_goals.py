"""Outcome goals (N2): validation, progress from logged sessions, never
'failed', the agent tools and the API."""

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import api
import goals
import tools

TODAY = date(2026, 11, 15)
day = lambda n: (TODAY - timedelta(days=n)).isoformat()  # noqa: E731


@pytest.mark.parametrize("kwargs, message", [
    ({"kind": "swim"}, "kind must be"),
    ({"kind": "climb_grade", "grade": "pink", "climb_mode": "send"}, "grade must be"),
    ({"kind": "climb_grade", "grade": "red", "climb_mode": "top"}, "climb_mode"),
    ({"kind": "climb_grade", "grade": "red", "climb_mode": "send", "band": "7_to_15km"}, "no band"),
    ({"kind": "run_pace", "band": "marathon", "target_pace": 5.0}, "band must be"),
    ({"kind": "run_pace", "band": "7_to_15km", "target_pace": 1.5}, "between 2:00 and 15:00"),
    ({"kind": "run_pace", "band": "7_to_15km", "target_pace": 5.0, "grade": "red"}, "no grade"),
    ({"kind": "run_pace", "band": "7_to_15km", "target_pace": 5.0, "target_date": day(1)}, "past"),
])
def test_invalid_goals_are_refused(kwargs, message):
    with pytest.raises(ValueError, match=message):
        goals.validate_goal(**kwargs, today=TODAY)


def climb(store, n_days_ago, *climbs):
    tools.log_session(store, "climbing", day(n_days_ago), 90, 7, climbs=list(climbs))


def run(store, n_days_ago, km, minutes):
    tools.log_session(store, "running", day(n_days_ago), minutes, 6, distance_km=km)


def test_a_grade_goal_shows_steps_and_is_reached_only_by_a_send_after_it_was_set(store):
    climb(store, 20, {"grade": "red", "style": "boulder", "sent": True})  # before the goal
    climb(store, 5, {"grade": "purple", "style": "boulder", "sent": True},
          {"grade": "purple", "style": "boulder", "sent": True})
    tools.set_goal(store, "climb_grade", grade="red", climb_mode="send", today=TODAY - timedelta(days=10))

    [g] = tools.list_goals(store, TODAY)
    # The red from before the goal shows as the hardest reached, but doesn't count as reaching it.
    assert g["progress"]["of"] == 5 and g["progress"]["reached_on"] is None
    assert g["status"] == "active"

    climb(store, 1, {"grade": "red", "style": "kilter", "sent": True, "attempts": 3})
    [g] = tools.list_goals(store, TODAY)
    assert g["status"] == "achieved" and g["achieved_on"] == day(1)


def test_a_flash_goal_needs_a_first_try(store):
    tools.set_goal(store, "climb_grade", grade="blue", climb_mode="flash", today=TODAY - timedelta(days=3))
    climb(store, 2, {"grade": "blue", "style": "boulder", "sent": True, "attempts": 2})
    [g] = tools.list_goals(store, TODAY)
    assert g["progress"]["reached_on"] is None and g["progress"]["steps"] == 0
    climb(store, 1, {"grade": "blue", "style": "boulder", "sent": True, "attempts": 1})
    assert tools.list_goals(store, TODAY)[0]["status"] == "achieved"


def test_a_pace_goal_starts_from_recent_pace_and_tracks_now(store):
    run(store, 20, 10, 56)  # 5:36/km
    run(store, 10, 10, 54)  # 5:24/km
    g = tools.set_goal(store, "run_pace", band="7_to_15km", target_pace=5.0, target_date=day(-60), today=TODAY - timedelta(days=5))
    assert g["start_pace"] == 5.5  # 110 min / 20 km over the 28 days before

    run(store, 2, 10, 52)  # 5:12/km, faster but not at target
    [g] = tools.list_goals(store, TODAY)
    p = g["progress"]
    assert p["now_pace"] == 5.4 and p["target_pace"] == 5.0
    assert p["fraction"] == 0.2 and p["reached_on"] is None  # (5.5 - 5.4) / (5.5 - 5.0)
    run(store, 1, 8, 39.5)  # 4:56/km in the band: reached
    assert tools.list_goals(store, TODAY)[0]["status"] == "achieved"


def test_a_passed_date_is_overdue_never_failed(store):
    store.insert_goal({"kind": "climb_grade", "grade": "black", "climb_mode": "send", "band": None,
                       "target_pace": None, "target_date": day(3), "created_on": day(40)})
    [g] = tools.list_goals(store, TODAY)
    assert g["overdue"] is True and g["status"] == "active"
    assert "fail" not in json.dumps(g).lower()


def test_the_agent_can_set_and_read_goals_in_both_modes(store):
    for auto_save in (False, True):
        names = [t["name"] for t in tools.tools_for(auto_save)]
        assert "set_goal" in names and "get_goals" in names
    tools.run_tool(store, "set_goal", {"kind": "climb_grade", "grade": "red", "climb_mode": "send"})
    [g] = json.loads(tools.run_tool(store, "get_goals", {}))
    assert g["grade"] == "red" and goals.describe(g) == "send a red"


@pytest.fixture
def http(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def test_goal_api_add_move_pause_let_go_and_delete(http):
    later = (date.today() + timedelta(days=90)).isoformat()
    res = http.post("/goals", json={"kind": "climb_grade", "grade": "red", "climb_mode": "send",
                                    "target_date": later})
    assert res.status_code == 201
    gid = res.json()["id"]
    assert http.get("/goals").json()[0]["progress"]["of"] == 5

    sooner = (date.today() + timedelta(days=30)).isoformat()
    assert http.patch(f"/goals/{gid}", json={"target_date": sooner}).json()["target_date"] == sooner
    assert http.patch(f"/goals/{gid}", json={"target_date": None}).json()["target_date"] is None
    assert http.patch(f"/goals/{gid}", json={"status": "paused"}).json()["status"] == "paused"
    assert http.patch(f"/goals/{gid}", json={"status": "dropped"}).json()["status"] == "dropped"

    past = (date.today() - timedelta(days=1)).isoformat()
    assert http.patch(f"/goals/{gid}", json={"target_date": past}).status_code == 422
    assert http.patch(f"/goals/{gid}", json={"status": "achieved"}).status_code == 422
    assert http.patch(f"/goals/{gid}", json={}).status_code == 422
    assert http.delete(f"/goals/{gid}").status_code == 204
    assert http.delete(f"/goals/{gid}").status_code == 404
    assert http.post("/goals", json={"kind": "run_pace", "band": "7_to_15km"}).status_code == 422
