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

This creates `sessions`, `climbs` and `model_calls`, all with Row Level
Security: a user can only read and insert their own rows (and can only add
climbs to their own sessions). The backend runs its queries as the
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

## What the agent can do

| Tool | Use |
| --- | --- |
| `log_session` | Store a run or a climbing session. A climbing session can include its individual climbs in the same call. |
| `get_history` | Sessions from the last N days, with load, running pace, and each session's climbs, number sent and hardest sent grade. |
| `get_training_load` | Load per day and per week across sports, plus the acute:chronic workload ratio. |

**Climbs.** Each climb has a colour grade on the gym's scale, from easiest to
hardest: yellow, green, blue, purple, red, black, white. It also has a style
(`boulder`, `kilter` or `rope`), whether it was sent, and optionally the number
of attempts and notes. The grade is stored with its position on the scale
(`grade_ordinal`, 1-7) so progression is a plain SQL query:

```sql
select s.date, max(c.grade_ordinal) filter (where c.sent) as hardest_sent
from climbs c join sessions s on s.id = c.session_id
group by s.date order by s.date;
```

**Training load** uses session-RPE (Foster et al. 2001): load = duration in
minutes x perceived effort (1-10), so runs and climbing sessions add up on one
scale. The acute:chronic ratio is the average daily load over the last 7 days
divided by the average over the last 28. It is a rough guide and means little
until about four weeks are logged. Load and the other derived values are
computed when read and never stored.
