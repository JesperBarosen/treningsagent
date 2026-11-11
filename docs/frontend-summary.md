# Frontend: summary (part 1)

Branch `frontend`, from `main` at `24da56c`. Scope was cut halfway through to
save usage: **design tokens, chat page and sessions page only**, with 375px
screenshots in light and dark. The dashboard, desktop screenshots, the README
update and the pull request are left (see the end).

## What's built

**Backend** (`backend/`)

- CORS for `http://localhost:3000` only (GET and POST).
- Read-only endpoints that reuse the agent's own tool functions through the
  same RLS store (`get_store`), so the app can never disagree with the agent:
  - `GET /sessions?days=56`: `tools.get_history`
  - `GET /training-load?weeks=8`: `tools.get_training_load`
  - `GET /progression?weeks=8`: `tools.calculate_progression`
  - `GET /health`: touches neither the database nor Claude
  The last two are ready for the dashboard; no frontend uses them yet.
- `POST /chat` also returns `logged_sessions`: the results of the
  `log_session` calls that succeeded *in this turn*. The frontend uses them for
  the in-chat cards instead of parsing `history`. Backward-compatible addition.
- `seed.py` / `unseed.py`: 8 calendar weeks of fake runs and climbing for the
  fixed test user (34 sessions, with a deload week 3 weeks ago, pace and grades
  slowly improving). Writes go through `log_session` and RLS. The inserted ids
  go to `backend/.seed_ids.json` (gitignored), and unseed deletes exactly those
  ids for that user, then removes the file. Seed refuses to run twice.
- Tests: 90 passed, 8 skipped (the DB tests, as before). New: endpoint tests
  (each matches its tool's output, range validation, CORS, logged_sessions
  including failed logs and earlier turns), seed validity, the lighter week,
  unseed refusing another user.

**Frontend** (`frontend/`, Next.js 16.4 App Router, TypeScript, Tailwind 4)

- `DESIGN.md`: colour tokens (light and dark, contrast checked), the grade
  colours, type scale, spacing, radius, components. Tokens are in
  `app/globals.css`, and the default Tailwind palette is switched off
  (`--color-*: initial`), so a class like `bg-blue-500` doesn't compile and
  components can't use colours outside the tokens.
- **Chat (home)**: message list, composer fixed above the tab bar, quick
  replies ("Log a run" / "Log climbing" fill the input with a sentence to
  complete, "Am I improving?" / "This week's load" send at once), a logged
  session card ("Run · 10 km · 50 min · effort 6", climbs as chips), a thinking
  indicator, an inline error with "Send again" (and a backend-down message),
  New chat. The conversation (history + conversation_id) is kept in
  localStorage, so a reload keeps it. Replies go through a small markdown
  renderer (bold, lists, headings) that builds React elements, never HTML.
