"""Linking logged sessions to planned ones (#117, docs/training-plans.md section 6,
Q6 option A), from the Log form, "Log this" in the Plan view (#132) and the
coach. Offline, on the in-memory store."""

import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

import api
import plans
import tools
from test_propose_program import TODAY, day, history, propose, run


@pytest.fixture
def plan(store):
    """The 4-week plan: runs on Tuesday (day 1), Thursday (3) and Saturday (5) each week."""
    history(store)
    return plans.create_plan(store, propose(store)["accept"], today=TODAY)


@pytest.fixture
def http(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def log(store, when: str, sport: str = "running", **fields) -> dict:
    fields = {"duration_min": 40, "effort": 5, **({"distance_km": 6.0} if sport == "running" else {}), **fields}
    return tools.log_session(store, sport, when, **fields)


def state(store, plan, planned_id: int, today: str) -> str:
    out = plans.get_plan(store, plan["id"], today=date.fromisoformat(today))
    return next(s["state"] for s in out["sessions"] if s["id"] == planned_id)


def ids(plan) -> list[int]:
    return [s["id"] for s in plan["sessions"]]


# --- Matching ---------------------------------------------------------------------------

def test_a_single_same_day_match_is_linked_automatically_and_can_be_undone(store, plan):
    tuesday = ids(plan)[0]
    session = log(store, day(1))
    link = plans.link_after_logging(store, session)
    assert link["auto"] is True and link["linked"]["id"] == tuesday
    assert link["linked"]["session_id"] == session["id"] and link["linked"]["week"] == 1
    assert state(store, plan, tuesday, day(2)) == "done"
    # Undo: the planned session is open again; the logged one stays.
    assert plans.unlink_planned(store, tuesday)["session_id"] is None
    assert state(store, plan, tuesday, day(2)) == "not_done"
    assert store.get_session(session["id"]) is not None


def test_several_matches_are_returned_to_ask_and_nothing_is_linked(store, plan):
    plans.add_planned(store, {**run(1, 4, 25, 3, kind="easy"), "plan_id": plan["id"], "title": "Shakeout"})
    session = log(store, day(1))
    link = plans.link_after_logging(store, session)
    assert "linked" not in link
    assert sorted(c["title"] for c in link["candidates"]) == ["Easy run", "Shakeout"]
    assert all(p["session_id"] is None for p in store.planned_sessions())


def test_a_match_on_another_day_is_asked_about_not_linked(store, plan):
    """From the day before to two days after the planned day; only the same day links itself."""
    sunday = log(store, day(6))  # Saturday's long run (day 5) is the only match
    link = plans.link_after_logging(store, sunday)
    assert [c["date"] for c in link["candidates"]] == [day(5)]
    # Wednesday: Tuesday's run (the day before) and Thursday's (the day after), closest first.
    link = plans.link_after_logging(store, log(store, day(2)))
    assert [c["date"] for c in link["candidates"]] == [day(1), day(3)]
    assert all(p["session_id"] is None for p in store.planned_sessions())


def test_no_match_for_another_sport_a_skipped_or_done_session_or_an_ended_plan(store, plan):
    tuesday, thursday = ids(plan)[:2]
    assert plans.link_after_logging(store, log(store, day(1), "climbing")) == {}
    first = log(store, day(1))
    assert plans.link_after_logging(store, first)["linked"]["id"] == tuesday
    plans.skip_planned(store, thursday, "Travel")
    assert plans.link_after_logging(store, log(store, day(1))) == {}  # Tuesday done, Thursday skipped
    assert plans.link_after_logging(store, log(store, day(3))) == {}
    plans.leave_plan(store, plan["id"], today=date.fromisoformat(day(4)))
    assert plans.link_after_logging(store, log(store, day(5))) == {}


def test_a_planned_template_must_match(store, plan):
    template = tools.create_template(store, "Hangboard", "strength", [{"key": "sets", "label": "Sets", "type": "number"}])
    one_off = plans.add_planned(store, {"date": day(2), "sport": "strength", "title": "Hangboard",
                                        "template_id": template["id"], "target": {"duration_min": 30}})
    assert plans.link_after_logging(store, log(store, day(2), "strength")) == {}
    with_template = log(store, day(2), "strength", template_id=template["id"], values={"sets": 5})
    assert plans.link_after_logging(store, with_template)["linked"]["id"] == one_off["id"]


# --- Linking rules ----------------------------------------------------------------------

def test_a_session_counts_for_one_planned_session_and_one_planned_for_one_session(store, plan):
    tuesday, thursday = ids(plan)[:2]
    first, second = log(store, day(1)), log(store, day(3))
    plans.link_planned(store, tuesday, first["id"])
    with pytest.raises(ValueError, match="already counts for Easy run"):
        plans.link_planned(store, thursday, first["id"])
    with pytest.raises(ValueError, match="already done by another session"):
        plans.link_planned(store, tuesday, second["id"])
    with pytest.raises(ValueError, match="planned as running, not climbing"):
        plans.link_planned(store, thursday, log(store, day(3), "climbing")["id"])
    with pytest.raises(LookupError):
        plans.link_planned(store, thursday, 999)
    assert plans.link_planned(store, tuesday, first["id"])["session_id"] == first["id"]  # again: no change


def test_linking_a_skipped_session_makes_it_done(store, plan):
    thursday = ids(plan)[1]
    plans.skip_planned(store, thursday, "Travel")
    linked = plans.link_planned(store, thursday, log(store, day(4))["id"])
    assert linked["status"] == "planned" and linked["skip_reason"] is None
    assert state(store, plan, thursday, day(4)) == "done"


def test_deleting_a_logged_session_opens_its_planned_one_again(store, plan):
    tuesday = ids(plan)[0]
    session = log(store, day(1))
    plans.link_after_logging(store, session)
    tools.delete_session(store, session["id"])
    assert store.get_planned(tuesday)["session_id"] is None
    assert state(store, plan, tuesday, day(2)) == "not_done"


def test_a_linked_session_from_before_the_plan_still_counts(store, plan):
    tuesday = ids(plan)[0]
    early = log(store, TODAY.isoformat())  # before the plan starts, so get_plan doesn't fetch it
    plans.link_planned(store, tuesday, early["id"])
    out = plans.get_plan(store, plan["id"], today=date.fromisoformat(day(2)))
    assert out["sessions"][0]["state"] == "done" and out["sessions"][0]["done"]["id"] == early["id"]


# --- The API ------------------------------------------------------------------------------

def test_log_this_links_the_planned_session_even_on_another_day(http, store, plan):
    thursday = ids(plan)[1]
    body = {"sport": "running", "date": day(4), "duration_min": 40, "effort": 6, "distance_km": 6.5,
            "planned_id": thursday}
    out = http.post("/sessions", json=body).json()
    assert out["plan_link"]["auto"] is False and out["plan_link"]["linked"]["id"] == thursday
    assert store.get_planned(thursday)["session_id"] == out["id"]
    assert "planned_id" not in out


def test_log_this_is_checked_before_anything_is_stored(http, store, plan):
    before = len(store.rows)
    body = {"sport": "climbing", "date": day(1), "duration_min": 60, "effort": 6, "planned_id": ids(plan)[0]}
    res = http.post("/sessions", json=body)
    assert res.status_code == 422 and "planned as running" in res.json()["detail"]
    assert http.post("/sessions", json={**body, "sport": "running", "planned_id": 999}).status_code == 404
    assert len(store.rows) == before


def test_the_form_gets_the_auto_link_or_the_candidates(http, store, plan):
    body = {"sport": "running", "date": day(1), "duration_min": 40, "effort": 5, "distance_km": 6}
    auto = http.post("/sessions", json=body).json()["plan_link"]
    assert auto["auto"] is True and auto["linked"]["id"] == ids(plan)[0]
    asked = http.post("/sessions", json={**body, "date": day(2)}).json()
    assert [c["id"] for c in asked["plan_link"]["candidates"]] == [ids(plan)[1]]  # Tuesday is done now
    none = http.post("/sessions", json={**body, "sport": "climbing", "distance_km": None}).json()
    assert none["plan_link"] == {}


def test_link_and_unlink_endpoints(http, store, plan):
    thursday = ids(plan)[1]
    session = http.post("/sessions", json={"sport": "running", "date": day(2), "duration_min": 40,
                                           "effort": 5, "distance_km": 6}).json()
    linked = http.post(f"/planned-sessions/{thursday}/link", json={"session_id": session["id"]})
    assert linked.status_code == 200 and linked.json()["session_id"] == session["id"]
    assert http.post(f"/planned-sessions/{ids(plan)[0]}/link",
                     json={"session_id": session["id"]}).status_code == 422
    assert http.post(f"/planned-sessions/{thursday}/link", json={"session_id": 999}).status_code == 404
    assert http.delete(f"/planned-sessions/{thursday}/link").json()["session_id"] is None
    assert http.delete("/planned-sessions/999/link").status_code == 404


# --- The coach ----------------------------------------------------------------------------

def test_the_coachs_log_session_links_todays_planned_session(store, plan):
    out = json.loads(tools.run_tool(store, "log_session", {"sport": "running", "date": day(1), "duration_min": 40,
                                                            "effort": 5, "distance_km": 6}))
    assert out["plan_link"]["auto"] is True and out["plan_link"]["linked"]["id"] == ids(plan)[0]
    # Nothing planned for climbing: no plan_link at all.
    out = json.loads(tools.run_tool(store, "log_session", {"sport": "climbing", "date": day(1),
                                                            "duration_min": 60, "effort": 6}))
    assert "plan_link" not in out


def test_the_coach_links_the_one_the_user_names_and_can_undo(store, plan):
    thursday = ids(plan)[1]
    out = json.loads(tools.run_tool(store, "log_session", {"sport": "running", "date": day(2), "duration_min": 40,
                                                            "effort": 5, "distance_km": 6}))
    assert [c["id"] for c in out["plan_link"]["candidates"]] == [ids(plan)[0], thursday]
    linked = json.loads(tools.run_tool(store, "link_planned_session", {"planned_id": thursday, "session_id": out["id"]}))
    assert linked["session_id"] == out["id"]
    undone = json.loads(tools.run_tool(store, "link_planned_session", {"planned_id": thursday, "session_id": None}))
    assert undone["session_id"] is None
    with pytest.raises(ValueError, match="not found"):  # a tool error the coach sees, not a crash
        tools.run_tool(store, "link_planned_session", {"planned_id": 999, "session_id": out["id"]})
    desc = next(t for t in tools.TOOLS if t["name"] == "link_planned_session")["description"]
    assert "Was this Thursday's Easy run?" in desc and "Never link without a match" in desc
