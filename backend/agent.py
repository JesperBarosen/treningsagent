"""Terminal chat with the training agent. Run: uv run python agent.py"""

import logging
from pathlib import Path

import anthropic
from dotenv import load_dotenv

import chat
import tools

DB_PATH = Path(__file__).parent / "training.db"


def main() -> None:
    load_dotenv()  # puts ANTHROPIC_API_KEY from .env into the environment
    logging.basicConfig(format="  [%(name)s] %(message)s")
    logging.getLogger("chat").setLevel(logging.INFO)  # show tool calls
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
            print(f"agent> {chat.run_turn(client, conn, messages)}")
    except (KeyboardInterrupt, EOFError):
        print()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
