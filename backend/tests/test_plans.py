"""Training plans and planned sessions (#116, docs/training-plans.md sections 3, 5 and 7).

Offline: validation, limits and planned load in plans.py, the operations on
the in-memory store (conftest.FakeStore), and the API routes.
"""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import api
import plans
import tools

TODAY = date(2026, 11, 18)          # a Wednesday
THIS_MONDAY = "2026-11-16"
NEXT_MONDAY = "2026-11-23"

HANGBOARD = {"label": "Hangboard", "type": "number", "required": True,
             "measures": [{"label": "kg", "decimals": 1}, {"label": "s"}, {"label": "sets"}]}

RUN = {"date": "2026-11-24", "sport": "running", "title": "Easy run",
       "target": {"duration_min": 35, "effort": 4, "distance_km": 6}}
CLIMB = {"date": "2026-11-25", "sport": "climbing", "title": "Limit bouldering",
         "target": {"duration_min": 90, "effort": 8, "grades": [{"grade": "red", "count": 3}]}}


def plan_body(**over) -> dict:
    return {"name": "6 weeks to a red", "start_date": NEXT_MONDAY, "weeks": 6,
            "week_meta": [{"index": 4, "kind": "deload", "note": "lighter week"}],
            "rationale": "Two climbing days and one easy run a week.", "source": "coach",
            "sessions": [RUN, CLIMB], **over}


def validate(body: dict, store=None, **kw):
    store = store
    return plans.validate_plan(body, goals=store.goals() if store else [],
                               templates=store.templates() if store else [],
                               gym_list=store.gyms() if store else [], today=TODAY, **kw)


def board(store) -> dict:
    return tools.create_template(store, "Board", "other", [HANGBOARD])


# --- What a plan is -----------------------------------------------------------------------

def test_a_valid_plan_gets_every_week_slots_and_planned_load():
    row, rows = validate(plan_body())
    assert row["weeks"] == 6 and row["start_date"] == NEXT_MONDAY and row["source"] == "coach"
    assert [w["kind"] for w in row["week_meta"]] == ["build", "build", "build", "deload", "build", "build"]
    assert row["week_meta"][3]["note"] == "lighter week"
    assert [r["slot"] for r in rows] == [0, 0]
    assert rows[0]["target"] == {"duration_min": 35, "effort": 4, "distance_km": 6.0}
    plan = {**row, "id": 1}
    weekly = plans.weekly_load(plan, [{**r, "id": i, "plan_id": 1} for i, r in enumerate(rows)])
    assert weekly[0] == {"index": 1, "kind": "build", "week_start": NEXT_MONDAY,
                         "sessions": 2, "planned_load": 35 * 4 + 90 * 8}
    assert weekly[3]["kind"] == "deload" and weekly[1]["planned_load"] == 0


@pytest.mark.parametrize("over, message", [
    ({"start_date": "2026-11-24"}, "starts on a Monday"),
    ({"start_date": "2026-11-09"}, "before this week"),
    ({"start_date": "24.11.2026"}, "YYYY-MM-DD"),
    ({"weeks": 3}, "between 4 and 12"),
    ({"weeks": 13}, "between 4 and 12"),
    ({"weeks": 4.5}, "whole number"),
    ({"name": "  "}, "name is required"),
    ({"name": "x" * 61}, "at most 60"),
    ({"rationale": "x" * 301}, "at most 300"),
    ({"source": "robot"}, "source"),
    ({"week_meta": [{"index": 7, "kind": "build"}]}, "between 1 and 6"),
    ({"week_meta": [{"index": 2, "kind": "rest"}]}, "week kind"),
    ({"week_meta": [{"index": 2, "kind": "build"}, {"index": 2, "kind": "test"}]}, "twice"),
    ({"goal_id": 99}, "goal 99 not found"),
    ({"sessions": [{**RUN, "date": "2027-01-04"}]}, "outside the plan"),
    ({"sessions": [{**RUN, "date": "2026-11-22"}]}, "outside the plan"),
    ({"sessions": [RUN, RUN, RUN]}, "at most 2 planned sessions a day"),
    ({"sessions": [{**RUN, "sport": "yoga"}]}, "sport must be"),
    ({"sessions": [{**RUN, "title": ""}]}, "title is required"),
    ({"sessions": [{**RUN, "colour": "red"}]}, "unknown planned session fields"),
    ({"surprise": 1}, "unknown plan fields"),
])
def test_invalid_plans_are_refused(over, message):
    with pytest.raises(ValueError, match=message):
        validate(plan_body(**over))


def test_this_weeks_monday_is_a_valid_start():
    row, _ = validate(plan_body(start_date=THIS_MONDAY, sessions=[]))
    assert row["start_date"] == THIS_MONDAY


