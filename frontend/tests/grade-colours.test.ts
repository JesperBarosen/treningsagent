// #55 (design-visual V-S3): the grade colours, re-stepped for the screen.
// Distances are OKLab ΔE ×100 (tests/colour-check.ts). Targets: >= 15 for normal
// vision, >= 8 under colour-vision deficiency, as in docs/design-visual.md.
import { describe, expect, it } from "vitest";
import { deltaE } from "./colour-check";
import { css, ratio, THEMES, tokens } from "./token-utils";

const grade = (name: string, source = css) =>
  source.match(new RegExp(`--color-grade-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1].toLowerCase() ?? "";

describe("grade colours (#55)", () => {
  it("keep green and red apart for deuteranopia", () => {
    expect(deltaE(grade("green"), grade("red"), "deutan")).toBeGreaterThanOrEqual(8);
  });

  it("keep blue and purple apart for normal vision", () => {
    expect(deltaE(grade("blue"), grade("purple"))).toBeGreaterThanOrEqual(15);
  });

  it("would catch the old paint colours (in-memory copy)", () => {
    const old = css
      .replace(/--color-grade-green:\s*#[0-9a-f]{6}/i, "--color-grade-green: #2e9e5b")
      .replace(/--color-grade-purple:\s*#[0-9a-f]{6}/i, "--color-grade-purple: #7c4dc4")
      .replace(/--color-grade-red:\s*#[0-9a-f]{6}/i, "--color-grade-red: #d63a3a");
    expect(deltaE(grade("green", old), grade("red", old), "deutan")).toBeLessThan(8);
    expect(deltaE(grade("blue", old), grade("purple", old))).toBeLessThan(15);
  });

  it("every dot keeps a ring of at least 3:1 on the surface, light and dark", () => {
    for (const selector of Object.values(THEMES)) {
      const t = tokens(selector);
      expect(ratio(t["grade-ring"], t.surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it("the darker re-stepped dots stand out on the dark surface by themselves too", () => {
    const dark = tokens(THEMES.dark);
    for (const name of ["red", "purple", "blue"]) {
      expect(ratio(grade(name), dark.surface), name).toBeGreaterThanOrEqual(3);
    }
  });
});
