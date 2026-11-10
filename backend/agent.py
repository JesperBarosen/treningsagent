"""Terminal chat with the training agent. Run: uv run python agent.py"""

import sqlite3
from datetime import date
from pathlib import Path

import anthropic
from dotenv import load_dotenv

import tools

MODEL = "claude-haiku-5-5"  # cheapest current model; fine for logging and lookups
MAX_STEPS = 10  # max tool rounds per user message, guards against runaway loops
DB_PATH = Path(__file__).parent / "training.db"

SYSTEM_PROMPT = """You are a training assistant for a climber and runner.
Log sessions the user describes with log_session, and use get_history to answer
questions about past training. If a required value (duration or effort) is
missing, ask for it instead of guessing. Keep replies short.
Today is {today}."""


def run_turn(client: anthropic.Anthropic, conn: sqlite3.Connection, messages: list) -> str:
    """Run the tool-use loop for one user message. Returns Claude's final text."""
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

        # Keep the full content (text, thinking, tool_use) exactly as returned.
        messages.append({"role": "assistant", "content": response.content})

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
            print(f"  [tool] {block.name}({block.input})")
            try:
                content, is_error = tools.run_tool(conn, block.name, block.input), False
            except (ValueError, TypeError, sqlite3.IntegrityError) as e:
                content, is_error = f"Error: {e}", True  # let Claude correct itself
            results.append({"type": "tool_result", "tool_use_id": block.id,
                            "content": content, "is_error": is_error})
        messages.append({"role": "user", "content": results})

    return f"(stopped after {MAX_STEPS} tool rounds)"


def main() -> None:
    load_dotenv()  # puts ANTHROPIC_API_KEY from .env into the environment
    client = anthropic.Anthropic()
    conn = tools.connect(str(DB_PATH))
    messages: list = []  # the whole conversation, kept across turns

    print("Training agent. Describe a session or ask about your history. Ctrl+C to quit.")
    try:
        while True:
            user_input = input("\nyou> ").strip()
            if not user_input:
                continue
            messages.append({"role": "user", "content": user_input})
            print(f"agent> {run_turn(client, conn, messages)}")
    except (KeyboardInterrupt, EOFError):
        print()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
