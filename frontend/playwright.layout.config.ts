import { defineConfig } from "@playwright/test";
import { AUTH_URL } from "./e2e/layout/mock-auth";

// The phone layout check (#110): every page at 375 and 390 px must be no wider
// than the screen. Run with `npm run test:layout`. It starts its own Next dev
// server on port 3100 (never 3000), signed in through a mock auth server, with
// the API answered from e2e/fixtures/app-data.json, and stops both afterwards.
const PORT = 3100;
const API_URL = "http://127.0.0.1:8099"; // nothing listens here: the test answers every call

export default defineConfig({
  testDir: "./e2e/layout",
  // *.layout.ts, so the screenshot config (testDir ./e2e) never runs it.
  testMatch: "**/*.layout.ts",
  outputDir: "./test-results/layout",
  globalSetup: "./e2e/layout/global-setup.ts",
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  },
  projects: [375, 390].map((width) => ({
    name: `phone-${width}`,
    use: { viewport: { width, height: 844 } },
  })),
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: AUTH_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "layout-check",
      NEXT_PUBLIC_API_URL: API_URL,
    },
  },
});
