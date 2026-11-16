import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { sessionCookie } from "./mock-auth";

// #110: no page may be wider than a phone screen (375 and 390 px). A page that
// is wider can be dragged sideways. The check fails on the real cause; the app
// never hides overflow on <html> or <body>.

const API = "http://127.0.0.1:8099";
const DATA = JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "app-data.json"), "utf8"));

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

test("Sessions, every filter", async ({ page }) => {
  await open(page, "/sessions");
  await expect(page.getByRole("radio", { name: "Other" })).toBeVisible();
  await expectFits(page, "Sessions");
  for (const sport of ["Running", "Climbing", "Strength", "Other", "All"]) {
    await page.getByRole("radio", { name: sport }).click();
    await expectFits(page, `Sessions, ${sport}`);
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
