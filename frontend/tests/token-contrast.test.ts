// WCAG 2.2 contrast for the colour tokens, measured from globals.css (read,
// never edited) for light, explicit dark and OS dark. Every visual change in
// docs/design-visual.md (#53-#61) must keep these passing; the targets above
// AA come from that document.
import { describe, expect, it } from "vitest";
import { css, ratio, THEMES, tokens } from "./token-utils";

// [foreground, background, minimum]. 7 for small secondary text (Apple HIG,
// design-visual V-S2), 4.5 for text (WCAG 1.4.3), 3 for edges (WCAG 1.4.11).
const PAIRS: [string, string, number][] = [
  ["ink", "canvas", 7], ["ink", "surface", 7], ["ink", "sunken", 7],
  ["ink-muted", "canvas", 7], ["ink-muted", "surface", 7], ["ink-muted", "sunken", 7],
  ["ink-muted", "accent-soft", 4.5], ["ink-muted", "danger-soft", 4.5], ["ink-muted", "climb-soft", 4.5],
  ["accent", "canvas", 4.5], ["accent", "surface", 4.5], ["accent", "accent-soft", 4.5],
  ["on-accent", "accent", 4.5],
  ["climb", "surface", 4.5], ["climb", "climb-soft", 4.5],
  ["danger", "surface", 4.5], ["danger", "danger-soft", 4.5],
  ["control", "canvas", 3], ["control", "surface", 3], ["control", "sunken", 3],
  ["grade-ring", "surface", 3],
  ["chart-run", "surface", 3], ["chart-climb", "surface", 3],
  ["chart-strength", "surface", 3], ["chart-other", "surface", 3],
  // Sheets, dialogs and the composer sit on --elevated (#57).
  ["ink", "elevated", 7], ["ink-muted", "elevated", 7], ["accent", "elevated", 4.5],
  ["danger", "elevated", 4.5], ["control", "elevated", 3],
];

describe("token contrast", () => {
  for (const [name, selector] of Object.entries(THEMES)) {
    const t = tokens(selector);
    it.each(PAIRS)(`${name}: %s on %s is at least %s:1`, (fg, bg, min) => {
      expect(t[fg], `--${fg}`).toBeDefined();
      expect(t[bg], `--${bg}`).toBeDefined();
      expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
    });
  }

  it("would catch the old muted greys (#54), checked on an in-memory copy", () => {
    const old = css.replace("--ink-muted: #434862", "--ink-muted: #5a6166");
    const t = tokens(":root", old);
    expect(ratio(t["ink-muted"], t.sunken)).toBeLessThan(7); // 5.23:1 before #54
  });

  it("keeps muted text visibly lighter than ink, so the hierarchy holds", () => {
    for (const selector of Object.values(THEMES)) {
      const t = tokens(selector);
      expect(ratio(t.ink, t.surface) - ratio(t["ink-muted"], t.surface)).toBeGreaterThan(3);
    }
  });

  it("steps the dark layers up in lightness: canvas, surface, elevated (#57)", () => {
    for (const selector of [THEMES.dark, THEMES["dark (OS)"]]) {
      const t = tokens(selector);
      expect(ratio(t.surface, t.canvas)).toBeGreaterThan(1.05);
      expect(ratio(t.elevated, t.canvas)).toBeGreaterThan(ratio(t.surface, t.canvas) + 0.05);
    }
  });
});
