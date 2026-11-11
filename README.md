# treningsagent
AI training agent for climbing and running. Logs sessions in plain language, tracks progression and cross-sport training load, and proposes research-backed plans with cited sources. Built with Claude tool use, FastAPI, Next.js and Supabase, with evals in CI.

## Run it locally

Requires [uv](https://docs.astral.sh/uv/), an Anthropic API key and a
[Supabase](https://supabase.com) project.

### 1. Configure

```sh
cp .env.example .env    # then fill in ANTHROPIC_API_KEY and DATABASE_URL
```

`DATABASE_URL` is in the Supabase dashboard under **Connect > Session pooler**.

### 2. Create the tables

Apply the files in `supabase/migrations/` in order, either by pasting each one
into the Supabase **SQL Editor**, or with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```sh
supabase link --project-ref <project-ref>
supabase db push
```

This creates `sessions` and `model_calls`, both with Row Level Security: a user
can only read and insert their own rows. The backend runs its queries as the
`authenticated` role with the user's id in the JWT claims, so the policies apply
to it too. Until login exists, everything runs as one fixed test user
(`db.TEST_USER_ID`).

### 3. Run

```sh
cd backend
uv sync                                  # creates .venv and installs locked dependencies
uv run uvicorn api:app --reload          # API on http://localhost:8000 (docs at /docs)
uv run python agent.py                   # or: chat in the terminal; Ctrl+C to quit
uv run pytest                            # tests: no network or API calls
```

Talk to the API:

```sh
curl -s localhost:8000/chat -H "content-type: application/json"   -d '{"message": "Ran 10 km in 50 min today, effort 6"}'
```

The response has `reply`, `history` and `conversation_id`. The server keeps no
conversation state: send `history` and `conversation_id` back unchanged with
the next message.

`tests/test_db.py` checks the database and RLS against a real Postgres. It is
skipped unless `TEST_DATABASE_URL` is set (use a separate dev project: it writes
and deletes rows).

### Cost per conversation

Every Claude call is logged to `model_calls` with tokens and latency:

```sql
select conversation_id, count(*) as calls,
       sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
       sum(cache_read_input_tokens) as cache_read_tokens,
       round(avg(latency_ms)) as avg_latency_ms
from model_calls
group by conversation_id
order by max(created_at) desc;
```
