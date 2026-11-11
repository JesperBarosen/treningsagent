"""The tool-use loop, shared by the terminal script and the API."""

import logging
from datetime import date

import anthropic

import tools

MODEL = "claude-haiku-5-5"  # cheapest current model; fine for logging and lookups
MAX_STEPS = 10  # max tool rounds per user message, guards against runaway loops

SYSTEM_PROMPT = """You are a training assistant for a climber and runner.
Log sessions the user describes with log_session, and use get_history to answer
questions about past training. If a required value (duration or effort) is
missing, ask for it instead of guessing. Keep replies short.
Today is {today}."""

log = logging.getLogger(__name__)


def run_turn(client: anthropic.Anthropic, store: tools.Store, messages: list) -> str:
    """Run the tool-use loop for one user message (already appended to `messages`).

    Appends Claude's replies and the tool results to `messages` as plain,
    JSON-serializable dicts, so the history can be sent over HTTP and replayed.
    Returns Claude's final text.
    """
    turn_start = len(messages) - 1  # index of the user message that started this turn
    system = SYSTEM_PROMPT.format(today=date.today().isoformat())

    for _ in range(MAX_STEPS):
        response = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=system,
            tools=tools.TOOLS,
            messages=messages,
        )

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
                content, is_error = tools.run_tool(store, block.name, block.input), False
            except (ValueError, TypeError) as e:
                content, is_error = f"Error: {e}", True  # let Claude correct itself
            results.append({"type": "tool_result", "tool_use_id": block.id,
                            "content": content, "is_error": is_error})
        messages.append({"role": "user", "content": results})

    return f"(stopped after {MAX_STEPS} tool rounds)"
