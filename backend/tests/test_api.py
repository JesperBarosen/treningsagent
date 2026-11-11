"""Tests for POST /chat with fake Claude and storage (no network)."""

from datetime import date, timedelta

import anthropic
import httpx2
import pytest
from fastapi.testclient import TestClient

import api
import tools
from conftest import FakeClient, make_message

THINKING = {"type": "thinking", "thinking": "", "signature": "sig_abc"}


@pytest.fixture
def make_app(store):
    """Returns a TestClient whose Claude replies with the given messages."""
    def make(*responses):
        fake = FakeClient(*responses)
        api.app.dependency_overrides[api.get_client] = lambda: fake
        api.app.dependency_overrides[api.get_store] = lambda: store
        return TestClient(api.app), fake
    yield make
    api.app.dependency_overrides.clear()


def test_chat_returns_reply_history_and_conversation_id(make_app, store):
    http, _ = make_app(make_message("end_turn", [THINKING, {"type": "text", "text": "Hi!"}]))

    res = http.post("/chat", json={"message": "Hello"})

    assert res.status_code == 200
    body = res.json()
    assert body["reply"] == "Hi!"
    assert body["history"][0] == {"role": "user", "content": "Hello"}
    assert body["history"][1]["content"][0] == THINKING
    assert store.model_calls[0]["conversation_id"] == body["conversation_id"]


def test_history_is_sent_back_to_claude_unchanged(make_app):
    http, fake = make_app(make_message("end_turn", [{"type": "text", "text": "Second"}]))
    history = [{"role": "user", "content": "Hello"},
               {"role": "assistant", "content": [THINKING, {"type": "text", "text": "Hi!"}]}]
    conversation_id = "22222222-2222-2222-2222-222222222222"

    res = http.post("/chat", json={"message": "Again", "history": history,
                                   "conversation_id": conversation_id})

    assert fake.requests[0] == [*history, {"role": "user", "content": "Again"}]
    assert res.json()["conversation_id"] == conversation_id


def test_empty_message_is_rejected(make_app):
    http, _ = make_app()
    assert http.post("/chat", json={"message": ""}).status_code == 422


def test_claude_api_error_becomes_502(make_app):
    http, fake = make_app()
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")

    def fail(**kwargs):
        raise anthropic.APIConnectionError(request=request)
    fake.create = fail

    res = http.post("/chat", json={"message": "Hello"})
    assert res.status_code == 502


def tool_use(id_: str, name: str, tool_input: dict) -> dict:
    return {"type": "tool_use", "id": id_, "name": name, "input": tool_input}


RUN = {"sport": "running", "date": "2026-11-10", "duration_min": 50, "effort": 6,
       "distance_km": 10.0}


def test_chat_returns_the_sessions_logged_this_turn(make_app, store):
    http, _ = make_app(
        make_message("tool_use", [tool_use("t1", "log_session", RUN),
                                  tool_use("t2", "get_history", {"days": 7})]),
        make_message("end_turn", [{"type": "text", "text": "Logged."}]),
    )

    body = http.post("/chat", json={"message": "Ran 10 km in 50 min, effort 6"}).json()

    assert body["logged_sessions"] == [{"id": 1, **RUN, "notes": None}]


def test_failed_log_and_earlier_turns_are_not_reported(make_app):
    bad = {**RUN, "effort": 11}
    http, _ = make_app(
        make_message("tool_use", [tool_use("t3", "log_session", bad)]),
        make_message("end_turn", [{"type": "text", "text": "Effort must be 1-10."}]),
    )
    earlier = [
        {"role": "user", "content": "Ran"},
        {"role": "assistant", "content": [tool_use("t1", "log_session", RUN)]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1",
                                      "content": '{"id": 9}', "is_error": False}]},
        {"role": "assistant", "content": [{"type": "text", "text": "Logged."}]},
    ]

    body = http.post("/chat", json={"message": "Again, effort 11", "history": earlier}).json()

    assert body["logged_sessions"] == []


def seed_store(store) -> None:
    today = date.today()
    tools.log_session(store, **{**RUN, "date": today.isoformat()})
    tools.log_session(store, "climbing", (today - timedelta(days=1)).isoformat(), 90, 7,
                      climbs=[{"grade": "blue", "style": "boulder", "sent": True, "attempts": 1},
                              {"grade": "red", "style": "boulder", "sent": False}])
    tools.log_session(store, "running", (today - timedelta(days=200)).isoformat(), 30, 4)


def test_get_sessions_returns_history_with_climbs_and_derived_metrics(make_app, store):
    seed_store(store)
    http, _ = make_app()

    res = http.get("/sessions", params={"days": 7})

    assert res.status_code == 200
    climb, run = res.json()  # oldest first; the 200-day-old run is outside the window
    assert climb["sport"] == "climbing" and climb["hardest_sent_grade"] == "blue"
    assert [c["grade"] for c in climb["climbs"]] == ["blue", "red"]
    assert run["load"] == 300 and run["pace_min_per_km"] == 5.0


def test_get_training_load_matches_the_tool(make_app, store):
    seed_store(store)
    http, _ = make_app()

    body = http.get("/training-load", params={"weeks": 4}).json()

    assert body == tools.get_training_load(store, 4)
    assert len(body["weekly"]) == 4


def test_get_progression_matches_the_tool(make_app, store):
    seed_store(store)
    http, _ = make_app()

    body = http.get("/progression").json()

    assert body == tools.calculate_progression(store, 8)
    assert body["climbing"]["grade_scale"][0] == "yellow"


@pytest.mark.parametrize("path, params", [
    ("/sessions", {"days": 0}), ("/sessions", {"days": 400}),
    ("/training-load", {"weeks": 13}), ("/progression", {"weeks": 0}),
])
def test_read_endpoints_reject_out_of_range_windows(make_app, path, params):
    http, _ = make_app()
    assert http.get(path, params=params).status_code == 422


def test_health_needs_no_database(make_app):
    http, _ = make_app()
    assert http.get("/health").json() == {"status": "ok"}


def test_cors_allows_only_the_local_frontend(make_app):
    http, _ = make_app()
    ok = http.get("/health", headers={"origin": "http://localhost:3000"})
    other = http.get("/health", headers={"origin": "https://evil.example"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "access-control-allow-origin" not in other.headers