def test_a_goals_date_sets_the_length_when_4_to_12_weeks_away(store):
    """Q4: the week that holds the goal's date is the plan's last."""
    goal = store.insert_goal({"kind": "climb_grade", "grade": "red", "climb_mode": "send",
                              "target_date": "2027-01-02", "created_on": "2026-11-18"})
    row, _ = validate(plan_body(weeks=None, goal_id=goal["id"]), store)
    assert row["weeks"] == 6 and row["goal_id"] == goal["id"]
    # An explicit length still wins.
    assert validate(plan_body(weeks=8, goal_id=goal["id"]), store)[0]["weeks"] == 8
    # Too far away (or too close): the user picks the length.
    store.update_goal(goal["id"], {"target_date": "2027-06-01"})
    with pytest.raises(ValueError, match="weeks is required"):
        validate(plan_body(weeks=None, goal_id=goal["id"]), store)
    store.update_goal(goal["id"], {"status": "dropped"})
    with pytest.raises(ValueError, match="open goal"):
        validate(plan_body(goal_id=goal["id"]), store)


# --- Targets --------------------------------------------------------------------------------

def test_every_target_is_optional():
    assert plans.validate_target("running", None) == {}
    assert plans.validate_target("running", {"duration_min": 30}) == {"duration_min": 30}
    assert plans.planned_load({"duration_min": 30}) is None
    assert plans.planned_load({"duration_min": 30, "effort": 5}) == 150


@pytest.mark.parametrize("sport, target, message", [
    ("climbing", {"distance_km": 5}, "not valid for this climbing session"),
    ("running", {"grades": []}, "not valid for this running session"),
    ("running", {"values": {}}, "not valid"),
    ("running", {"effort": 11}, "between 1 and 10"),
    ("running", {"effort": True}, "whole number"),
    ("running", {"duration_min": 0}, "between 1 and 600"),
    ("running", {"distance_km": -1}, "between 0 and 200"),
    ("climbing", {"grades": [{"grade": "pink"}]}, "grade must be one of"),
    ("climbing", {"grades": [{"system": "v", "grade": "V99"}]}, "is not a V grade"),
    ("climbing", {"grades": [{"system": "v", "grade": "V4", "gym_id": 1}]}, "has no gym"),
    ("climbing", {"grades": [{"grade": "red", "count": 0}]}, "between 1 and 50"),
    ("climbing", {"grades": [{"grade": "red"}] * 11}, "at most 10"),
    ("running", "fast", "must be an object"),
])
def test_bad_targets_are_refused(sport, target, message):
    with pytest.raises(ValueError, match=message):
        plans.validate_target(sport, target)


def test_grade_targets_in_any_system():
    out = plans.validate_target("climbing", {"grades": [
        {"grade": "Red", "count": 3}, {"system": "v", "grade": "v4", "count": 2},
        {"system": "font", "grade": "6b+"}]})
    assert out["grades"] == [{"system": "gym", "grade": "red", "count": 3},
                             {"system": "v", "grade": "V4", "count": 2},
                             {"system": "font", "grade": "6B+", "count": 1}]


def test_template_targets_use_the_templates_measures_and_may_be_partial(store):
    t = board(store)
    item = {"date": "2026-11-27", "sport": "other", "template_id": t["id"], "title": "Hangboard",
            "target": {"duration_min": 30, "effort": 7, "values": {"hangboard": {"kg": 5, "s": 10, "sets": 6}}}}
    row = plans.validate_planned(item, store.templates())
    assert row["target"]["values"] == {"hangboard": {"kg": 5, "s": 10, "sets": 6}}
    # A required field needn't be planned: every target is optional.
    assert plans.validate_planned({**item, "target": {}}, store.templates())["target"] == {}
    with pytest.raises(ValueError, match="whole numbers"):
        plans.validate_planned({**item, "target": {"values": {"hangboard": {"sets": 6.5}}}}, store.templates())
    with pytest.raises(ValueError, match="no such fields"):
        plans.validate_planned({**item, "target": {"values": {"crimps": 3}}}, store.templates())
    with pytest.raises(ValueError, match="is for other, not running"):
        plans.validate_planned({**item, "sport": "running"}, store.templates())
    with pytest.raises(ValueError, match="template 99 not found"):
        plans.validate_planned({**item, "template_id": 99}, store.templates())
    tools.update_template(store, t["id"], {"archived": True})
    with pytest.raises(ValueError, match="archived"):
        plans.validate_planned(item, store.templates())


def test_the_load_rules_are_placeholders_until_sourced():
    assert plans.RULES and all(r == {"value": None, "status": "needs source"} for r in plans.RULES.values())