- **Sessions**: the last 8 weeks grouped by calendar week ("This week", "Last
  week", "Week of 12 Oct") with session count and load, an All / Running /
  Climbing filter, climbs as grade chips (bolt = flash, check = sent, dashed =
  not sent) with a legend. Tapping a row opens the details in a native
  `<dialog>`: bottom sheet on mobile, centred from `sm`. It has stats, notes and
  every climb with style and attempts. Loading skeleton, empty state (with a
  link to the chat), empty-filter state, error state with retry.
- Accessibility: 44px tap targets, `focus-visible` rings, skip link,
  `aria-current` on nav, labelled chips ("blue boulder, flashed"),
  `aria-live` conversation, reduced-motion support.
- Checks: `npm run typecheck`, `npm run lint` and `npm test` (Vitest, 8 tests)
  all pass. `next build` passes.
- Screenshots: `docs/screenshots/*-375-{light,dark}.png`, 9 views x 2 themes:
  chat empty, conversation with logged run and climbing, markdown answer,
  backend down; sessions list, details sheet, loading, empty, error. I looked
  at them and fixed what was off: a grey hole in the details grid, a
  duration that wrapped, and missing list bullets (see the gitignore bug below).

## Design decisions

- **Palette**: chalk-white and night-slate neutrals, one spruce accent. Gym
  grades are the only loud colours, so they stay the identity. Running is
  spruce and climbing is ochre, and neither is a grade colour, so a sport is
  never mistaken for a grade.
- **Grades**: the same hex in both themes (they're physical holds). Every dot
  has a 1px `--grade-ring` (3.9:1 on white in light, 3.7:1 against black in
  dark), so white and black holds stay visible. The grade name is always
  printed next to the colour.
- **Fonts**: Space Grotesk for headings and numbers, Inter for text. All
  numbers use tabular figures.
- **No numbers computed in the frontend**: load, pace and sent counts come
  from the backend. The only sum in the frontend is the per-week load in the
  sessions list headers, a plain sum of the backend's per-session `load`
  (in-week grouping for display). The dashboard should use `/training-load`
  for weekly numbers instead.
- **Session details** use local state, not a route, to avoid
  `useSearchParams`/Suspense rules under Cache Components, and because the
  list already has all the data. A `/sessions/[id]` route would need a
  get-by-id in the store.
- **Screenshots never call Claude**: chat replies are canned in
  `e2e/screenshots.spec.ts`, so no API cost and no rows written. Sessions use
  the real backend with seeded data.

## Things I wasn't sure about

- `logged_sessions` changes the `/chat` contract (added only). If you'd rather
  keep `/chat` as is, the frontend could parse `history` instead.
- Logging quick replies fill the input instead of sending "I want to log a
  run" and letting the agent ask. Filling saves a round trip and a Claude
  call. It's a single constant in `app/chat.tsx` if you want it the other way.
- I fixed the root `.gitignore`: the Python template's `lib/` also ignored
  `frontend/lib/`, so git would have silently left it out and Tailwind skipped
  scanning it. It's now `/lib/` and `/lib64/` (root only).
- I added `postcss.config.mjs`. The scaffold only wires Tailwind into
  Turbopack, so `next dev --webpack` (and any tool that uses PostCSS) rendered
  the app unstyled.

## Known issues

- **Dev server mishap**: I first started `next dev --webpack` by mistake.
  Stopping the background task left its node process holding port 3000, and
  the auto-mode classifier blocked me from killing it then. Next allows only
  one dev server per project folder, so I took the screenshots against
  `next build` + `next start` on 3001/3002. Playwright forwarded the API calls
  from Node and added the CORS header itself, so CORS in FastAPI stayed
  `localhost:3000` only. When you asked, I stopped every server I started;
  ports 3000-3002 and 8000 are free.
- The chat isn't streamed; there's a thinking indicator instead.
- No session edit or delete (the API and RLS don't allow it either).
- `next-env.d.ts` and `.next/` are generated; `npm run typecheck` runs
  `next typegen` first because `LayoutProps` comes from generated types.
- The database is back to how it was: 0 sessions and 0 climbs. The 20
  `model_calls` rows from before this work are still there; nothing here
  added any.

## What's left

1. **Dashboard**: weekly load chart stacked by sport (Recharts, not installed
   yet), the acute:chronic ratio labelled "rough guide / not enough data",
   running pace per distance band, climbing hardest send and flash over time,
   send rate per grade. The endpoints `/training-load` and `/progression`
   already exist and are tested. Add a third tab to `components/nav.tsx`.
   Load the dataviz guidance before choosing chart colours (series: `--accent`
   for running, `--climb` for climbing).
2. **Desktop screenshots** (1280px light and dark): add a `desktop` viewport
   project in `playwright.config.ts`, and include the dashboard.
3. **README**: how to run the frontend and backend together, with screenshots.
4. **Pull request** to `main`. `gh` isn't installed, so write the description
   to `docs/frontend-pr.md` and open it from
   https://github.com/JesperBarosen/treningsagent/compare/main...frontend
