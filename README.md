# treningsagent
AI training agent for climbing and running. Logs sessions in plain language, tracks progression and cross-sport training load, and proposes research-backed plans with cited sources. Built with Claude tool use, FastAPI, Next.js and Supabase, with evals in CI.

## Run it locally

Requires [uv](https://docs.astral.sh/uv/), an Anthropic API key and a
[Supabase](https://supabase.com) project.

### 1. Configure

```sh
cp .env.example .env    # then fill in ANTHROPIC_API_KEY, DATABASE_URL and SUPABASE_URL
cp frontend/.env.example frontend/.env.local   # Supabase URL and publishable key
```

`DATABASE_URL` is in the Supabase dashboard under **Connect > Session pooler**.

### 2. Create the tables

Apply the files in `supabase/migrations/` in order, either by pasting each one
into the Supabase **SQL Editor**, or with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```sh
supabase link --project-ref <project-ref>
supabase db push
```

This creates `sessions`, `climbs`, `model_calls` and `chat_requests`, all with
Row Level Security: a user can only read and insert their own rows (and can
only add climbs to their own sessions). Every row's `user_id` references
`auth.users`, and deleting a user deletes their rows. The backend runs its
queries as the `authenticated` role with the user's id in the JWT claims, so
the policies apply to it too.

### Sign-in

Sign-in is by email magic link (Supabase Auth), invite only. The frontend
(`proxy.ts`) sends signed-out visitors to `/sign-in`. The backend (`auth.py`)
checks the `Authorization: Bearer` token on every request against the
project's public signing keys (JWKS), so it needs only `SUPABASE_URL` and no
shared secret, and runs queries as that user. `/chat` is limited to
`CHAT_DAILY_LIMIT` requests (default 50) per user in any 24 hours.

In the Supabase dashboard:

- **Authentication > Sign In / Providers**: turn off *Allow new users to sign up*.
- **Authentication > URL Configuration**: Site URL `http://localhost:3000`, and
  add `http://localhost:3000/auth/confirm` to the redirect URLs.
- The Magic Link email stays the default (`{{ .ConfirmationURL }}`; editing
  templates needs custom SMTP). The form sends `emailRedirectTo` =
  `<site>/auth/confirm`, which exchanges the `?code=` for a session (PKCE), so
  open the link in the browser that asked for it. `/auth/confirm` also accepts
  `?token_hash=...&type=email`, for a template edited later to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`, which
  works in any browser.
- **Project Settings > JWT Keys**: the current key must be asymmetric (ECC or RSA),
  not the legacy shared secret.
- Add people under **Authentication > Users > Add user > Create new user**
  (tick *Auto Confirm User*).

`db.TEST_USER_ID` is only for tests and the dev scripts (`seed.py`,
`agent.py`), which create it in `auth.users` as a bare user that can't sign in.

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
curl -s localhost:8000/chat -H "content-type: application/json"   -H "authorization: Bearer $ACCESS_TOKEN" -d '{"message": "Ran 10 km in 50 min today, effort 6"}'
```

The response has `reply`, `history` and `conversation_id`. The server keeps no
conversation state: send `history` and `conversation_id` back unchanged with
the next message.

`tests/test_db.py` checks the database and RLS against a real Postgres. It is
skipped unless `TEST_DATABASE_URL` is set (use a separate dev project: it writes
and deletes rows).

### Evals

```sh
cd backend
uv run python -m evals.run                          # all cases in evals/cases/
uv run python -m evals.run progression_grade_names  # or just some
uv run python -m evals.run --repeat 5               # pass rate per case, e.g. 4/5
uv run python -m evals.run --judge-check            # check the judge itself
```

Each case in `backend/evals/cases/` is a seed (sessions dated as days before
today), a question and what the answer must and must not do, plus a note on
the bug it caught. The runner logs the seed for a new throwaway user, asks the
question through the real chat loop, checks the expected tools were called,
has `claude-haiku-5-5` grade the answer against the checklist (with the tool
results as ground truth), and deletes that user's rows. It prints pass/fail
per run (with each check for failed runs, or all with `-v`), the pass rate per
case and the cost: one run of the current three cases costs about half a
cent, `--repeat 5` about 3 cents.

Agent answers vary, so one pass proves little: use `--repeat` before
trusting a fix. To trust the judge, each case also has a `known_bad` answer
with one planted mistake (a real failing reply where there is one) and the
check it must fail (`should_fail`). `--judge-check` grades only those, with
tool results computed from the seed in memory, and fails unless the judge
fails that exact check. It makes no agent calls and needs no database.

The runner needs the API key and the database, so it isn't part of `pytest`
or CI.

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

## Deploy

Both the backend and the frontend run free on Vercel (Hobby), with Render's
free tier as a fallback for the backend. See [docs/deploy.md](docs/deploy.md)
for the checklist, the environment variables and the limits.

## What the agent can do

| Tool | Use |
| --- | --- |
| `log_session` | Store a run or a climbing session. A climbing session can include its individual climbs in the same call. |
| `get_history` | Sessions from the last N days, with load, running pace, and each session's climbs, number sent and hardest sent grade. |
| `get_training_load` | Load per day and per week across sports, plus the acute:chronic workload ratio. |
| `calculate_progression` | "Am I improving?" Weekly running and climbing numbers with a trend per metric. |

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

**Progression** (`calculate_progression`, default 8 calendar weeks) gives per week:

- Running: runs, distance, duration, pace (min/km), and pace per distance band
  (`under_7km`, `7_to_15km`, `over_15km`), so a slow long run isn't read as
  getting slower. Pace is total minutes / total km over runs with a distance.
- Climbing: climbs, hardest sent grade, flash grade (hardest sent with
  `attempts` = 1), and send rate per grade (sent / tried). Unsent climbs never
  count as the hardest sent; climbs with no attempt count are tried but never
  flashes.

Each sport also has `last_session` (its latest session date) and
`days_since_last_session`, so the agent can say when the user last trained
without reading dates off the weekly rows.

Every metric also has a trend: `improving`, `flat`, `declining` or
`not enough data`. The rule compares the last 14 days (today included) with
the 28 days before:

- Each side needs at least 3 sessions that have the metric, else
  `not enough data`.
- Volumes (distance, duration, climbs) compare weekly averages; pace compares
  minutes per km (lower is better); grades compare the average over sessions
  of each session's hardest send (or flash) as a grade ordinal; send rate is
  compared per grade.
- A change is `flat` if under 10% for volume, 2% for pace, half a grade for
  grades, or 10 percentage points for send rate. For volume, `improving` only
  means more.

The trend comes with the recent and baseline values and how many sessions each
rests on, and the agent is told to quote those numbers and to say so when
there isn't enough data. Each sport is one function in
`progression.SPORT_MODULES`; strength can be added as another.
