"""Change proposals for the current plan (#131, docs/training-plans.md
sections 4 and 6, mockup 4): propose_plan_change proposes only the changes,
stores nothing, and runs the new plan's guardrails on the plan as it would be
afterwards; POST /plans/{id}/changes applies all of them, or the ones the user
picked, in one transaction, and refuses a stale proposal. Offline, on the
in-memory store."""

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import api
import chat
import plans
import tools

TODAY = date(2026, 11, 18)  # a Wednesday; the plan starts next Monday


def build(store, today: date = TODAY) -> dict:
    """A 4-week running plan from the Monday after `today` (Tue easy, Thu tempo,
    Sat long; week 4 lighter) on 30 days of 6 km runs, inside L1a, L1b and L2."""
    for days_ago in range(1, 30, 2):
        store.insert_session({"sport": "running", "date": (today - timedelta(days=days_ago)).isoformat(),
                              "duration_min": 36, "effort": 4, "distance_km": 6.0})
    start = today + timedelta(days=7 - today.weekday())

    def run(offset, km, minutes=36, effort=4):
        kind = {1: "easy", 3: "tempo", 5: "long"}[offset % 7]
        target = {"duration_min": minutes, "effort": effort, "distance_km": km, "session_type": kind}
        if kind == "tempo":
            target["workout"] = "20 min at tempo effort between 10 min easy"
        return {"date": (start + timedelta(days=offset)).isoformat(), "sport": "running",
                "title": f"{kind.title()} run", "target": target}

    sessions = [run(1, 6), run(3, 6), run(5, 6.5, 39, 5),
                run(8, 6), run(10, 6.5, 39, 5), run(12, 7.1, 43, 5),
                run(15, 6.5, 39), run(17, 7, 42, 5), run(19, 7.8, 47, 6),
                run(22, 5, 30, 3), run(24, 5, 30, 3), run(26, 6)]
    return plans.create_plan(store, {"name": "4 weeks of running", "start_date": start.isoformat(), "weeks": 4,
                                     "week_meta": [{"index": 4, "kind": "deload"}], "source": "coach",
                                     "sessions": sessions}, today=today)


def session(plan: dict, title: str, week: int = 1) -> dict:
    return next(s for s in plan["sessions"] if s["title"] == title and s["week"] == week)


def propose(store, changes, today: date = TODAY, **kw):
    return plans.propose_plan_change(store, today=today, changes=changes,
                                     reason=kw.pop("reason", "Friday suits you better this week."), **kw)


def accept(store, proposal, changes=None, today: date = TODAY):
    a = proposal["accept"]
    return plans.apply_plan_change(store, proposal["plan"]["id"], a["version"],
                                   a["changes"] if changes is None else changes, a["context"], today=today)


# --- Proposing ----------------------------------------------------------------------------

def test_move_thursdays_run_to_friday_is_one_change_and_nothing_is_stored(store):
    plan = build(store)
    thu = session(plan, "Tempo run")
    before = json.dumps(store.planned_rows)
    friday = (date.fromisoformat(thu["date"]) + timedelta(days=1)).isoformat()

    out = propose(store, [{"type": "move", "planned_id": thu["id"], "date": friday}])

    assert out["change_proposal"] is True and out["stored"] is False
    assert json.dumps(store.planned_rows) == before  # nothing stored
    assert out["changes"] == [{"index": 0, "type": "move", "label": "Move",
                               "description": "Move the Tempo run on Thursday 26 Nov to Friday"}]
    assert out["accept"]["changes"] == [{"type": "move", "planned_id": thu["id"], "date": friday}]
    assert out["version"] == out["accept"]["version"] == plans.plan_version(store.plans()[0], store.planned_rows)
    assert out["reason"] == "Friday suits you better this week."
    # Only the diff: no new plan, no sessions list.
    assert "sessions" not in out["plan"] and "proposal" not in out


def test_within_the_coming_week_the_day_name_is_enough(store):
    plan = build(store)
    thu = session(plan, "Tempo run")
    monday = date.fromisoformat(plan["start_date"])
    out = propose(store, [{"type": "move", "planned_id": thu["id"], "date": (monday + timedelta(days=4)).isoformat()}],
                  today=monday)
    assert out["changes"][0]["description"] == "Move Thursday's Tempo run to Friday"


