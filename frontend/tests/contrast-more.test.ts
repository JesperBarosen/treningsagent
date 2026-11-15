// #60 (design-visual V-M4): with the system's Increase Contrast setting
// (prefers-contrast: more), edges and dividers become real outlines and
// secondary text uses ink. Measured from globals.css, which is only read.
import { describe, expect, it } from "vitest";
import { css, ratio, THEMES, tokens } from "./token-utils";

const start = css.indexOf("@media (prefers-contrast: more) {");
const more = css.slice(start);
const darkStart = css.indexOf("@media (prefers-contrast: more) and (prefers-color-scheme: dark) {");

/** The base tokens of a theme with the higher-contrast overrides on top. */
function withMore(theme: keyof typeof THEMES) {
  const source = theme === "dark (OS)" ? css.slice(darkStart) : more;
  return { ...tokens(THEMES[theme]), ...tokens(THEMES[theme], source) };
}

describe("prefers-contrast: more (#60)", () => {
  it("has a light block, an explicit dark block and an OS dark block", () => {
    expect(start).toBeGreaterThan(0);
    expect(darkStart).toBeGreaterThan(start);
    // After the base dark blocks, so it wins over them at equal specificity.
    expect(start).toBeGreaterThan(css.lastIndexOf('[data-theme="light"]) {', start));
  });

  it("uses the same values for explicit dark and OS dark", () => {
    expect(tokens(THEMES["dark (OS)"], css.slice(darkStart))).toEqual(tokens(THEMES.dark, more));
  });

  for (const theme of Object.keys(THEMES) as (keyof typeof THEMES)[]) {
    const t = withMore(theme);

    it(`${theme}: outlines and dividers are at least 4.5:1 on canvas, surface, sunken and elevated`, () => {
      for (const bg of ["canvas", "surface", "sunken", "elevated"]) {
        expect(ratio(t.line, t[bg]), `line on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.control, t[bg]), `control on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: secondary text is ink`, () => {
      expect(t["ink-muted"]).toBe(tokens(THEMES[theme]).ink);
    });

    it(`${theme}: is stronger than the default edges`, () => {
      const base = tokens(THEMES[theme]);
      expect(ratio(t.control, t.surface)).toBeGreaterThan(ratio(base.control, base.surface));
      expect(ratio(t.line, t.surface)).toBeGreaterThan(ratio(base.line, base.surface));
    });
  }
});
