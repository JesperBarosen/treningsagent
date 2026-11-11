# Working rules

## Branches
- Every change goes on its own branch from the latest `main`, named after the feature (e.g. `dashboard`, `auth`, `deploy`).
- Never commit or push directly to `main`.

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
- Don't merge until the user says so. Then merge with a merge commit (not squash), delete the branch, check out `main` and pull.

## Secrets
- Never print or commit secrets. `.env` files stay gitignored.

## Servers
- Stop any servers you start before finishing.

## Language
- The project language is English: code, commits, PRs and UI.