def test_each_kind_of_change_gets_a_plain_line(store):
    plan = build(store)
    monday = date.fromisoformat(plan["start_date"])
    tue, sat = session(plan, "Easy run"), session(plan, "Long run")
    week2_tue = session(plan, "Easy run", 2)
    out = propose(store, [
        {"type": "remove", "planned_id": tue["id"], "reason": "work trip"},
        {"type": "edit", "planned_id": sat["id"], "title": "Easy long run"},
        {"type": "lighter", "week": 2, "sessions": [{"planned_id": week2_tue["id"], "duration_min": 30,
                                                     "distance_km": 5}]},
    ], today=monday)
    assert [c["description"] for c in out["changes"]] == [
        "Skip Tuesday's Easy run",
        "Rename Saturday's Long run to Easy long run",
        "Make week 2 lighter: the Easy run on Tuesday 1 Dec 36 → 30 min, 6 → 5 km",
    ]
    assert [c["label"] for c in out["changes"]] == ["Skip", "Edit", "Lighter"]
    assert any("needs source" in w for w in out["warnings"])  # how much lighter has no number


def test_no_plan_means_nothing_to_change_and_propose_program_points_to_change_mode(store):
    with pytest.raises(ValueError, match="no current plan"):
        propose(store, [{"type": "shift", "days": 7}])
    build(store)
    with pytest.raises(ValueError, match="propose_plan_change"):
        plans.propose_program(store, today=TODAY, name="x", start_date="2026-11-30", weeks=4, rationale="x",
                              sessions=[], sessions_per_week=3, available_days=["tue"], injury_or_pain="none")


# --- Done sessions --------------------------------------------------------------------------

def test_done_sessions_cant_be_moved_removed_or_made_lighter(store):
    plan = build(store)
    tue = session(plan, "Easy run")
    sid = store.insert_session({"sport": "running", "date": tue["date"], "duration_min": 35, "effort": 4,
                                "distance_km": 6.0})
    plans.link_planned(store, tue["id"], sid)
    other_day = (date.fromisoformat(tue["date"]) + timedelta(days=1)).isoformat()
    for change in ({"type": "move", "planned_id": tue["id"], "date": other_day},
                   {"type": "remove", "planned_id": tue["id"]},
                   {"type": "lighter", "week": 1, "sessions": [{"planned_id": tue["id"], "remove": True}]}):
        with pytest.raises(ValueError, match="is done"):
            propose(store, [change])


def test_a_shift_leaves_done_and_skipped_sessions_where_they_are(store):
    plan = build(store)
    monday = date.fromisoformat(plan["start_date"])
    tue, thu = session(plan, "Easy run"), session(plan, "Tempo run")
    sid = store.insert_session({"sport": "running", "date": tue["date"], "duration_min": 35, "effort": 4,
                                "distance_km": 6.0})
    plans.link_planned(store, tue["id"], sid)
    plans.skip_planned(store, thu["id"])
    wednesday = monday + timedelta(days=2)
    # A week later, from Wednesday of week 1: the plan grows to 5 weeks, and week 2 is the break.
    out = propose(store, [{"type": "shift", "days": 7}], today=wednesday)
    assert out["changes"][0]["description"] == "Move the remaining 10 sessions a week later (the plan now ends 27 Dec)"
    result = accept(store, out, today=wednesday)["plan"]
    by_id = {s["id"]: s for s in result["sessions"]}
    assert by_id[tue["id"]]["date"] == tue["date"] and by_id[thu["id"]]["date"] == thu["date"]
    sat = session(plan, "Long run")
    assert by_id[sat["id"]]["date"] == (date.fromisoformat(sat["date"]) + timedelta(days=7)).isoformat()
    assert result["weeks"] == 5
    assert [w["kind"] for w in result["week_meta"]] == ["build", "deload", "build", "build", "deload"]


# --- Guardrails ----------------------------------------------------------------------------

def test_the_guardrails_refuse_a_change_that_breaks_a_rule(store):
    plan = build(store)
    sat = session(plan, "Long run")
    # L1a: a 12 km run after 6 km runs.
    with pytest.raises(ValueError, match=r"break the plan's rules.*L1a"):
        propose(store, [{"type": "edit", "planned_id": sat["id"],
                         "target": {**sat["target"], "distance_km": 12, "duration_min": 70}}])
    # The user's days and sessions a week, as for a new plan.
    with pytest.raises(ValueError, match="not one of the user's days"):
        propose(store, [{"type": "move", "planned_id": sat["id"],
                         "date": (date.fromisoformat(sat["date"]) + timedelta(days=1)).isoformat()}],
                available_days=["tuesday", "thursday", "saturday"])
    extra = {"type": "add", "session": {"date": (date.fromisoformat(sat["date"]) - timedelta(days=4)).isoformat(),
                                        "sport": "climbing", "title": "Bouldering",
                                        "target": {"duration_min": 60, "effort": 6}}}
    with pytest.raises(ValueError, match="week 1 has 4 sessions; the user said 3"):
        propose(store, [extra], sessions_per_week=3)
    # Without sessions a week, no week grows past the plan's busiest.
    with pytest.raises(ValueError, match="more than the plan's busiest week"):
        propose(store, [extra])
    # An added session needs load, and a run a type, like a proposal.
    with pytest.raises(ValueError, match="needs duration_min and effort"):
        propose(store, [{"type": "add", "session": {**extra["session"], "target": {}}},
                        {"type": "remove", "planned_id": sat["id"]}])


