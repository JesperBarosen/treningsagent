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
- The PR description says what changed, why, how it was tested, and includes screenshots for UI changes.
- Don't merge until the user says so. Then merge with a merge commit (not squash), delete the branch, check out `main` and pull.

## Secrets
- Never print or commit secrets. `.env` files stay gitignored.

## Servers
- Stop any servers you start before finishing.

## Language
- The project language is English: code, commits, PRs and UI.
