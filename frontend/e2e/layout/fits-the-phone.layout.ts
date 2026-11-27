import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { sessionCookie } from "./mock-auth";

// #110: no page may be wider than a phone screen (375 and 390 px). A page that
// is wider can be dragged sideways. The check fails on the real cause; the app
// never hides overflow on <html> or <body>.

const API = "http://127.0.0.1:8099";
const DATA = JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "app-data.json"), "utf8"));

/** A 12-week plan with long titles and targets (#118): the most chips and text the Plan view gets. */
const PLAN = {
  id: 1, name: "Twelve weeks towards a first half marathon and a red", goal_id: null,
  start_date: "2026-11-23", end_date: "2027-02-14", weeks: 12, status: "active", ended_on: null,
  rationale: null, source: "coach", weekly: [], today: "2026-11-25", current_week: 1,
  week_meta: Array.from({ length: 12 }, (_, i) => ({ index: i + 1, kind: (i + 1) % 4 === 0 ? "deload" : "build", note: null })),
  sessions: [
    { date: "2026-11-23", sport: "climbing", title: "Limit bouldering on the steep wall", state: "done",
      target: { duration_min: 90, effort: 8, grades: [{ system: "gym", grade: "red", count: 3 }, { system: "v", grade: "V5", count: 2 }] },
      done: { id: 9, date: "2026-11-23", duration_min: 95, effort: 8, distance_km: null } },
    { date: "2026-11-24", sport: "running", title: "Easy run", state: "not_done", target: { duration_min: 36, effort: 4, distance_km: 6 } },
    { date: "2026-11-25", sport: "other", title: "Hangboard max hangs", state: "today",
      target: { duration_min: 30, effort: 7, values: { hangboard: { kg: 12.5, s: 10, rest: 3, sets: 6 } } } },
    { date: "2026-11-25", sport: "running", title: "Strides", state: "today", target: { duration_min: 20, effort: 5, distance_km: 3 } },
  ].map((s, i) => ({ id: i + 1, plan_id: 1, slot: 0, template_id: null, status: "planned", skip_reason: null,
    session_id: null, week: 1, planned_load: null, done: null, ...s })),
};

/** A change proposal (#131) with long lines, as the chat returns it. */
const CHANGES = {
  reply: "Here's what I'd change. Nothing changes until you accept it.",
  history: [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: "…" }] }],
  conversation_id: "00000000-0000-0000-0000-000000000001",
  logged_sessions: [],
  change_proposals: [{
    change_proposal: true, stored: false, version: "v1",
    plan: { id: 1, name: PLAN.name, start_date: PLAN.start_date, weeks: 13, end_date: "2027-02-21" },
    reason: "I'd ease back in this week and push the rest of the plan back a week. If anything hurts, see a physiotherapist.",
    changes: [
      { index: 0, type: "shift", label: "Shift", description: "Move the remaining 31 sessions a week later (the plan now ends 21 Feb)" },
      { index: 1, type: "lighter", label: "Lighter", description: "Make week 2 lighter: skip the Hangboard max hangs on Thursday 3 Dec; the Limit bouldering on the steep wall on Saturday 5 Dec 90 → 60 min, effort 8 → 6" },
      { index: 2, type: "move", label: "Move", description: "Move the Strides on Wednesday 25 Nov to Friday" },
    ],
    warnings: ["How much lighter has no sourced number yet (L2b, needs source): this is fewer or shorter sessions at the same or lower effort."],
    accept: { version: "v1", changes: [], context: {} },
  }],
};

/** Answer every API call from the fixture (made by the backend's own tools). */
async function mockApi(page: Page) {
  await page.route(`${API}/**`, async (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const sport = url.searchParams.get("sport");
    const body: Record<string, unknown> = {
      "/sessions": DATA.sessions,
      "/training-load": sport ? DATA.training_load.by_sport[sport] : DATA.training_load,
      "/progression": DATA.progression,
      "/goals": DATA.goals,
      "/pause": { active: null, recent: null },
      "/gyms": DATA.gyms,
      "/templates": DATA.templates,
      "/plans": { current: PLAN, plans: [] },
      "/chat": CHANGES,
    };
    return route.fulfill({ headers: cors, json: body[url.pathname] ?? {} });
  });
}