def test_a_whole_week_shift_after_a_pause_keeps_the_lighter_weeks(store):
    plan = build(store)
    # From week 2: weeks 2-4 move a week later and week 2 is the break (a
    # lighter week), so no more than three full weeks run in a row (L2).
    week2 = date.fromisoformat(plan["start_date"]) + timedelta(days=7)
    out = propose(store, [{"type": "shift", "days": 7, "from_date": week2.isoformat()}])
    assert out["changes"][0]["description"] == ("Move the remaining 9 sessions a week later "
                                                "(the plan now ends 27 Dec)")
    assert [w["kind"] for w in out["weekly_after"]] == ["build", "deload", "build", "build", "deload"]


def test_a_lighter_week_made_heavier_is_refused(store):
    plan = build(store)
    tue = session(plan, "Easy run", 4)
    # Week 4 is the lighter week: its load must stay below week 3's (L2).
    with pytest.raises(ValueError, match=r"week 4 is marked lighter .* \(L2, P27\)"):
        propose(store, [{"type": "edit", "planned_id": tue["id"],
                         "target": {**tue["target"], "duration_min": 90, "effort": 6}}])


def test_a_lighter_week_never_raises_anything_and_must_end_lighter(store):
    plan = build(store)
    tue = session(plan, "Easy run", 2)
    with pytest.raises(ValueError, match="never raises effort"):
        propose(store, [{"type": "lighter", "week": 2, "sessions": [{"planned_id": tue["id"], "effort": 6}]}])
    with pytest.raises(ValueError, match="nothing gets lighter"):
        propose(store, [{"type": "lighter", "week": 2, "sessions": [{"planned_id": tue["id"], "duration_min": 36}]}])
    with pytest.raises(ValueError, match="isn't in week 2"):
        propose(store, [{"type": "lighter", "week": 2,
                         "sessions": [{"planned_id": session(plan, "Easy run")["id"], "remove": True}]}])


def test_changes_stay_inside_the_plan_and_out_of_the_past(store):
    plan = build(store)
    tue = session(plan, "Easy run")
    with pytest.raises(ValueError, match="in the past"):
        propose(store, [{"type": "move", "planned_id": tue["id"], "date": TODAY.isoformat()}],
                today=date.fromisoformat(tue["date"]))
    with pytest.raises(ValueError, match="outside the plan"):
        propose(store, [{"type": "move", "planned_id": tue["id"], "date": "2027-03-01"}])
    with pytest.raises(ValueError, match="isn't in this plan"):
        propose(store, [{"type": "remove", "planned_id": 999}])


def test_no_sessions_land_in_an_injury_pause(store):
    plan = build(store)
    sat = session(plan, "Long run")
    store.pauses.append({"id": 1, "start_date": TODAY.isoformat(), "planned_end": None, "ended_on": None,
                         "reason": "injury", "body_part": "knee", "pain": 4, "note": None, "resume_choice": None})
    with pytest.raises(ValueError, match="injury pause"):
        propose(store, [{"type": "move", "planned_id": sat["id"],
                         "date": (date.fromisoformat(sat["date"]) + timedelta(days=1)).isoformat()}])
    # Less is still fine during a pause.
    assert propose(store, [{"type": "remove", "planned_id": sat["id"]}])["changes"][0]["type"] == "remove"


# --- Accept ---------------------------------------------------------------------------------

def test_accept_applies_the_change_and_the_plan_view_shows_it(store):
    plan = build(store)
    thu = session(plan, "Tempo run")
    friday = (date.fromisoformat(thu["date"]) + timedelta(days=1)).isoformat()
    out = propose(store, [{"type": "move", "planned_id": thu["id"], "date": friday}])

    result = accept(store, out)

    assert result["applied"] == ["Move the Tempo run on Thursday 26 Nov to Friday"]
    moved = next(s for s in plans.get_plan(store, plan["id"], TODAY)["sessions"] if s["id"] == thu["id"])
    assert moved["date"] == friday and moved["title"] == "Tempo run"
    # Accepting the same proposal again is stale: the plan has changed.
    with pytest.raises(RuntimeError, match="changed since"):
        accept(store, out)


