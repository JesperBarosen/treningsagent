import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// Chat replies are canned (no Claude calls, nothing logged to the database).
// Sessions come from the real backend, so seed it first.

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const OUT = path.join(__dirname, "..", "..", "docs", "screenshots");

const iso = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString("sv-SE"); // YYYY-MM-DD in local time
};

const REPLIES: Record<string, object> = {
  "Ran 10 km in 50 min today, effort 6": {
    reply: "Logged your run: 10 km in 50 min at 5:00 /km. Nice steady effort.",
    logged_sessions: [
      { id: 901, sport: "running", date: iso(0), duration_min: 50, effort: 6, distance_km: 10 },
    ],
  },
  "Bouldered 90 min yesterday, effort 7. Flashed two blues, sent a purple in 3 tries, fell off a red": {
    reply: "Logged yesterday's session with 4 climbs. The purple in 3 tries is your best send this week.",
    logged_sessions: [
      {
        id: 902, sport: "climbing", date: iso(1), duration_min: 90, effort: 7,
        climbs: [
          { grade: "blue", grade_ordinal: 3, sent: true, attempts: 1, style: "boulder" },
          { grade: "blue", grade_ordinal: 3, sent: true, attempts: 1, style: "boulder" },
          { grade: "purple", grade_ordinal: 4, sent: true, attempts: 3, style: "boulder" },
          { grade: "red", grade_ordinal: 5, sent: false, style: "boulder" },
        ],
      },
    ],
  },
  "Am I improving?": {
    reply:
      "**Running: improving.** Pace on 7-15 km runs went from 5:21 to 5:06 /km (4 vs 5 runs).\n\n" +
      "**Climbing: mixed.**\n- Hardest send per session: purple → red on average (5 vs 7 sessions)\n" +
      "- Red send rate: not enough data yet\n\nKeep the long run easy this week.",
    logged_sessions: [],
  },
};

/** Forward API calls from Node and add a CORS header, so the screenshots also
 *  work against a frontend on another port than the one the backend allows. */
async function proxyApi(page: Page) {
  await page.route(`${API}/**`, async (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST",
    };
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.url().endsWith("/chat")) {
      const { message, conversation_id } = req.postDataJSON();
      const canned = REPLIES[message] ?? { reply: "OK.", logged_sessions: [] };
      return route.fulfill({
        headers: cors,
        json: { history: [], conversation_id: conversation_id ?? "demo", ...canned },
      });
    }
    const res = await route.fetch();
    return route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

/** Saves docs/screenshots/<name>-<width>-<light|dark>.png. */
async function shot(page: Page, name: string, project: string, fullPage = false) {
  await page.waitForTimeout(400); // let entry animations finish
  const width = page.viewportSize()?.width ?? 375;
  const theme = project.replace("desktop-", "");
  if (fullPage) {
    // Grow the viewport to the whole page, so fixed bars sit at its edges
    // instead of over the middle of a stitched full-page image.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: path.join(OUT, `${name}-${width}-${theme}.png`), fullPage });
}

async function say(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Coach is thinking")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await proxyApi(page);
});

test("chat: empty", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByText("How did training go?")).toBeVisible();
  await shot(page, "chat-empty", info.project.name);
});

test("chat: conversation with logged sessions", async ({ page }, info) => {
  await page.goto("/");
  for (const message of Object.keys(REPLIES)) await say(page, message);
  await expect(page.getByText("Logged · Today")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "chat-logged", info.project.name);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, "chat-answer", info.project.name);
});

test("chat: backend down", async ({ page }, info) => {
  await page.route(`${API}/chat`, (route) => route.abort());
  await page.goto("/");
  await say(page, "Ran 5 km easy, 30 min, effort 3");
  await expect(page.getByText("Can't reach the backend")).toBeVisible();
  await shot(page, "chat-error", info.project.name);
});

test("sessions: list and details", async ({ page }, info) => {
  await page.goto("/sessions");
  await expect(page.getByText("This week")).toBeVisible();
  await shot(page, "sessions", info.project.name);
  await page.getByRole("button", { name: /^Climbing on/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "session-details", info.project.name);
});

test("sessions: loading, empty and error", async ({ page }, info) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(`${API}/sessions*`, async (route) => {
    await held;
    await route.fulfill({ json: [], headers: { "access-control-allow-origin": "*" } });
  });
  await page.goto("/sessions");
  await expect(page.getByLabel("Loading sessions")).toBeVisible();
  await shot(page, "sessions-loading", info.project.name);
  release();
  await expect(page.getByText("No sessions yet")).toBeVisible();
  await shot(page, "sessions-empty", info.project.name);

  await page.unroute(`${API}/sessions*`);
  await page.route(`${API}/sessions*`, (route) => route.abort());
  await page.reload();
  await expect(page.getByText("Can't reach the backend")).toBeVisible();
  await shot(page, "sessions-error", info.project.name);
});

test("dashboard @desktop", async ({ page }, info) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Weekly load" })).toBeVisible();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await shot(page, "dashboard", info.project.name, true);
});

test("dashboard: loading, empty and error @desktop", async ({ page }, info) => {
  const empty: Record<string, object> = {
    "training-load": {
      daily: [], acute_7d_avg: 0, chronic_28d_avg: 0, acute_chronic_ratio: null,
      ratio_status: "not_enough_data", history_days: 0,
      weekly: [{ week_start: iso(0), load: 0, sessions: 0, load_by_sport: {} }],
    },
    progression: {
      weeks: 8, today: iso(0), trend_rule: "",
      running: { sessions: 0, weekly: [], trends: {} },
      climbing: { sessions: 0, weekly: [], trends: {}, grade_scale: [] },
    },
  };
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const routes = [`${API}/training-load*`, `${API}/progression*`];
  for (const url of routes) {
    await page.route(url, async (route) => {
      await held;
      const key = new URL(route.request().url()).pathname.slice(1);
      await route.fulfill({ json: empty[key], headers: { "access-control-allow-origin": "*" } });
    });
  }
  await page.goto("/dashboard");
  await expect(page.getByLabel("Loading dashboard")).toBeVisible();
  await shot(page, "dashboard-loading", info.project.name);
  release();
  await expect(page.getByText("Nothing to chart yet")).toBeVisible();
  await shot(page, "dashboard-empty", info.project.name);

  for (const url of routes) await page.unroute(url);
  await page.route(`${API}/progression*`, (route) => route.abort());
  await page.reload();
  await expect(page.getByText("Can't reach the backend")).toBeVisible();
  await shot(page, "dashboard-error", info.project.name);
  await page.unrouteAll({ behavior: "ignoreErrors" }); // /training-load may still be in flight
});
