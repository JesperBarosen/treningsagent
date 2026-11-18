"""The coach's plan tools (#119): propose_program and get_plan, the load rules
they apply (docs/training-plans.md section 5) and the derived status the Plan
view shows (#118). Offline, on the in-memory store."""

import json
from datetime import date, timedelta

import pytest

import api
import chat
import plans
import tools

TODAY = date(2026, 11, 18)          # a Wednesday
START = date(2026, 11, 23)          # next Monday


def day(offset: int) -> str:
    """A date `offset` days after the plan's start."""
    return (START + timedelta(days=offset)).isoformat()


def history(store, km: float = 6.0) -> None:
    """A run every other day for 30 days: 18 km in the last 7 days, longest `km`."""
    for days_ago in range(1, 30, 2):
        store.insert_session({"sport": "running", "date": (TODAY - timedelta(days=days_ago)).isoformat(),
                              "duration_min": 36, "effort": 4, "distance_km": km})


def run(offset: int, km: float, minutes: int = 36, effort: int = 4) -> dict:
    return {"date": day(offset), "sport": "running", "title": "Run",
            "target": {"duration_min": minutes, "effort": effort, "distance_km": km}}


# Inside L1a, L1b and L2 for history(): 18.5, 19.6, 21.3 km, then a lighter week.
GOOD = [run(1, 6), run(3, 6), run(5, 6.5, 39, 5),
        run(8, 6), run(10, 6.5, 39, 5), run(12, 7.1, 43, 5),
        run(15, 6.5, 39), run(17, 7, 42, 5), run(19, 7.8, 47, 6),
        run(22, 5, 30, 3), run(24, 5, 30, 3), run(26, 6)]


def body(**over) -> dict:
    return {"name": "4 weeks of running", "start_date": START.isoformat(), "weeks": 4,
            "week_meta": [{"index": 4, "kind": "deload"}],
            "rationale": "Runs grow at most 10% (L1a, P31); week 4 lighter (L2, P27).",
            "sessions": GOOD, **over}


def propose(store, **over):
    return plans.propose_program(store, today=TODAY, **body(**over))


# --- propose_program --------------------------------------------------------------------

def test_a_proposal_is_validated_and_never_stored(store):
    history(store)
    out = propose(store)
    assert out["proposal"] is True and out["stored"] is False
    assert store.plan_rows == [] and store.planned_rows == []
    assert out["plan"]["status"] == "proposed" and out["plan"]["source"] == "coach"
    assert out["plan"]["weekly_running_km"] == [18.5, 19.6, 21.3, 16.0]
    assert [w["kind"] for w in out["plan"]["weekly"]] == ["build", "build", "build", "deload"]
    # What Accept sends to POST /plans, which then stores it.
    assert out["accept"]["source"] == "coach" and len(out["accept"]["sessions"]) == 12
    assert any("L1a" in r and "P31" in r for r in out["rules_applied"])
    assert "taper_weeks" in out["needs_source"]
    stored = plans.create_plan(store, out["accept"], today=TODAY)
    assert stored["status"] == "active" and len(stored["sessions"]) == 12


def test_a_run_more_than_10_percent_longer_than_recent_ones_is_refused(store):
    """L1a (P31): 6 km longest in 30 days, so 6.6 km at most."""
    history(store)
    sessions = [run(1, 6), run(3, 6), run(5, 7)] + GOOD[3:]
    with pytest.raises(ValueError, match=r"7 km run .* more than 10% longer .*\(L1a, P31\)"):
        propose(store, sessions=sessions)


def test_a_weekly_jump_over_10_percent_is_refused(store):
    """L1b (P29/P30): 18 km in the last 7 days, so 19.8 km in week 1 at most."""
    history(store)
    sessions = [run(0, 6), run(1, 6), run(3, 6), run(5, 6)] + GOOD[3:]
    with pytest.raises(ValueError, match=r"week 1 plans 24 km .* \(L1b"):
        propose(store, sessions=sessions)


def test_a_lighter_week_doesnt_reset_the_weekly_base(store):
    """After lighter week 4, week 5 is compared with week 3, not week 4."""
    history(store)
    week5 = [run(29, 6.5), run(31, 7), run(33, 7.9, 47, 6)]  # 21.4 km <= 21.3 * 1.1
    out = propose(store, weeks=5, sessions=GOOD + week5)
    assert out["plan"]["weekly_running_km"][4] == 21.4


def test_every_4th_week_must_be_lighter(store):
    """L2 (P27): kind deload, and less planned load than the week before."""
    history(store)
    with pytest.raises(ValueError, match=r"week 4 must be a lighter week .*\(L2, P27\)"):
        propose(store, week_meta=[])
    heavy = GOOD[:9] + [run(22, 6.5, 60, 8), run(24, 6.5, 60, 8), run(26, 7, 60, 8)]
    with pytest.raises(ValueError, match="isn't below week 3"):
        propose(store, sessions=heavy)


def test_runs_need_a_distance_and_a_recent_run_to_build_from(store):
    with pytest.raises(ValueError, match="no run in the 30 days"):
        propose(store)  # no history at all: ask the user first
    history(store)
    no_km = [{**GOOD[0], "target": {"duration_min": 36, "effort": 4}}] + GOOD[1:]
    with pytest.raises(ValueError, match="needs a target distance_km"):
        propose(store, sessions=no_km)


