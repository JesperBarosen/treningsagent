"""The tool-use loop, shared by the terminal script and the API."""

import logging
import time
from datetime import date

import anthropic

import pauses
import tools

MODEL = "claude-haiku-5-5"  # cheapest current model; fine for logging and lookups
MAX_STEPS = 10  # max tool rounds per user message, guards against runaway loops

SYSTEM_PROMPT = """You are a training assistant for a climber and runner.
{logging} For a climbing session, put
every climb they mention in that same call's `climbs` list; the gym grades by
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
The user can edit or remove sessions outside the chat. The history then holds a
note in square brackets, such as "[User removed the session: ...]" or "[User
edited the session to: ...]"; it overrides what you logged earlier in the
conversation. Never call a session a duplicate, or refuse to log one, from the
conversation alone: call get_history first, and treat only the sessions it
returns as stored.
Today is {today}."""

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
    system = SYSTEM_PROMPT.format(today=date.today().isoformat(),
                                  logging=LOGGING_AUTO if auto_save else LOGGING_DRAFT)
    # The coach knows about a pause (N5). Stores without pauses (evals) have none.
    active_pause = getattr(store, "active_pause", None)
    system += pauses.coach_context(active_pause() if active_pause else None)
    offered = tools.tools_for(auto_save)
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
