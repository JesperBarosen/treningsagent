# treningsagent
AI training agent for climbing and running. Logs sessions in plain language, tracks progression and cross-sport training load, and proposes research-backed plans with cited sources. Built with Claude tool use, FastAPI, Next.js and Supabase, with evals in CI.

## Run it locally

Requires [uv](https://docs.astral.sh/uv/) and an Anthropic API key.

```sh
cp .env.example .env          # then put your real key in .env
cd backend
uv sync                       # creates .venv and installs locked dependencies
uv run python agent.py        # chat in the terminal; Ctrl+C to quit
uv run pytest                 # tests for the tool functions (no API calls)
```

Sessions are stored in `backend/training.db` (SQLite, git-ignored).