def test_review_applies_only_the_changes_the_user_picked(store):
    plan = build(store)
    tue, sat = session(plan, "Easy run"), session(plan, "Long run")
    out = propose(store, [{"type": "remove", "planned_id": tue["id"]},
                          {"type": "edit", "planned_id": sat["id"], "title": "Easy long run"}])
    result = accept(store, out, changes=[out["accept"]["changes"][1]])
    by_id = {s["id"]: s for s in result["plan"]["sessions"]}
    assert by_id[tue["id"]]["status"] == "planned"
    assert by_id[sat["id"]]["title"] == "Easy long run"


def test_a_stale_proposal_is_refused(store):
    plan = build(store)
    thu, sat = session(plan, "Tempo run"), session(plan, "Long run")
    out = propose(store, [{"type": "move", "planned_id": thu["id"],
                           "date": (date.fromisoformat(thu["date"]) + timedelta(days=1)).isoformat()}])
    plans.skip_planned(store, sat["id"])  # changed in the Plan view meanwhile
    before = json.dumps(store.planned_rows)
    with pytest.raises(RuntimeError, match="changed since this proposal"):
        accept(store, out)
    assert json.dumps(store.planned_rows) == before


def test_accept_rechecks_the_guardrails_for_the_subset_picked(store):
    plan = build(store)
    sat, tue = session(plan, "Long run"), session(plan, "Easy run")
    added = {"type": "add", "session": {"date": (date.fromisoformat(sat["date"]) - timedelta(days=4)).isoformat(),
                                        "sport": "climbing", "title": "Bouldering",
                                        "target": {"duration_min": 60, "effort": 6}}}
    out = propose(store, [{"type": "remove", "planned_id": tue["id"]}, added])
    # Without the removal, week 1 would be busier than the plan allows.
    with pytest.raises(ValueError, match="busiest week"):
        accept(store, out, changes=[out["accept"]["changes"][1]])


def test_a_failed_write_leaves_the_plan_as_it_was(store):
    plan = build(store)
    tue, sat = session(plan, "Easy run"), session(plan, "Long run")
    out = propose(store, [{"type": "remove", "planned_id": tue["id"]},
                          {"type": "edit", "planned_id": sat["id"], "title": "Easy long run"}])
    before = json.dumps(store.planned_rows)
    store.fail_next_change = True
    with pytest.raises(ValueError, match="a write failed"):
        accept(store, out)
    assert json.dumps(store.planned_rows) == before


# --- The coach and the API ---------------------------------------------------------------------

def test_the_tool_runs_through_run_tool_and_the_coach_is_told_how(store):
    plan = build(store, date.today())
    sat = session(plan, "Long run")
    out = json.loads(tools.run_tool(store, "propose_plan_change", {
        "changes": [{"type": "remove", "planned_id": sat["id"]}], "reason": "A lighter weekend."}))
    assert out["change_proposal"] is True and len(out["changes"]) == 1
    assert "propose_plan_change" in [t["name"] for t in tools.TOOLS]
    prompt = chat.SYSTEM_PROMPT
    assert "only the changes they" in prompt and "never a new plan" in prompt
    assert "Never change their goal without asking" in prompt
    assert "[User accepted the plan change: ...]" in prompt
    description = next(t for t in tools.TOOLS if t["name"] == "propose_plan_change")["description"]
    assert "ONLY the changes the user asked for" in description and "can't be moved" in description


@pytest.fixture
def http(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def test_the_changes_endpoint_applies_refuses_stale_and_rechecks(http, store):
    plan = build(store, date.today())
    sat, tue = session(plan, "Long run"), session(plan, "Easy run")
    out = plans.propose_plan_change(store, changes=[{"type": "edit", "planned_id": sat["id"], "title": "Easy long run"}],
                                    reason="A calmer weekend.")
    url = f"/plans/{plan['id']}/changes"

    r = http.post(url, json=out["accept"])
    assert r.status_code == 200, r.text
    assert r.json()["applied"] == [out["changes"][0]["description"]]
    assert {s["id"]: s for s in r.json()["plan"]["sessions"]}[sat["id"]]["title"] == "Easy long run"

    assert http.post(url, json=out["accept"]).status_code == 409  # stale now
    current = plans.plan_version(store.plans()[0], store.planned_rows)
    bad = {"version": current, "changes": [{"type": "remove", "planned_id": 999}]}
    assert http.post(url, json=bad).status_code == 422
    assert http.post("/plans/99/changes", json=bad).status_code == 404
    other = {"version": current, "changes": [{"type": "edit", "planned_id": tue["id"],
                                              "target": {**tue["target"], "distance_km": 14}}]}
    r = http.post(url, json=other)
    assert r.status_code == 422 and "L1a" in r.json()["detail"]
