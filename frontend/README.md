# treningsagent frontend

Next.js (App Router, TypeScript) and Tailwind. Design tokens and components
are described in [DESIGN.md](DESIGN.md).

```sh
cp .env.example .env.local   # NEXT_PUBLIC_API_URL, default http://localhost:8000
npm install
npm run dev                  # http://localhost:3000 (the only origin the API allows)
npm run typecheck && npm run lint && npm test
```

Screenshots (`docs/screenshots/`): start the backend with seeded data
(`cd ../backend && uv run python seed.py`), the frontend, then
`npx playwright install chromium` once and `npm run screenshots`. Chat replies
are canned in `e2e/screenshots.spec.ts`, so no Claude calls are made.
`SCREENSHOT_URL` points it at another frontend URL.
