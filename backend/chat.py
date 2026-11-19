"""The tool-use loop, shared by the terminal script and the API."""

import logging
import time
from datetime import date

import anthropic

import pauses
import tools
import training_profile

MODEL = "claude-haiku-5-5"  # cheapest current model; fine for logging and lookups
MAX_STEPS = 10  # max tool rounds per user message, guards against runaway loops

# The stable part of the system prompt: byte-identical on every call, so it is
# cached together with the tool definitions (#142). Anything that changes per
# turn or per user goes in turn_context(), after the cache breakpoint.
SYSTEM_PROMPT = """You are a training assistant for a climber and runner.
For a climbing session, put every climb they mention in the same logging or
draft call's `climbs` list; the gym grades by
colour, easiest to hardest: yellow, green, blue, purple, red, black, white,
unless the user has other gyms. Strength and other training (yoga, mobility,
cycling) are sports too. Users can have their own log templates and gyms: call
list_templates before logging anything that isn't a plain run or climb, or when
the user names a gym or a V or Font grade, and fill only the fields they stated.
Use get_history for questions about specific past sessions.
Use calculate_progression for "am I improving?", "am I getting faster?" and
other progression questions. Answer with the numbers it returns (recent vs
baseline, and how many sessions they rest on). If a trend is "not enough
data", say that instead of guessing, and never claim progress the numbers
don't show. For running, compare pace within the same distance band.
Summaries and headings must not go beyond the metrics under them. Before
writing a sport's heading or summary, check every trend for that sport,
including each distance band and each grade. If any is "declining" or "not enough
data", the heading must say "mixed" or name the exceptions, e.g.
"Climbing: mixed; harder sends, but red and black send rates lack data". Never
write "improving on every measure", "across the board", or an unqualified
"yes" for a sport that has such a metric.
Use get_training_load for questions about load, fatigue, how hard a week was,
or whether to push or rest; when citing the acute:chronic ratio, say it is a
rough guide. If a required value (duration or effort) is missing, ask for it
instead of guessing. Keep replies short.
You are not a medical professional. If the user mentions pain or an injury,
never diagnose it or guess its cause; keep the wording neutral, suggest easing
off, and if pain persists or gets worse, suggest seeing a physiotherapist or a
doctor.
Training plans: only when the user asks for a plan, call propose_program (never
propose one unasked). First make sure you know how many sessions a week and on
which days they can train, their current form (check get_training_load or
get_history), and any injury or pain; if something is missing, ask for it all in
one short message instead of guessing. What they tell you ("sore calves", "3
days a week") must shape the plan and be quoted in the reason. With pain or an
injury, be conservative, never diagnose, and suggest a physiotherapist if it
persists. Start near their current form (recent longest run and weekly
volume, including runs they mention from the last 30 days), never below it;
older PBs or races don't raise the start, which you say in one sentence. Never
change their goal (e.g. half marathon to 5 km) without asking: if it can't be
fully reached, propose the best plan toward it and say what is realistic.
The plan stores nothing, whatever the user's settings: the app
shows a card and only the user's Accept saves it. So call it a proposal to
accept, never saved, scheduled or set up; if the user says "save it", tell them
to tap Accept. Follow the load rules the tool applies; when it refuses, change
the plan, not the rules, and if the goal can't be fully reached in time, say
so plainly and propose what the rules allow. Name the rule and principle
behind key choices (e.g. "runs grow at most 10% (L1a, P31)"), and never cite
a study or number the tools didn't give. An accepted or dismissed plan shows
up as a note such as "[User accepted the plan: ...]" or "[User dismissed the
plan proposal: ...]".
The user can edit or remove sessions outside the chat. The history then holds a
note in square brackets, such as "[User removed the session: ...]" or "[User
edited the session to: ...]"; it overrides what you logged earlier in the
conversation. Never call a session a duplicate, or refuse to log one, from the
conversation alone: call get_history first, and treat only the sessions it
returns as stored."""

# Prompt caching (#142). One breakpoint on the last tool definition, one on the
# stable system prompt (which caches tools + system together), and top-level
# automatic caching for the conversation, so each step of a turn reads what the
# previous step wrote. 3 of the 4 allowed breakpoints; 5-minute TTL (steps of a
# turn, and turns of a chat, are usually well under 5 minutes apart). The
# stable prefix is far above the model's minimum cacheable length (512 tokens
# on Claude Haiku 5.5).
CACHE = {"type": "ephemeral"}

# How sessions get stored, by the user's setting (N4, docs/design-proposals-2.md).
LOGGING_AUTO = "Log sessions the user describes with log_session."
LOGGING_DRAFT = (
    "When the user describes a session, call draft_session: the app shows it as a\n"
    "draft with Save and Review, and nothing is stored until the user saves it. So\n"
    "say it is ready to save or review, never that it is logged. A saved or\n"
    "dismissed draft shows up in the history as a note such as \"[User saved the\n"
    "draft as: ...]\" or \"[User dismissed the draft: ...]\"."
)

log = logging.getLogger(__name__)