test.beforeEach(async ({ page, context, baseURL }) => {
  const { name, value } = sessionCookie();
  await context.addCookies([{ name, value, url: baseURL! }]);
  await mockApi(page);
});

/** Fails with the elements that stick out past the screen's right edge. */
async function expectFits(page: Page, where: string) {
  await page.waitForTimeout(300); // let entry animations and late data settle
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const width = root.clientWidth;
    const culprits: string[] = [];
    if (root.scrollWidth > width) {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        // Report the outermost elements that stick out, not every child of them.
        if (r.width > 0 && r.right > width + 0.5 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > width + 0.5)) {
          const name = el.tagName.toLowerCase() + (el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : "");
          culprits.push(`${name} right=${Math.round(r.right)} "${(el.textContent ?? "").trim().slice(0, 40)}" class="${el.className}"`.slice(0, 240));
        }
      }
    }
    return { scrollWidth: root.scrollWidth, clientWidth: width, culprits: culprits.slice(0, 6) };
  });
  expect(result.scrollWidth, `${where} is wider than the screen:\n${result.culprits.join("\n")}`).toBeLessThanOrEqual(result.clientWidth);
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page).toHaveURL(new RegExp(`${url === "/" ? "/$" : url}`)); // still signed in
}

test("Coach", async ({ page }) => {
  await open(page, "/");
  await expectFits(page, "Coach");
});

test("Coach while typing: opaque composer, no tab bar (#138)", async ({ page }) => {
  await open(page, "/");
  const composer = page.getByTestId("composer");
  // Opaque before and while typing: nothing behind it shows through.
  const alpha = () =>
    composer.evaluate((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      const parts = bg.match(/[\d.]+/g) ?? [];
      return bg.startsWith("rgba") || bg.includes("/") ? Number(parts[3] ?? 1) : 1;
    });
  expect(await alpha()).toBe(1);
  await page.getByLabel("Message").focus();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden(); // Log included
  expect(await alpha()).toBe(1);
  // The column ends at the visible part's bottom (Chromium has no on-screen
  // keyboard: the window's bottom), with the composer as its last child (#144).
  const box = await composer.boundingBox();
  const bottom = await page.evaluate(() => Math.round((visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? innerHeight)));
  expect(Math.abs(Math.round(box!.y + box!.height) - bottom)).toBeLessThanOrEqual(1);
  await expectFits(page, "Coach while typing");
});

test("Coach: the document never scrolls, only the messages do (#144)", async ({ page }) => {
  await open(page, "/");
  const docScrolls = () => page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight);
  expect(await docScrolls()).toBe(false);
  const messages = page.getByTestId("messages");
  expect(await messages.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  expect(await messages.evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe("contain");
  // The composer is in the column, not fixed on its own.
  expect(await page.getByTestId("composer").evaluate((el) => getComputedStyle(el).position)).toBe("static");
  await page.getByLabel("Message").focus();
  expect(await docScrolls()).toBe(false);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expectFits(page, "Coach column while typing");
});

test("Coach: a change proposal, and its Review (#131)", async ({ page }) => {
  await open(page, "/");
  await page.getByLabel("Message").fill("I was ill last week, can you adjust my plan?");
  await page.getByLabel("Message").press("Enter");
  const card = page.getByRole("region", { name: /Proposed change/ });
  await expect(card).toBeVisible();
  // Opaque: nothing of the conversation shows through behind it.
  expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/rgba\(.*, 0\)|transparent/);
  for (const name of ["Accept", "Review", "Not now"]) {
    const box = await card.getByRole("button", { name }).boundingBox();
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }
  await expectFits(page, "Coach, change proposal");
  await card.getByRole("button", { name: "Review" }).click();
  await expect(card.getByRole("checkbox")).toHaveCount(3);
  await expectFits(page, "Coach, change proposal in Review");
});

test("Sessions, every filter", async ({ page }) => {
  await open(page, "/sessions");
  await expect(page.getByRole("radio", { name: "Other" })).toBeVisible();
  await expectFits(page, "Sessions");
  for (const sport of ["Running", "Climbing", "Strength", "Other", "All"]) {
    await page.getByRole("radio", { name: sport }).click();
    await expectFits(page, `Sessions, ${sport}`);
  }
});

