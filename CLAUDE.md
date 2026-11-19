# Working rules

## Branches
- Every change goes on its own branch from the latest `main`, named after the feature (e.g. `dashboard`, `auth`, `deploy`).
- Never commit or push directly to `main`.
- Create every git worktree inside `C:\Users\jespe\kode\treningsagent-worktrees\<branch-name>` (e.g. `...\treningsagent-worktrees\fix\coach-scroll-jank`), never next to the repo. Don't switch branches in the main folder while the user may be testing there; use a worktree instead.

## Commits
- Small commits with clear messages.
- Before each commit, run the checks:
  - Backend tests: `cd backend && uv run pytest`
  - Frontend: `cd frontend && npm run typecheck && npm run lint && npm test`

## Pull requests
- When a part is done, push the branch and open a PR with `gh`.
- PR titles are plain English and describe the change (e.g. "Add the dashboard page"), with no prefixes or ticket codes.
- Fill in `.github/pull_request_template.md`: What, Why, How it was tested, Screenshots (UI only) and Follow-ups.
- Label every PR (`gh pr create --label ...`):
  - exactly one type label: `type: feature`, `type: fix`, `type: refactor`, `type: docs`, `type: test` or `type: chore`
  - one or more area labels: `area: backend`, `area: frontend`, `area: agent`, `area: evals`, `area: database` or `area: infra`
  - sport labels when the change touches a sport: `sport: running`, `sport: climbing`
- Assign every PR to the user and to the matching milestone (`gh pr create --assignee @me --milestone "..."`):
  - `MVP: usable on phone`: chat, logging, sessions, dashboard, sign-in, deployment, and fixes or chores for the current app
  - `Custom log forms`: log forms the user can shape per sport or session type
  - `Training plans and proposals`: the agent proposing sessions and plans
  - `Research and citations (Phase 3)`: advice backed by research, with citations
  - `Import (GPX/FIT)`: importing sessions from GPX and FIT files
  - If no milestone fits, ask the user rather than leaving it empty.
- Don't merge until the user says so. Then merge with a merge commit (not squash), delete the branch, check out `main` and pull.

## Project board
- Every new issue goes in the GitHub Project "Treningsagent roadmap"
  (https://github.com/users/JesperBarosen/projects/1) with all fields set:
  Status, Priority (`P0 critical`, `P1 high`, `P2 medium`, `P3 later`), Size (`S`, `M`, `L`)
  and Phase (`MVP`, `Design`, `Plans and proposals`, `Research (Phase 3)`, `Polish (Phase 4-5)`).
- A PR that closes an issue stays off the board: link the issue in the PR body
  (`Closes #n`) and track the work through the issue.
- A PR that closes no issue goes on the board itself, with the same fields set. Don't create
  an issue just to track it; link any related issues from the PR description instead.
- Status: new work starts in `Backlog` (or `Next` when it is up next). Move the item (the issue,
  or the PR when it has no issue) to `In progress` when work on it starts, and to `In review`
  when its PR opens. `Done` is for merged PRs and closed issues.
- Use `gh project item-add` and `gh project item-edit`.

## Secrets
- Never print or commit secrets. `.env` files stay gitignored.

## Servers
- Stop any servers you start before finishing.

## Language
- The project language is English: code, commits, PRs and UI.
