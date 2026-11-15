// #61 (design-visual V-L1): a colour-blind friendly chart palette and the
// Dashboard density, chosen on the Account page and saved per device.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChartSettings } from "@/app/account/chart-settings";
import {
  CHART_PREFS_SCRIPT,
  DENSITY_KEY,
  PALETTE_KEY,
  PALETTE_PREVIEW,
  readDensity,
  readPalette,
  saveDensity,
  savePalette,
} from "@/lib/chart-prefs";
import { deltaE } from "./colour-check";
import { ratio, THEMES, tokens } from "./token-utils";

const CVD = {
  light: ':root[data-chart-palette="cvd"]',
  dark: ':root[data-chart-palette="cvd"][data-theme="dark"]',
  "dark (OS)": ':root[data-chart-palette="cvd"]:not([data-theme="light"])',
} as const;
const SERIES = ["chart-run", "chart-climb", "chart-strength"];
const PAIRS = [[0, 1], [1, 2], [0, 2]].map(([a, b]) => [SERIES[a], SERIES[b]]);
const VISIONS = ["protan", "deutan", "tritan"] as const;
const worstCvd = (t: Record<string, string>) =>
  Math.min(...PAIRS.flatMap(([a, b]) => VISIONS.map((v) => deltaE(t[a], t[b], v))));

describe("colour-blind friendly palette in globals.css", () => {
  for (const theme of Object.keys(THEMES) as (keyof typeof THEMES)[]) {
    const base = tokens(THEMES[theme]);
    const t = { ...base, ...tokens(CVD[theme]) };

    it(`${theme}: every pair is apart for normal vision and all three deficiencies`, () => {
      for (const [a, b] of PAIRS) {
        expect(deltaE(t[a], t[b]), `${a}/${b} normal`).toBeGreaterThanOrEqual(15);
        for (const v of VISIONS) expect(deltaE(t[a], t[b], v), `${a}/${b} ${v}`).toBeGreaterThanOrEqual(8);
      }
    });

    it(`${theme}: every series is at least 3:1 on the surface`, () => {
      for (const s of SERIES) expect(ratio(t[s], t.surface), s).toBeGreaterThanOrEqual(3);
    });

    it(`${theme}: separates colour-blind vision better than the standard palette`, () => {
      expect(worstCvd(t)).toBeGreaterThan(worstCvd(base) + 5);
    });
  }

  it("uses the same values for explicit dark and OS dark", () => {
    expect(tokens(CVD["dark (OS)"])).toEqual(tokens(CVD.dark));
  });

  it("keeps the Account page previews equal to the tokens", () => {
    const pick = (t: Record<string, string>) => [t["chart-run"], t["chart-climb"]];
    expect(PALETTE_PREVIEW.standard).toEqual({ light: pick(tokens(THEMES.light)), dark: pick(tokens(THEMES.dark)) });
    expect(PALETTE_PREVIEW.cvd).toEqual({ light: pick(tokens(CVD.light)), dark: pick(tokens(CVD.dark)) });
  });
});

describe("chart preferences", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => document.documentElement.removeAttribute("data-chart-palette"));

  it("defaults to the standard palette and summary first, storing nothing", () => {
    expect(readPalette()).toBe("standard");
    expect(readDensity()).toBe("summary");
    localStorage.setItem(PALETTE_KEY, "rainbow");
    localStorage.setItem(DENSITY_KEY, "huge");
    expect(readPalette()).toBe("standard");
    expect(readDensity()).toBe("summary");
  });

  it("saves the palette and sets it on <html>, and clears both for the default", () => {
    savePalette("cvd");
    expect(localStorage.getItem(PALETTE_KEY)).toBe("cvd");
    expect(document.documentElement).toHaveAttribute("data-chart-palette", "cvd");
    savePalette("standard");
    expect(localStorage.getItem(PALETTE_KEY)).toBeNull();
    expect(document.documentElement).not.toHaveAttribute("data-chart-palette");
  });

  it("saves the density", () => {
    saveDensity("full");
    expect(readDensity()).toBe("full");
    saveDensity("summary");
    expect(localStorage.getItem(DENSITY_KEY)).toBeNull();
  });

  it("applies a saved palette before the first paint", () => {
    localStorage.setItem(PALETTE_KEY, "cvd");
    new Function(CHART_PREFS_SCRIPT)();
    expect(document.documentElement).toHaveAttribute("data-chart-palette", "cvd");
  });

  it("lets people pick both on the Account page", async () => {
    const user = userEvent.setup();
    render(<ChartSettings />);
    expect(screen.getByRole("radio", { name: /^Standard/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Summary first/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /^Colour-blind friendly/ }));
    await user.click(screen.getByRole("radio", { name: /^Everything open/ }));
    expect(screen.getByRole("radio", { name: /^Colour-blind friendly/ })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-chart-palette", "cvd");
    expect(readDensity()).toBe("full");
    expect(screen.getByRole("group", { name: "Chart colours" })).toBeInTheDocument();
  });
});