def turn_context(store: tools.Store, auto_save: bool, today: date | None = None) -> str:
    """The per-turn part of the system prompt: how sessions get stored, today's
    date, a pause and the training profile. Placed after the cache breakpoint,
    so it can change without invalidating the cached tools and prompt."""
    text = (LOGGING_AUTO if auto_save else LOGGING_DRAFT) + f"\nToday is {(today or date.today()).isoformat()}."
    # The coach knows about a pause (N5). Stores without pauses (evals) have none.
    active_pause = getattr(store, "active_pause", None)
    text += pauses.coach_context(active_pause() if active_pause else None)
    # The user's training profile (#137), in every turn. Stores without one (evals) add nothing.
    text += training_profile.coach_context(training_profile.read(store))
    return text


def system_blocks(store: tools.Store, auto_save: bool, today: date | None = None) -> list[dict]:
    """The system prompt as two blocks: the stable prompt with the cache
    breakpoint, then the per-turn context."""
    return [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": CACHE},
            {"type": "text", "text": turn_context(store, auto_save, today)}]


def cached_tools(offered: list[dict]) -> list[dict]:
    """The tool list with a breakpoint on its last definition. Copies, so the
    shared definitions in tools.py are never changed."""
    if not offered:
        return offered
    return [*offered[:-1], {**offered[-1], "cache_control": CACHE}]


def run_turn(client: anthropic.Anthropic, store: tools.Store, messages: list,
             conversation_id: str, auto_save: bool = False) -> str:
    """Run the tool-use loop for one user message (already appended to `messages`).

    By default the agent drafts sessions for the user to confirm (draft_session);
    with `auto_save` it stores them itself (log_session), as before N4.

    Every model call's token usage and latency is logged to the store under
    `conversation_id`.

    Appends Claude's replies and the tool results to `messages` as plain,
    JSON-serializable dicts, so the history can be sent over HTTP and replayed.
    Returns Claude's final text.
    """
    turn_start = len(messages) - 1  # index of the user message that started this turn
    _strip_old_thinking(messages, turn_start)
    # Read once per turn, so every step of the turn sends the same prefix.
    system = system_blocks(store, auto_save)
    offered = cached_tools(tools.tools_for(auto_save))
    # In draft mode log_session is defined (old histories call it) but refused.
    refused = set() if auto_save else {"log_session"}

    for _ in range(MAX_STEPS):
        start = time.perf_counter()
        response = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=system,
            tools=offered,
            messages=messages,
            # Automatic caching: the breakpoint moves to the last block as the
            # conversation grows, so the next step reads this one's prefix.
            cache_control=CACHE,
        )
        _log_model_call(store, conversation_id, response, time.perf_counter() - start)

        if response.stop_reason == "refusal":
            del messages[turn_start:]  # drop the refused turn so history stays valid
            return "(Claude declined to answer that.)"

        # Keep every block (text, thinking, tool_use) exactly as returned:
        # thinking blocks must be sent back unchanged on the next request.
        messages.append({"role": "assistant",
                         "content": [b.to_dict() for b in response.content]})

        if response.stop_reason != "tool_use":
            text = "".join(b.text for b in response.content if b.type == "text")
            if response.stop_reason == "max_tokens":
                text += "\n(reply cut off: hit max_tokens)"
            return text

        # Run every tool Claude asked for; send all results back in one message.
        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            log.info("tool %s(%s)", block.name, block.input)
            try:
                if block.name in refused:
                    raise ValueError(f"{block.name} is not available: the user saves "
                                     "sessions themselves. Call draft_session instead.")
                content, is_error = tools.run_tool(store, block.name, block.input), False
            except (ValueError, TypeError) as e:
                content, is_error = f"Error: {e}", True  # let Claude correct itself
            results.append({"type": "tool_result", "tool_use_id": block.id,
                            "content": content, "is_error": is_error})
        messages.append({"role": "user", "content": results})

    return f"(stopped after {MAX_STEPS} tool rounds)"


THINKING_TYPES = {"thinking", "redacted_thinking"}


def _strip_old_thinking(messages: list, turn_start: int) -> None:
    """Drop thinking blocks from assistant messages before `turn_start`, in place.

    The API only needs thinking blocks within the current tool-use turn, where
    they must be sent back unchanged. In earlier turns they are dead weight, and
    a client-held history may carry signatures that no longer validate.
    """
    for i, message in enumerate(messages[:turn_start]):
        content = message.get("content")
        if message.get("role") != "assistant" or not isinstance(content, list):
            continue
        kept = [b for b in content if b.get("type") not in THINKING_TYPES]
        if kept and len(kept) != len(content):  # never leave an assistant message empty
            messages[i] = {**message, "content": kept}


def _log_model_call(store: tools.Store, conversation_id: str,
                    response: anthropic.types.Message, seconds: float) -> None:
    usage = response.usage
    store.log_model_call({
        "conversation_id": conversation_id,
        "model": response.model,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "cache_creation_input_tokens": usage.cache_creation_input_tokens or 0,
        "cache_read_input_tokens": usage.cache_read_input_tokens or 0,
        "latency_ms": round(seconds * 1000),
        "stop_reason": response.stop_reason,
    })