# --- Operations on the store -------------------------------------------------------------

def test_create_read_and_one_current_plan(store):
    plan = plans.create_plan(store, plan_body(), today=TODAY)
    assert plan["status"] == "active" and plan["end_date"] == "2027-01-03"
    assert [s["title"] for s in plan["sessions"]] == ["Easy run", "Limit bouldering"]
    assert plan["sessions"][0]["week"] == 1 and plan["sessions"][0]["planned_load"] == 140
    assert plans.current_plan(store)["id"] == plan["id"]
    # Q3: one active or paused plan at a time.
    with pytest.raises(RuntimeError, match="already an active plan"):
        plans.create_plan(store, plan_body(), today=TODAY)
    plans.update_plan(store, plan["id"], {"status": "paused"}, today=TODAY)
    with pytest.raises(RuntimeError):
        plans.create_plan(store, plan_body(), today=TODAY)


def test_leaving_keeps_the_plan_and_its_sessions(store):
    plan = plans.create_plan(store, plan_body(), today=TODAY)
    left = plans.leave_plan(store, plan["id"], today=TODAY)
    assert left["status"] == "left" and left["ended_on"] == "2026-11-18"
    assert len(left["sessions"]) == 2
    assert plans.current_plan(store) is None
    second = plans.create_plan(store, plan_body(name="Base"), today=TODAY)
    # A left plan can't come back while another is current.
    with pytest.raises(RuntimeError):
        plans.update_plan(store, plan["id"], {"status": "active"}, today=TODAY)
    assert plans.update_plan(store, second["id"], {"status": "finished"}, today=TODAY)["ended_on"] == "2026-11-18"
    with pytest.raises(LookupError):
        plans.leave_plan(store, 99)


def test_update_plan_changes_names_and_week_kinds_only(store):
    plan = plans.create_plan(store, plan_body(), today=TODAY)
    out = plans.update_plan(store, plan["id"], {"name": "Red by New Year",
                                                "week_meta": [{"index": 6, "kind": "test"}]})
    assert out["name"] == "Red by New Year" and out["week_meta"][5]["kind"] == "test"
    assert out["week_meta"][3]["kind"] == "build"  # the new list replaces the old one
    for bad in ({"weeks": 8}, {"status": "left"}, {}):
        with pytest.raises(ValueError):
            plans.update_plan(store, plan["id"], bad)


def test_one_offs_sit_next_to_a_plan(store):
    """Q3: a planned session without a plan keeps its slot when a plan arrives."""
    one_off = plans.add_planned(store, {**RUN, "title": "Run with Sam"})
    assert one_off["plan_id"] is None and one_off["slot"] == 0 and one_off["week"] is None
    plan = plans.create_plan(store, plan_body(), today=TODAY)
    run = next(s for s in plan["sessions"] if s["title"] == "Easy run")
    assert run["slot"] == 1  # same day as the one-off
    with pytest.raises(ValueError, match="at most 2"):
        plans.add_planned(store, {**RUN, "plan_id": plan["id"]})
    listed = plans.list_planned(store, NEXT_MONDAY, "2026-11-29")
    assert [s["title"] for s in listed] == ["Run with Sam", "Easy run", "Limit bouldering"]
    assert listed[1]["week"] == 1


def test_move_skip_edit_and_remove(store):
    plan = plans.create_plan(store, plan_body(), today=TODAY)
    run = plan["sessions"][0]
    moved = plans.move_planned(store, run["id"], "2026-11-26")
    assert moved["date"] == "2026-11-26" and moved["slot"] == 0
    with pytest.raises(ValueError, match="outside the plan"):
        plans.move_planned(store, run["id"], "2027-02-01")
    plans.add_planned(store, {**RUN, "date": "2026-11-28", "plan_id": plan["id"]})
    plans.add_planned(store, {**RUN, "date": "2026-11-28", "plan_id": plan["id"], "title": "Strides"})
    with pytest.raises(ValueError, match="at most 2"):
        plans.move_planned(store, run["id"], "2026-11-28")

    skipped = plans.skip_planned(store, run["id"], "Sick")
    assert skipped["status"] == "skipped" and skipped["skip_reason"] == "Sick"
    week1 = plans.get_plan(store, plan["id"])["weekly"][0]
    assert week1["planned_load"] == 90 * 8 + 2 * 140  # the skipped run doesn't count
    back = plans.skip_planned(store, run["id"], skip=False)
    assert back["status"] == "planned" and back["skip_reason"] is None

    edited = plans.edit_planned(store, run["id"], {"target": {"duration_min": 45, "effort": 5}})
    assert edited["target"] == {"duration_min": 45, "effort": 5} and edited["planned_load"] == 225
    with pytest.raises(ValueError, match="not valid for this climbing"):
        plans.edit_planned(store, run["id"], {"sport": "climbing", "target": {"distance_km": 5}})
    with pytest.raises(ValueError, match="use move or skip"):
        plans.edit_planned(store, run["id"], {"date": "2026-11-27"})

    plans.remove_planned(store, run["id"])
    with pytest.raises(LookupError):
        plans.remove_planned(store, run["id"])
    with pytest.raises(LookupError):
        plans.move_planned(store, run["id"], "2026-11-27")


