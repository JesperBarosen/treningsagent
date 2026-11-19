"""The training profile (#137): validation, the API, the coach's context, the
confirm-first tool, and propose_program using it. Offline, on the in-memory store."""

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import api
import chat
import plans
import tools
import training_profile as tp
from conftest import FakeClient, make_message
from test_propose_program import GOOD, START, TODAY, history

FULL = {"longest_run_km": 8.4, "weekly_run_km": 22, "climbing_level": "projecting V5",
        "injuries": [{"body_part": "Calf", "pain": 3, "note": "sore after long runs"}],
        "sessions_per_week": 3, "preferred_days": ["Tue", "thursday", "sat"],
        "other_sports": "yoga", "goals_note": "half marathon in spring"}


# --- Validation ---------------------------------------------------------------------------

def test_valid_changes_are_cleaned():
    out = tp.validate_changes(FULL)
    assert out["preferred_days"] == ["tuesday", "thursday", "saturday"]
    assert out["injuries"] == [{"body_part": "Calf", "pain": 3, "note": "sore after long runs"}]
    assert out["longest_run_km"] == 8.4 and out["weekly_run_km"] == 22.0
    # Empty values clear a field.
    assert tp.validate_changes({"climbing_level": "  ", "injuries": None, "longest_run_km": ""}) == {
        "climbing_level": None, "injuries": [], "longest_run_km": None}


@pytest.mark.parametrize("changes, message", [
    ({"longest_run_km": 0}, "between 0 and 200"),
    ({"weekly_run_km": 900}, "between 0 and 500"),
    ({"sessions_per_week": 0}, "1 to 14"),
    ({"sessions_per_week": 2.5}, "1 to 14"),
    ({"preferred_days": ["someday"]}, "weekday names"),
    ({"injuries": [{"pain": 3}]}, "needs a body_part"),
    ({"injuries": [{"body_part": "knee", "pain": 11}]}, "0 to 10"),
    ({"injuries": [{"body_part": "knee", "diagnosis": "x"}]}, "body_part, pain"),
    ({"injuries": [{"body_part": "k"}] * 11}, "at most 10"),
    ({"goals_note": "x" * 501}, "at most 500"),
    ({"onboarding": "maybe"}, "onboarding"),
    ({"email": "x"}, "unknown profile fields"),
])
def test_bad_changes_are_refused(changes, message):
    with pytest.raises(ValueError, match=message):
        tp.validate_changes(changes)


# --- API -----------------------------------------------------------------------------------

