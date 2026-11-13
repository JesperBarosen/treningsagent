"""Load settings from the .env at the repo root (next to .env.example).

ANTHROPIC_API_KEY, DATABASE_URL, SUPABASE_URL, CHAT_DAILY_LIMIT and
ALLOWED_ORIGINS all live there locally; in production they are set on the host
(see docs/deploy.md). On Vercel there is no .env file, so load() does nothing. The path is fixed, so a stray backend/.env or the working directory
can't change which file is read. Variables already set in the environment win.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load() -> None:
    load_dotenv(ENV_FILE)


DEFAULT_ALLOWED_ORIGINS = "http://localhost:3000"  # the Next.js dev server


def allowed_origins() -> list[str]:
    """Browser origins allowed to call the API, from ALLOWED_ORIGINS.

    Comma-separated, e.g. "https://treningsagent.vercel.app,http://localhost:3000".
    Spaces and trailing slashes are ignored, since a browser's Origin header has
    neither. Unset or blank means the local dev server only.
    """
    raw = os.environ.get("ALLOWED_ORIGINS", "").strip() or DEFAULT_ALLOWED_ORIGINS
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
