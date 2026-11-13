# Deploying treningsagent

The production setup is free: two Vercel projects on the Hobby plan, both from
this repository, plus the existing Supabase project.

| Part | Where | Root directory | URL (example) |
| --- | --- | --- | --- |
| Backend (FastAPI) | Vercel, Python function | `backend` | `https://treningsagent-api.vercel.app` |
| Frontend (Next.js) | Vercel | `frontend` | `https://treningsagent.vercel.app` |
| Database and sign-in | Supabase | n/a | your existing project |

This page lists environment variables **by name only**. Copy the values from
your local `.env` / `frontend/.env.local` or the Supabase dashboard straight into
Vercel, and never paste them anywhere else.

## Vercel Hobby limits and the /chat loop

Checked against Vercel's docs on 2026-11-13
([function limits](https://vercel.com/docs/functions/limitations),
[Hobby plan](https://vercel.com/docs/plans/hobby),
[Python runtime](https://vercel.com/docs/functions/runtimes/python)).

| Limit (Hobby) | Value | What it means here |
| --- | --- | --- |
| Max duration | 300 s, default and maximum | `backend/vercel.json` sets 300 s for `api.py`. See below. |
| Memory / CPU | 2 GB / 1 vCPU | Plenty; the API keeps no data in memory. |
| Bundle size | 500 MB uncompressed for Python | Our dependencies are a few tens of MB. Tests and evals are excluded. |
| Request / response body | 4.5 MB | `/chat` sends the whole chat history each time; even long chats are far below this. |
| Active CPU | 4 CPU-hours per month | Time spent waiting for Claude or Postgres doesn't count, only our own Python code. |
| Function invocations | 1,000,000 per month | Not a concern for personal use. |
| Runtime logs | 1 hour | Look at errors soon after they happen. |
| Python | 3.12 (default), 3.13, 3.14 | `backend/.python-version` pins 3.12. |

If a Hobby limit is used up, that feature pauses until 30 days have passed.
Vercel's fair-use guidelines limit Hobby to personal, non-commercial projects.

**The /chat loop against the 300 s limit.** One `/chat` request runs the whole
tool loop in `backend/chat.py` before it answers. That is up to `MAX_STEPS = 10`
calls to Claude (`claude-haiku-5-5`, `max_tokens` 16,000), plus the tool calls to
Postgres in between. A normal turn ("Ran 10 km in 50 min") is 1-3 calls and a
few seconds, far inside the limit. Only a worst case could pass 300 s: ten
rounds, each with a very long reply. Vercel then returns a 504
(`FUNCTION_INVOCATION_TIMEOUT`) and the chat shows an error. The user's
message gets no reply, but any session already logged in that turn is saved.
If that ever happens in practice, see [Fallback: Render](#fallback-render-free-tier).

**Database connections.** Each request opens its own Postgres connection, and
serverless instances come and go. Use Supabase's **transaction pooler** (port
6543) for `DATABASE_URL` in production. The code already turns off prepared
statements for it (`backend/db.py`). The session pooler (port 5432) also works,
but it caps how many connections can be open at once.

## Before you start

- [ ] PR merged into `main`.
- [ ] All files in `supabase/migrations/` applied to the Supabase project.
- [ ] A Vercel account (Hobby) connected to the GitHub repository.

## 1. Backend on Vercel

1. In Vercel: **Add New... > Project**, then import the `treningsagent` repository.
2. **Root Directory:** `backend`. Vercel detects **FastAPI**. Leave the build
   settings empty: `pyproject.toml` already points Vercel at `api:app`, and
   dependencies come from `uv.lock`.
3. **Project name:** for example `treningsagent-api`.
4. **Environment Variables** (Production):
   - `ANTHROPIC_API_KEY`
   - `DATABASE_URL` (the transaction pooler string, see above)
   - `SUPABASE_URL`
   - `ALLOWED_ORIGINS`: leave it out for now and set it in step 3
   - `CHAT_DAILY_LIMIT` (optional, default 50)
5. **Deploy.**
6. Open `https://<backend-domain>/health`. It should return `{"status":"ok"}`.
   Note the domain; the frontend needs it.

## 2. Frontend on Vercel

1. **Add New... > Project**, then import the same repository again.
2. **Root Directory:** `frontend`. Vercel detects **Next.js**. Keep the defaults.
3. **Project name:** for example `treningsagent`.
4. **Environment Variables** (Production):
   - `NEXT_PUBLIC_API_URL`: the backend domain from step 1, with `https://`
     and no trailing slash. This is the only setting that points the frontend
     at the backend.
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable key, never the secret key)
5. **Deploy.** Note the production domain.

`NEXT_PUBLIC_*` values are built into the JavaScript. After changing one,
**redeploy** the frontend (Deployments > ... > Redeploy).

## 3. ALLOWED_ORIGINS on the backend

The API only answers browsers coming from the origins listed here (CORS).

1. In the **backend** project: **Settings > Environment Variables**, add
   `ALLOWED_ORIGINS` with the frontend's production origin. That is
   `https://` plus the domain, with no path and no trailing slash. To list more
   than one, separate them with commas (for example the production domain
   and a custom domain). Unset, it allows only `http://localhost:3000`.
2. **Redeploy** the backend. Environment variable changes apply only to new
   deployments.

Preview deployments get their own URLs, so the API rejects them unless you
add those URLs too. That's intended.

## 4. Supabase Auth URLs

In the Supabase dashboard: **Authentication > URL Configuration**.

1. **Site URL:** the frontend's production URL (`https://<frontend-domain>`).
2. **Redirect URLs:** add `https://<frontend-domain>/auth/confirm`. Keep
   `http://localhost:3000/auth/confirm` for local development.
3. Sign-ups stay off (**Authentication > Sign In / Providers**); invite
   users from **Authentication > Users**.

## 5. Smoke test

- [ ] `https://<frontend-domain>` redirects to the sign-in page.
- [ ] A sign-in link arrives, opens `/auth/confirm`, and lands signed in on the chat.
- [ ] "Ran 5 km in 30 min, effort 5" in the chat logs a session that shows up under Sessions.
- [ ] Log, edit and delete a session from the Log tab and the session sheet.
- [ ] The dashboard loads.
- [ ] The browser console shows no CORS errors. If it does, recheck step 3.

## 6. Add to the home screen

**iPhone (Safari):** open the frontend URL in Safari, tap **Share**, then **Add
to Home Screen**, then **Add**. It opens full screen as "Treningsagent".

**Android (Chrome):** open the URL in Chrome, tap the **⋮** menu, then **Add to
home screen** (or **Install app**), then **Install**.

On iPhone, the home-screen app keeps its own sign-in, separate from Safari.
The emailed sign-in link opens in Safari, so the home-screen app may still
show the sign-in page afterwards. See the PR's follow-ups. On Android, the
installed app shares Chrome's sign-in.

## Fallback: Render free tier

If `/chat` keeps hitting the 300 s limit, or the Hobby limits pinch, run the
backend on [Render](https://render.com/docs/free) instead. The frontend stays
on Vercel.

1. In Render: **New > Web Service**, then connect the repository.
2. **Root Directory:** `backend`. **Runtime:** Python 3. **Instance type:** Free.
3. **Build Command:** `pip install uv && uv sync --frozen --no-dev`
4. **Start Command:** `uv run --no-dev uvicorn api:app --host 0.0.0.0 --port $PORT`
5. **Environment:** the same names as in step 1 (`ANTHROPIC_API_KEY`,
   `DATABASE_URL`, `SUPABASE_URL`, `ALLOWED_ORIGINS`, optional
   `CHAT_DAILY_LIMIT`), plus `PYTHON_VERSION` = `3.12`.
6. **Health Check Path:** `/health`.
7. Set the frontend's `NEXT_PUBLIC_API_URL` to the `onrender.com` URL and redeploy the frontend.

Render's free tier trade-offs, from Render's docs:

- The service spins down after 15 minutes without traffic.
- The first request after that waits up to about a minute.
- Each workspace gets 750 free instance hours per month, and free services may be restarted at any time.

Render runs a long-lived process, so there is no per-request function timeout
like Vercel's. Do not use Render's free Postgres; it expires after 30 days.
Keep Supabase.