test("Sessions and Dashboard: only <main> scrolls, so the bars stay at the screen edges", async ({ page }) => {
  for (const path of ["/sessions", "/dashboard"]) {
    await open(page, path);
    const main = page.locator("main#main");
    expect(await main.evaluate((el) => getComputedStyle(el).overflowY), path).toBe("auto");
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight), path).toBe(true);
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(await page.evaluate(() => window.scrollY), path).toBe(0);
    const height = page.viewportSize()!.height;
    const tabs = await page.locator("[data-tab-bar]").boundingBox();
    expect(Math.round(tabs!.y + tabs!.height), `${path}: tab bar at the bottom`).toBe(height);
    const top = await page.locator("header").first().boundingBox();
    expect(top!.y, `${path}: top bar at the top`).toBe(0);
  }
});

test("Dashboard, every filter", async ({ page }) => {
  await open(page, "/dashboard");
  const filter = page.getByRole("radiogroup", { name: "Show sport" });
  await expect(filter).toBeVisible();
  await expectFits(page, "Dashboard");
  for (const sport of ["Running", "Climbing", "Strength", "Other", "All"]) {
    await filter.getByRole("radio", { name: sport }).click();
    await expectFits(page, `Dashboard, ${sport}`);
  }
});

test("Plan, every week and the leave confirm", async ({ page }) => {
  await open(page, "/plan");
  await expect(page.getByRole("radiogroup", { name: "Week" })).toBeVisible();
  await expectFits(page, "Plan");
  await page.getByRole("radio", { name: "W12 · lighter" }).click();
  await expectFits(page, "Plan, week 12");
  await page.getByRole("button", { name: "Leave plan" }).click();
  await expectFits(page, "Plan, leave confirm");
});

test("You and Account", async ({ page }) => {
  await open(page, "/you");
  await expectFits(page, "You");
  await open(page, "/account");
  await expectFits(page, "Account");
});

test("Gyms and the gym editor", async ({ page }) => {
  await open(page, "/gyms");
  await page.getByRole("button", { name: /Fontainebleau Boulders Centre/ }).click();
  await expect(page.getByRole("heading", { name: "Edit gym" })).toBeVisible();
  await expectFits(page, "Gym editor");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add gym" }).click();
  await expectFits(page, "New gym");
});

test("Log forms and the template editor", async ({ page }) => {
  await open(page, "/templates");
  await expect(page.getByRole("button", { name: /Fingerboard/ })).toBeVisible();
  await expectFits(page, "Log forms");
  await page.getByRole("button", { name: /Fingerboard/ }).click();
  await page.getByRole("button", { name: /^Hangs/ }).click(); // open the sets field's settings
  await expectFits(page, "Template editor");
  await page.getByRole("button", { name: "Add field" }).click();
  await expectFits(page, "Add field sheet");
});

test("Log, every sport and template", async ({ page }) => {
  await open(page, "/log");
  await expect(page.getByRole("radio", { name: "Fingerboard" })).toBeVisible();
  await expectFits(page, "Log");
  for (const sport of ["Run", "Strength", "Other"]) {
    // .first(): the built-in sport, not a template of the same name (the Strength starter).
    await page.getByRole("radio", { name: sport, exact: true }).first().click();
    await expectFits(page, `Log, ${sport}`);
  }
  await page.getByRole("radio", { name: "Climb", exact: true }).click();
  await expect(page.getByRole("button", { name: "Gym" })).toBeVisible();
  await expectFits(page, "Log, Climb, gym colours");
  for (const system of ["V-scale", "Font"]) {
    await page.getByRole("radio", { name: system }).click();
    await expectFits(page, `Log, Climb, ${system}`);
  }
  await page.getByRole("button", { name: "Add 6A+" }).click();
  await page.getByRole("button", { name: "Add 7A+" }).click();
  await expectFits(page, "Log, Climb, Font climbs added");
  await page.getByRole("button", { name: "Gym" }).click();
  await expectFits(page, "Log, gym sheet");
  await page.getByRole("button", { name: /Outdoors or a board/ }).click();
  await page.getByRole("radio", { name: "Fingerboard" }).click();
  await page.getByRole("button", { name: "Add hangs" }).click();
  await page.getByRole("button", { name: "Add group" }).click();
  await expectFits(page, "Log, Fingerboard with two groups");
});
