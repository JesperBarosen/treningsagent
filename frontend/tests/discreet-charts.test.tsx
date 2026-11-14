import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PaceChart, WeeklyLoadChart } from "@/app/dashboard/charts";
import type { TrainingLoad } from "@/lib/api";

// The discreet rule exactly as globals.css defines it (Tailwind isn't run in
// jsdom), so the test fails if the CSS and the chart markup drift apart.
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const HIDE_RULE = css.match(/:root\[data-discreet\] \[data-discreet-hide\] \{[^}]*\}/)?.[0];

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // ResponsiveContainer measures its parent; jsdom has no layout.
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 360, bottom: 224, width: 360, height: 224, toJSON() {} }) as DOMRect;
  const style = document.createElement("style");
  style.textContent = HIDE_RULE ?? "";
  document.head.appendChild(style);
});

afterEach(() => document.documentElement.removeAttribute("data-discreet"));

const LOAD: TrainingLoad = {
  daily: [],
  weekly: [
    { week_start: "2026-10-26", load: 1500, sessions: 3, load_by_sport: { running: 900, climbing: 600 } },
    { week_start: "2026-11-02", load: 3000, sessions: 5, load_by_sport: { running: 1800, climbing: 1200 } },
  ],
  acute_7d_avg: 0,
  chronic_28d_avg: 0,
  acute_chronic_ratio: null,
  ratio_status: "not_enough_data",
  history_days: 14,
};

/** Rendered SVG text, split into y-axis values (marked by our ValueTick) and the rest.
 *  jsdom can't measure text, so Recharts lays out only some ticks: assert on
 *  what is rendered, not on how many. */
async function chartTexts(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector("text")).not.toBeNull());
  const texts = [...container.querySelectorAll<SVGTextElement>("text")];
  return {
    values: texts.filter((t) => t.closest("[data-discreet-hide]")),
    others: texts.filter((t) => !t.closest("[data-discreet-hide]")),
  };
}

describe("charts in discreet mode", () => {
  it("globals.css hides what charts mark with data-discreet-hide", () => {
    expect(HIDE_RULE).toMatch(/visibility:\s*hidden/);
  });

  it("hides the weekly load y-axis values but keeps the x-axis dates and bars", async () => {
    const { container } = render(<WeeklyLoadChart load={LOAD} />);
    const { values, others } = await chartTexts(container);

    expect(values.length).toBeGreaterThan(0);
    for (const t of values) expect(t.textContent).toMatch(/^[\d,]+$/); // e.g. "3,000"
    for (const t of values) expect(t).toBeVisible();

    document.documentElement.setAttribute("data-discreet", "");
    for (const t of values) expect(t).not.toBeVisible();
    // The chart keeps its shape: dates and bars stay visible.
    expect(others.length).toBeGreaterThan(0);
    for (const t of others) {
      expect(t.textContent).toMatch(/[A-Za-z]{3}/); // a date such as "2 Nov", never a number
      expect(t).toBeVisible();
    }
    const bars = [...container.querySelectorAll(".recharts-bar path")];
    expect(bars.length, container.querySelector("svg")?.innerHTML.slice(0, 600)).toBeGreaterThan(0);
    for (const b of bars) expect(b).toBeVisible();
  });

  it("hides the pace y-axis values", async () => {
    const rows = [
      { label: "26 Oct", pace: 5.5, runs: 2 },
      { label: "2 Nov", pace: 5.2, runs: 3 },
    ];
    const { container } = render(<PaceChart rows={rows} />);
    const { values, others } = await chartTexts(container);
    expect(values.length).toBeGreaterThan(0);
    for (const t of values) expect(t.textContent).toMatch(/^\d+:\d{2}$/); // e.g. "5:30"
    document.documentElement.setAttribute("data-discreet", "");
    for (const t of values) expect(t).not.toBeVisible();
    for (const t of others) expect(t.textContent).not.toMatch(/^\d+:\d{2}$/);
  });
});
