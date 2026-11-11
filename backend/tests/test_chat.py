"""Tests for the tool-use loop, with a fake Anthropic client (no network)."""

import json

from anthropic.types import Message

import chat
import tools


def make_message(stop_reason: str, content: list[dict]) -> Message:
    return Message.model_validate({
        "id": "msg_test", "type": "message", "role": "assistant", "model": chat.MODEL,
        "content": content, "stop_reason": stop_reason, "stop_sequence": None,
        "usage": {"input_tokens": 100, "output_tokens": 20},
    })


class FakeClient:
    """Returns canned responses in order and records each request."""

    def __init__(self, *responses: Message):
        self.responses = list(responses)
        self.requests: list[dict] = []
        self.messages = self  # so client.messages.create(...) works

    def create(self, **kwargs):
        self.requests.append(json.loads(json.dumps(kwargs["messages"])))  # snapshot
        return self.responses.pop(0)


CONVERSATION_ID = "11111111-1111-1111-1111-111111111111"

LOG_RUN = {"type": "tool_use", "id": "toolu_1", "name": "log_session",
           "input": {"sport": "running", "date": "2026-11-10", "duration_min": 30, "effort": 5}}


def test_runs_tool_then_returns_final_text(store):
    client = FakeClient(
        make_message("tool_use", [LOG_RUN]),
        make_message("end_turn", [{"type": "text", "text": "Logged."}]),
    )
    messages = [{"role": "user", "content": "Ran 30 min, effort 5"}]

    assert chat.run_turn(client, store, messages, CONVERSATION_ID) == "Logged."
    assert len(tools.get_history(store, 3650)) == 1

    # History is user, assistant(tool_use), user(tool_result), assistant(text),
    # and survives a JSON round trip, as it must for the API.
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
    assert json.loads(json.dumps(messages)) == messages
    result = messages[2]["content"][0]
    assert result["tool_use_id"] == "toolu_1" and not result["is_error"]


def test_tool_error_is_sent_back_to_claude(store):
    bad = {**LOG_RUN, "input": {**LOG_RUN["input"], "effort": 11}}
    client = FakeClient(
        make_message("tool_use", [bad]),
        make_message("end_turn", [{"type": "text", "text": "Effort must be 1-10."}]),
    )
    messages = [{"role": "user", "content": "Ran 30 min, effort 11"}]

    chat.run_turn(client, store, messages, CONVERSATION_ID)

    result = client.requests[1][-1]["content"][0]
    assert result["is_error"] and "effort" in result["content"]


def test_refusal_drops_the_turn(store):
    client = FakeClient(make_message("refusal", []))
    messages = [{"role": "user", "content": "earlier"},
                {"role": "assistant", "content": [{"type": "text", "text": "ok"}]},
                {"role": "user", "content": "refused"}]

    chat.run_turn(client, store, messages, CONVERSATION_ID)

    assert [m["content"] for m in messages][-1] == [{"type": "text", "text": "ok"}]


def test_stops_after_max_steps(store):
    client = FakeClient(*[make_message("tool_use", [{**LOG_RUN, "id": f"toolu_{i}"}])
                          for i in range(chat.MAX_STEPS)])
    reply = chat.run_turn(client, store, [{"role": "user", "content": "loop"}], CONVERSATION_ID)
    assert "stopped" in reply


def test_every_model_call_is_logged(store):
    client = FakeClient(
        make_message("tool_use", [LOG_RUN]),
        make_message("end_turn", [{"type": "text", "text": "Logged."}]),
    )
    chat.run_turn(client, store, [{"role": "user", "content": "Ran"}], CONVERSATION_ID)

    assert len(store.model_calls) == 2
    call = store.model_calls[0]
    assert call["conversation_id"] == CONVERSATION_ID
    assert (call["input_tokens"], call["output_tokens"]) == (100, 20)
    assert call["cache_read_input_tokens"] == 0
    assert call["stop_reason"] == "tool_use"
    assert isinstance(call["latency_ms"], int) and call["latency_ms"] >= 0