def test_a_refusal_says_what_the_rules_allow(store):
    """So the coach can say plainly when a goal can't be reached in time."""
    history(store)
    with pytest.raises(ValueError) as e:
        propose(store, sessions=[run(1, 6), run(3, 6), run(5, 18)] + GOOD[3:])
    capacity = json.loads(str(e.value).split("Capacity: ", 1)[1])
    assert capacity["longest_run_30d_km"] == 6.0
    assert capacity["max_long_run_by_end_km"] == round(6 * 1.1 ** 3, 1)  # 3 build weeks
    assert "change it or tell the user plainly" in str(e.value)


def test_a_goal_date_sets_the_end_and_a_plan_starts_on_monday(store):
    history(store)
    goal = store.insert_goal({"kind": "run_pace", "band": "over_15km", "target_pace": 6.5,
                              "target_date": day(27), "created_on": TODAY.isoformat()})
    out = propose(store, weeks=None, goal_id=goal["id"])
    assert out["plan"]["weeks"] == 4 and out["goal"]["id"] == goal["id"]
    with pytest.raises(ValueError, match="starts on a Monday"):
        propose(store, start_date=day(1))


def test_one_plan_at_a_time(store):
    history(store)
    plans.create_plan(store, propose(store)["accept"], today=TODAY)
    with pytest.raises(ValueError, match="already has a plan .* leave or finish it"):
        propose(store)


def test_taper_has_no_number(store):
    history(store)
    out = propose(store, week_meta=[{"index": 4, "kind": "taper"}])
    assert any("needs source" in n for n in out["notes"])


def test_the_tool_runs_through_run_tool_and_stays_unstored_with_auto_save(store):
    """Q5: the setting only changes how sessions are stored, never plans."""
    history(store)
    for auto_save in (False, True):
        assert "propose_program" in [t["name"] for t in tools.tools_for(auto_save)]
    # `today` pins the date (the coach's calls use the real one).
    out = json.loads(tools.run_tool(store, "propose_program", {**body(), "today": TODAY}))
    assert out["stored"] is False and store.plan_rows == []
    # /chat returns it as a proposal for the card, not as a logged session.
    turn = [{"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "propose_program",
                                                "input": body()}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1",
                                          "content": json.dumps(out)}]}]
    assert api.tool_results(turn, "propose_program") == [out]
    assert api.logged_sessions(turn) == []


def test_the_coach_is_told_plans_need_accept_and_the_ratio_is_only_a_warning():
    assert "only the user's Accept saves it" in chat.SYSTEM_PROMPT
    assert "propose one unasked" in chat.SYSTEM_PROMPT
    load = next(t for t in tools.TOOLS if t["name"] == "get_training_load")["description"]
    assert "rough warning signal" in load and "never call any range of it safe" in load
    assert "0.8-1.3" not in load and "moderate range" not in load


# --- Derived status and get_plan -------------------------------------------------------------

def test_status_done_today_upcoming_not_done_skipped_paused(store):
    history(store)
    plan = plans.create_plan(store, propose(store)["accept"], today=TODAY)
    ids = [s["id"] for s in plan["sessions"]]
    # Week 1: the Tuesday run done (a run logged that day), Thursday skipped.
    store.insert_session({"sport": "running", "date": day(1), "duration_min": 40, "effort": 5,
                          "distance_km": 6.2})
    plans.skip_planned(store, ids[1], "Travel")
    # A pause over week 3's Thursday.
    store.pauses.append({"id": 1, "start_date": day(16), "planned_end": day(18), "ended_on": None,
                         "reason": "illness"})
    out = plans.get_plan(store, plan["id"], today=date.fromisoformat(day(5)))  # Saturday, week 1
    state = {s["id"]: s["state"] for s in out["sessions"]}
    assert state[ids[0]] == "done" and out["sessions"][0]["done"]["distance_km"] == 6.2
    assert state[ids[1]] == "skipped"
    assert state[ids[2]] == "today"
    assert state[ids[3]] == "upcoming"
    assert state[ids[7]] == "paused"
    assert out["current_week"] == 1
    later = plans.get_plan(store, plan["id"], today=date.fromisoformat(day(9)))
    assert {s["id"]: s["state"] for s in later["sessions"]}[ids[2]] == "not_done"


def test_one_logged_session_counts_for_one_planned_session(store):
    history(store)
    plan = plans.create_plan(store, propose(store)["accept"], today=TODAY)
    plans.add_planned(store, {**run(1, 5), "plan_id": plan["id"], "title": "Strides"})
    store.insert_session({"sport": "running", "date": day(1), "duration_min": 40, "effort": 5,
                          "distance_km": 6})
    out = plans.get_plan(store, plan["id"], today=date.fromisoformat(day(2)))
    tuesday = [s["state"] for s in out["sessions"] if s["date"] == day(1)]
    assert sorted(tuesday) == ["done", "not_done"]
    # Another sport that day counts for nothing.
    store.insert_session({"sport": "climbing", "date": day(1), "duration_min": 60, "effort": 6})
    out = plans.get_plan(store, plan["id"], today=date.fromisoformat(day(2)))
    assert sorted(s["state"] for s in out["sessions"] if s["date"] == day(1)) == ["done", "not_done"]


def test_get_plan_for_the_coach(store):
    assert plans.plan_for_coach(store, today=TODAY) == {"plan": None}
    history(store)
    plan = plans.create_plan(store, propose(store)["accept"], today=TODAY)
    out = json.loads(json.dumps(plans.plan_for_coach(store, today=date.fromisoformat(day(2)))))
    assert out["plan"]["id"] == plan["id"] and out["plan"]["current_week"] == 1
    assert len(out["this_and_next_week"]) == 6  # weeks 1 and 2
    assert "get_plan" in [t["name"] for t in tools.TOOLS]
