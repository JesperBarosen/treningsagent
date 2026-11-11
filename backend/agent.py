"""Terminal chat with the training agent. Run: uv run python agent.py"""

import logging
import uuid

import anthropic

import chat
import db
import env


def main() -> None:
    env.load()  # ANTHROPIC_API_KEY and DATABASE_URL from the root .env
    logging.basicConfig(format="  [%(name)s] %(message)s")
    logging.getLogger("chat").setLevel(logging.INFO)  # show tool calls
    client = anthropic.Anthropic()
    conn = db.connect()
    db.ensure_auth_user(conn, db.TEST_USER_ID)  # the terminal chat runs as the test user
    store = db.PostgresStore(conn, db.TEST_USER_ID)
    messages: list = []  # the whole conversation, kept across turns
    conversation_id = str(uuid.uuid4())  # groups model_calls rows for cost reporting

    print("Training agent. Describe a session or ask about your history. Ctrl+C to quit.")
    try:
        while True:
            user_input = input("\nyou> ").strip()
            if not user_input:
                continue
            messages.append({"role": "user", "content": user_input})
            print(f"agent> {chat.run_turn(client, store, messages, conversation_id)}")
    except (KeyboardInterrupt, EOFError):
        print()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
