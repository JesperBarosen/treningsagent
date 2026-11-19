"""Prompt caching in the coach loop (#142): where the cache breakpoints are,
that per-turn context comes after them, and that cached tokens count less
towards the daily quota."""

import json
from datetime import date, datetime, timedelta, timezone

import pytest

import chat
import limits
import tools
import training_profile as tp
from conftest import FakeClient, make_message

LOG_RUN = {"type": "tool_use", "id": "t1", "name": "get_history", "input": {"days": 7}}
EPHEMERAL = {"type": "ephemeral"}


def two_step_turn(store, auto_save=False):
    """A turn with one tool round, so the loop calls the model twice."""
    client = FakeClient(make_message("tool_use", [LOG_RUN]),
                        make_message("end_turn", [{"type": "text", "text": "Done."}]))
    chat.run_turn(client, store, [{"role": "user", "content": "What did I do this week?"}], "c1",
                  auto_save=auto_save)
    return client


def breakpoints(call: dict) -> int:
    marks = sum(1 for t in call["tools"] if "cache_control" in t)
    marks += sum(1 for b in call["system"] if "cache_control" in b)
    return marks + (1 if "cache_control" in call else 0)


def test_breakpoints_on_the_tools_the_stable_prompt_and_the_conversation(store):
    call = two_step_turn(store).calls[0]
    # The last tool definition carries one, and only that one.
    assert call["tools"][-1]["cache_control"] == EPHEMERAL
    assert all("cache_control" not in t for t in call["tools"][:-1])
    # The stable system prompt carries one; the per-turn block after it doesn't.
    first, second = call["system"]
    assert first == {"type": "text", "text": chat.SYSTEM_PROMPT, "cache_control": EPHEMERAL}
    assert "cache_control" not in second
    # Top-level automatic caching for the growing conversation.
    assert call["cache_control"] == EPHEMERAL
    assert breakpoints(call) == 3  # the API allows 4


def test_per_turn_context_comes_after_the_breakpoint(store):
    store.save_profile(tp.validate_changes({"sessions_per_week": 3, "injuries": [{"body_part": "knee", "pain": 2}]}))
    store.pauses.append({"id": 1, "start_date": "2026-11-10", "planned_end": None, "ended_on": None,
                         "reason": "travel", "body_part": None, "pain": None, "note": None, "resume_choice": None})
    call = two_step_turn(store).calls[0]
    stable, per_turn = call["system"][0]["text"], call["system"][1]["text"]
    today = date.today().isoformat()
    # Date, logging mode, pause and profile: all in the block after the breakpoint.
    assert f"Today is {today}." in per_turn and today not in stable
    assert chat.LOGGING_DRAFT in per_turn and chat.LOGGING_DRAFT not in stable
    assert "The user's training profile" in per_turn and "knee" not in stable
    assert "pause" in per_turn.lower()
    # The stable prompt is a constant: no placeholders left in it.
    assert "{" not in chat.SYSTEM_PROMPT and stable == chat.SYSTEM_PROMPT


def test_the_cached_prefix_is_identical_for_every_user_day_and_setting(store, monkeypatch):
    plain = two_step_turn(store).calls[0]
    store.save_profile(tp.validate_changes({"goals_note": "half marathon"}))
    other_day = chat.system_blocks(store, auto_save=True, today=date(2027, 1, 1))
    assert other_day[0] == plain["system"][0]  # same stable block, byte for byte
    assert other_day[1]["text"] != plain["system"][1]["text"]
    # The tool list is deterministic per setting, so its cache entry is reused.
    assert json.dumps(chat.cached_tools(tools.tools_for(False))) == json.dumps(plain["tools"])


def test_every_step_of_a_turn_sends_the_same_prefix(store):
    first, second = two_step_turn(store).calls
    assert first["system"] == second["system"] and first["tools"] == second["tools"]


def test_the_shared_tool_definitions_are_never_marked(store):
    two_step_turn(store, auto_save=True)
    two_step_turn(store, auto_save=False)
    assert all("cache_control" not in t for t in tools.TOOLS)
    assert all("cache_control" not in t for t in tools.tools_for(False))


def test_all_four_token_columns_are_still_logged(store):
    two_step_turn(store)
    call = store.model_calls[0]
    for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"):
        assert k in call


# --- The daily quota counts cached tokens at their price weight ----------------------------

def test_quota_tokens_weight_cache_reads_and_writes_like_cost():
    usage = {"input_tokens": 1000, "output_tokens": 500, "cache_creation_input_tokens": 4000,
             "cache_read_input_tokens": 20000}
    assert limits.quota_tokens(usage) == pytest.approx(1000 + 500 + 1.25 * 4000 + 0.1 * 20000)
    assert limits.quota_tokens({"input_tokens": 10, "output_tokens": 5}) == 15  # old rows without cache columns


def test_a_cached_plan_turn_no_longer_uses_up_the_daily_quota(store, monkeypatch):
    """#142: 4 calls of ~17k input used to be 69k, over the 50k quota. Served
    mostly from cache, the same turn counts for a fraction of it."""
    monkeypatch.setenv("CHAT_TOKENS_PER_DAY", "50000")
    now = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
    store.now = now
    # The first call writes the prefix, the next three read it.
    store.model_calls = [
        {"created_at": now - timedelta(minutes=5), "model": "claude-haiku-5-5", "input_tokens": 600,
         "output_tokens": 400, "cache_creation_input_tokens": 16000, "cache_read_input_tokens": 0},
        *[{"created_at": now - timedelta(minutes=4), "model": "claude-haiku-5-5", "input_tokens": 600,
           "output_tokens": 400, "cache_creation_input_tokens": 500, "cache_read_input_tokens": 16500}
          for _ in range(3)],
    ]
    counted = store.tokens_since(limits.day_start(now))
    assert counted == round(4 * 1000 + 1.25 * (16000 + 3 * 500) + 0.1 * 3 * 16500)  # 28,825
    assert counted < 50000
    limits.check_chat(store, now)  # not blocked
    # Uncached, the same input would have counted 69k and blocked the user.
    raw = sum(c["input_tokens"] + c["output_tokens"] + c["cache_creation_input_tokens"]
              + c["cache_read_input_tokens"] for c in store.model_calls)
    assert raw > 50000
