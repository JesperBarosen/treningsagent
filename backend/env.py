"""Load settings from the .env at the repo root (next to .env.example).

ANTHROPIC_API_KEY, DATABASE_URL, SUPABASE_URL and CHAT_DAILY_LIMIT all live
there. The path is fixed, so a stray backend/.env or the working directory
can't change which file is read. Variables already set in the environment win.
"""

from pathlib import Path

from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load() -> None:
    load_dotenv(ENV_FILE)