def test_an_edit_may_keep_an_archived_template(store):
    t = board(store)
    p = plans.add_planned(store, {"date": "2026-11-27", "sport": "other", "template_id": t["id"],
                                  "title": "Hangboard", "target": {"values": {"hangboard": {"kg": 5}}}})
    tools.update_template(store, t["id"], {"archived": True})
    assert plans.edit_planned(store, p["id"], {"title": "Max hangs"})["template_id"] == t["id"]
    with pytest.raises(ValueError, match="sessions or plans use"):
        store.delete_template(t["id"])


def test_no_new_sessions_on_an_ended_plan(store):
    plan = plans.create_plan(store, plan_body(), today=TODAY)
    plans.leave_plan(store, plan["id"], today=TODAY)
    with pytest.raises(ValueError, match="has ended"):
        plans.add_planned(store, {**RUN, "plan_id": plan["id"]})
    with pytest.raises(ValueError, match="plan 99 not found"):
        plans.add_planned(store, {**RUN, "plan_id": 99})


def test_list_planned_needs_a_sane_range(store):
    with pytest.raises(ValueError, match="run forwards"):
        plans.list_planned(store, "2026-12-01", "2026-11-01")
    with pytest.raises(ValueError, match="at most 24 weeks"):
        plans.list_planned(store, "2026-01-01", "2026-12-31")


# --- API -------------------------------------------------------------------------------------

@pytest.fixture
def http(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def _next_monday() -> date:
    today = date.today()
    return today + timedelta(days=7 - today.weekday())


def test_plan_endpoints(http):
    start = _next_monday()
    day = (start + timedelta(days=1)).isoformat()
    body = {**plan_body(start_date=start.isoformat()),
            "sessions": [{**RUN, "date": day}, {**CLIMB, "date": day}]}
    assert http.get("/plans").json() == {"current": None, "plans": []}

    r = http.post("/plans", json=body)
    assert r.status_code == 201, r.text
    plan = r.json()
    assert plan["weekly"][0]["planned_load"] == 140 + 720
    assert [s["slot"] for s in plan["sessions"]] == [0, 1]

    assert http.get("/plans").json()["current"]["id"] == plan["id"]
    assert http.get(f"/plans/{plan['id']}").json()["name"] == "6 weeks to a red"
    assert http.post("/plans", json=body).status_code == 409
    assert http.post("/plans", json={**body, "start_date": day}).status_code == 409  # conflict first
    assert http.get("/plans/99").status_code == 404
    assert http.patch(f"/plans/{plan['id']}", json={"status": "paused"}).json()["status"] == "paused"
    assert http.patch(f"/plans/{plan['id']}", json={"status": "left"}).status_code == 422
    assert http.post(f"/plans/{plan['id']}/leave").json()["status"] == "left"
    assert http.post("/plans", json={**body, "start_date": day}).status_code == 422  # not a Monday


def test_planned_session_endpoints(http):
    day = _next_monday().isoformat()
    r = http.post("/planned-sessions", json={**RUN, "date": day})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["plan_id"] is None and p["planned_load"] == 140

    later = (_next_monday() + timedelta(days=2)).isoformat()
    assert http.post(f"/planned-sessions/{p['id']}/move", json={"date": later}).json()["date"] == later
    assert http.post(f"/planned-sessions/{p['id']}/skip", json={"reason": "Travel"}).json()["status"] == "skipped"
    assert http.delete(f"/planned-sessions/{p['id']}/skip").json()["status"] == "planned"
    assert http.patch(f"/planned-sessions/{p['id']}", json={"title": "Tempo"}).json()["title"] == "Tempo"
    assert http.patch(f"/planned-sessions/{p['id']}", json={"target": {"effort": 12}}).status_code == 422
    listed = http.get("/planned-sessions", params={"from": day, "to": later}).json()
    assert [s["id"] for s in listed] == [p["id"]]
    assert http.get("/planned-sessions", params={"from": later, "to": day}).status_code == 422
    assert http.delete(f"/planned-sessions/{p['id']}").status_code == 204
    assert http.delete(f"/planned-sessions/{p['id']}").status_code == 404
    assert http.post("/planned-sessions/99/skip", json={}).status_code == 404
