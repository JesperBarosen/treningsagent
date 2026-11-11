import { defineConfig } from "@playwright/test";

// Screenshots for docs/screenshots/. Needs the frontend running (default
// http://localhost:3000, override with SCREENSHOT_URL) and, for the sessions
// pages, the backend with seeded data (backend/seed.py).
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: process.env.SCREENSHOT_URL ?? "http://localhost:3000",
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  },
  projects: [
    { name: "light", use: { colorScheme: "light" } },
    { name: "dark", use: { colorScheme: "dark" } },
    // Desktop: only the tests tagged @desktop.
    ...(["light", "dark"] as const).map((colorScheme) => ({
      name: `desktop-${colorScheme}`,
      grep: /@desktop/,
      use: {
        colorScheme,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      },
    })),
  ],
});
