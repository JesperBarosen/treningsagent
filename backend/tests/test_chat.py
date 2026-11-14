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

    assert chat.run_turn(client, store, messages, CONVERSATION_ID, auto_save=True) == "Logged."
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

    chat.run_turn(client, store, messages, CONVERSATION_ID, auto_save=True)

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


# A conversation where the agent logged a run, then the user removed it from the
# chat's Logged card, which appends a note to the history (#63, app/chat.tsx).
REMOVED_NOTE = ("[User removed the session: Run · 10 km · 50 min · effort 6 on 2026-11-10 "
                "(id 1). It is no longer in their log.]")
EARLIER_TURN = [
    {"role": "user", "content": "Ran 10 km in 50 min, effort 6"},
    {"role": "assistant", "content": [{**LOG_RUN, "input": {
        "sport": "running", "date": "2026-11-10", "duration_min": 50, "effort": 6,
        "distance_km": 10}}]},
    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_1",
                                  "content": '{"id": 1}', "is_error": False}]},
    {"role": "assistant", "content": [{"type": "text", "text": "Logged your 10 km run."}]},
    {"role": "user", "content": REMOVED_NOTE},
]


def test_a_removal_note_reaches_the_model_unchanged(store):
    """The note and the next message are consecutive user messages; the API
    merges them into one turn, so the loop must pass both through as they are."""
    client = FakeClient(make_message("end_turn", [{"type": "text", "text": "Logged."}]))
    messages = [*json.loads(json.dumps(EARLIER_TURN)),
                {"role": "user", "content": "Ran 10 km in 50 min, effort 6"}]

    chat.run_turn(client, store, messages, CONVERSATION_ID)

    sent = client.requests[0]
    assert sent[:5] == EARLIER_TURN
    assert [m["role"] for m in sent[-2:]] == ["user", "user"]


def test_system_prompt_explains_the_notes_and_checking_before_a_duplicate(store):
    client = FakeClient(make_message("end_turn", [{"type": "text", "text": "Hi."}]))
    chat.run_turn(client, store, [{"role": "user", "content": "Hi"}], CONVERSATION_ID)
    system = " ".join(client.systems[0].split())  # the prompt wraps lines
    assert "[User removed the session: ...]" in system
    assert "[User edited the session to: ...]" in system
    assert "duplicate" in system and "call get_history first" in system


# --- N4: the chat drafts sessions for the user to confirm --------------------------

DRAFT_RUN = {**LOG_RUN, "id": "toolu_d", "name": "draft_session"}


def test_by_default_the_agent_drafts_and_nothing_is_stored(store):
    client = FakeClient(
        make_message("tool_use", [DRAFT_RUN]),
        make_message("end_turn", [{"type": "text", "text": "Ready to save."}]),
    )
    messages = [{"role": "user", "content": "Ran 30 min, effort 5"}]

    chat.run_turn(client, store, messages, CONVERSATION_ID)

    assert tools.get_history(store, 3650) == []
    result = messages[2]["content"][0]
    assert not result["is_error"]
    assert json.loads(result["content"]) == {"draft": True, "sport": "running",
                                              "date": "2026-11-10", "duration_min": 30,
                                              "effort": 5, "notes": None}
    # log_session stays defined for old histories, next to draft_session.
    assert "draft_session" in client.tools[0] and "log_session" in client.tools[0]


def test_in_draft_mode_log_session_is_refused_and_stores_nothing(store):
    client = FakeClient(
        make_message("tool_use", [LOG_RUN]),
        make_message("end_turn", [{"type": "text", "text": "Ready to save."}]),
    )
    messages = [{"role": "user", "content": "Ran 30 min, effort 5"}]

    chat.run_turn(client, store, messages, CONVERSATION_ID)

    assert tools.get_history(store, 3650) == []
    result = client.requests[1][-1]["content"][0]
    assert result["is_error"] and "draft_session" in result["content"]


def test_a_draft_is_checked_with_log_sessions_rules(store):
    bad = {**DRAFT_RUN, "input": {**DRAFT_RUN["input"], "effort": 11}}
    client = FakeClient(
        make_message("tool_use", [bad]),
        make_message("end_turn", [{"type": "text", "text": "Effort must be 1-10."}]),
    )
    chat.run_turn(client, store, [{"role": "user", "content": "x"}], CONVERSATION_ID)
    result = client.requests[1][-1]["content"][0]
    assert result["is_error"] and "effort" in result["content"]


def test_the_prompt_and_tools_follow_the_auto_save_setting(store):
    def turn(auto_save):
        client = FakeClient(make_message("end_turn", [{"type": "text", "text": "Hi."}]))
        chat.run_turn(client, store, [{"role": "user", "content": "Hi"}], CONVERSATION_ID,
                      auto_save=auto_save)
        return " ".join(client.systems[0].split()), client.tools[0]

    system, offered = turn(auto_save=False)
    assert "call draft_session" in system and "never that it is logged" in system
    assert "[User saved the draft as: ...]" in system
    system, offered = turn(auto_save=True)
    assert "Log sessions the user describes with log_session." in system
    assert "draft_session" not in offered