@pytest.fixture
def http(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def test_profile_endpoints(http, store):
    empty = http.get("/profile").json()
    assert empty == tp.EMPTY  # every field present, onboarding not shown yet
    # The first-login step can be skipped.
    assert http.patch("/profile", json={"onboarding": "skipped"}).json()["onboarding"] == "skipped"
    saved = http.patch("/profile", json={**FULL, "onboarding": "done"}).json()
    assert saved["sessions_per_week"] == 3 and saved["onboarding"] == "done"
    # Only the given fields change.
    again = http.patch("/profile", json={"sessions_per_week": 2}).json()
    assert again["sessions_per_week"] == 2 and again["climbing_level"] == "projecting V5"
    assert http.patch("/profile", json={"sessions_per_week": 30}).status_code == 422
    assert http.patch("/profile", json={}).status_code == 422


# --- The coach -------------------------------------------------------------------------------

def test_the_coach_reads_the_profile_in_every_turn(store):
    assert tp.coach_context(tp.read(store)) == ""  # no profile, nothing added
    store.save_profile(tp.validate_changes(FULL))
    fake = FakeClient(make_message("end_turn", [{"type": "text", "text": "Hi"}]))
    chat.run_turn(fake, store, [{"role": "user", "content": "hi"}], "c1")
    system = fake.systems[0]
    assert "The user's training profile" in system
    assert "longest recent run about 8.4 km" in system and "3 sessions a week" in system
    assert "preferred days: Tuesday, Thursday, Saturday" in system
    assert "injury or pain: Calf, pain 3/10 (sore after long runs)" in system
    assert "Change it only with propose_profile_update" in system and "never diagnose" in system


def test_the_coach_only_proposes_a_change_and_the_user_saves_it(store, http):
    store.save_profile(tp.validate_changes(FULL))
    for auto_save in (False, True):  # "Save without asking" never covers the profile
        assert "propose_profile_update" in [t["name"] for t in tools.tools_for(auto_save)]
    out = json.loads(tools.run_tool(store, "propose_profile_update", {"sessions_per_week": 2}))
    assert out == {"profile_update": True, "stored": False, "changes": {"sessions_per_week": 2},
                   "before": {"sessions_per_week": 3}}
    assert store.profile["sessions_per_week"] == 3  # nothing stored
    with pytest.raises(ValueError, match="unknown profile fields"):
        tools.run_tool(store, "propose_profile_update", {"onboarding": "done"})
    with pytest.raises(ValueError, match="nothing to change"):
        tools.run_tool(store, "propose_profile_update", {})
    # The user's Save is the PATCH.
    assert http.patch("/profile", json=out["changes"]).json()["sessions_per_week"] == 2
    # /chat returns it as a profile update for the card.
    turn = [{"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "propose_profile_update",
                                                "input": {"sessions_per_week": 2}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": json.dumps(out)}]}]
    assert api.tool_results(turn, "propose_profile_update") == [out]


def test_a_chat_turn_returns_profile_updates(store, http):
    store.save_profile(tp.validate_changes(FULL))
    fake = FakeClient(
        make_message("tool_use", [{"type": "tool_use", "id": "t1", "name": "propose_profile_update",
                                   "input": {"injuries": [{"body_part": "knee", "pain": 4}]}}]),
        make_message("end_turn", [{"type": "text", "text": "Ready to save."}]),
    )
    api.app.dependency_overrides[api.get_client] = lambda: fake
    body = http.post("/chat", json={"message": "my knee hurts, 4/10", "auto_save": True}).json()
    assert body["profile_updates"][0]["changes"] == {"injuries": [{"body_part": "knee", "pain": 4, "note": None}]}
    assert store.profile["injuries"][0]["body_part"] == "Calf"  # still unchanged


# --- propose_program uses the profile --------------------------------------------------------

def _propose(store, **over):
    body = {"name": "4 weeks", "start_date": START.isoformat(), "weeks": 4,
            "week_meta": [{"index": 4, "kind": "deload"}], "rationale": "From your profile.",
            "sessions": GOOD, **over}
    return plans.propose_program(store, today=TODAY, **body)


def test_the_profile_fills_what_the_coach_would_ask(store):
    history(store)
    with pytest.raises(ValueError, match="missing sessions_per_week, available_days, injury_or_pain"):
        _propose(store)
    store.save_profile(tp.validate_changes({"sessions_per_week": 3, "preferred_days": ["tue", "thu", "sat"]}))
    # No injuries listed, but the profile was skipped: pain still has to be asked.
    with pytest.raises(ValueError, match="missing injury_or_pain"):
        _propose(store)
    store.save_profile({"onboarding": "done"})
    out = _propose(store)
    assert out["context"]["injury_or_pain"] == "none"
    assert out["context"]["from_profile"] == ["sessions_per_week", "available_days", "injury_or_pain"]
    # Listed injuries are used, and keep the plan conservative.
    store.save_profile(tp.validate_changes({"injuries": [{"body_part": "calf", "pain": 3}]}))
    out = _propose(store)
    assert out["context"]["injury_or_pain"] == "calf (pain 3/10)"
    assert any("physiotherapist" in n for n in out["notes"])
    # What the user says in the chat wins over the profile.
    assert _propose(store, injury_or_pain="none")["context"]["injury_or_pain"] == "none"
