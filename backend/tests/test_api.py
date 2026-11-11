"""Tests for POST /chat with fake Claude and storage (no network)."""

import anthropic
import httpx2
import pytest
from fastapi.testclient import TestClient

import api
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
