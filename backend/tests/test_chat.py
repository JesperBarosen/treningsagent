"""Tests for the tool-use loop, with a fake Anthropic client (no network)."""

import json

import chat
import tools
from conftest import FakeClient, make_message

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


def thinking(text: str) -> dict:
    return {"type": "thinking", "thinking": text, "signature": f"sig-{text}"}


def test_thinking_is_kept_only_within_the_current_turn(store):
    earlier = [
        {"role": "user", "content": "Ran yesterday"},
        {"role": "assistant", "content": [thinking("old"), {**LOG_RUN, "id": "toolu_0"}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_0",
                                      "content": "ok", "is_error": False}]},
        {"role": "assistant", "content": [thinking("old2"),
                                          {"type": "redacted_thinking", "data": "x"},
                                          {"type": "text", "text": "Logged."}]},
    ]
    client = FakeClient(
        make_message("tool_use", [thinking("new"), LOG_RUN]),
        make_message("end_turn", [{"type": "text", "text": "Logged again."}]),
    )
    messages = [*earlier, {"role": "user", "content": "Ran 30 min, effort 5"}]

    chat.run_turn(client, store, messages, CONVERSATION_ID)

    def thinking_in(history):
        return [b.get("thinking", b["type"]) for m in history if m["role"] == "assistant"
                for b in m["content"] if b["type"] in chat.THINKING_TYPES]

    # Earlier turns lose their thinking on the first call; this turn's thinking
    # goes back unchanged with its tool results on the second.
    assert thinking_in(client.requests[0]) == []
    assert thinking_in(client.requests[1]) == ["new"]
    assert messages[1]["content"] == [{**LOG_RUN, "id": "toolu_0"}]
    assert messages[3]["content"] == [{"type": "text", "text": "Logged."}]


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
