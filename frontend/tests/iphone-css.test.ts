// @vitest-environment node
// iPhone fixes that jsdom can't lay out, so check the compiled CSS (globals.css
// is compiled in memory, the file is only read).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const from = join(root, "app", "globals.css");
let css = "";

beforeAll(async () => {
  css = (await postcss([tailwindcss({ base: root })]).process(readFileSync(from, "utf8"), { from })).css;
});

/** The body of the first rule for `selector` that contains `needle`, and the @media it is under. */
function rule(selector: string, needle = "") {
  let at = css.indexOf(`${selector} {`);
  while (at >= 0) {
    const body = css.slice(at, css.indexOf("}", at));
    if (body.includes(needle)) {
      const media = [...css.slice(0, at).matchAll(/@media ([^{]+)\{/g)].at(-1)?.[1].trim() ?? "";
      return { body, media };
    }
    at = css.indexOf(`${selector} {`, at + 1);
  }
  return { body: "", media: "" };
}

describe("tab bar room", () => {
  it("pads <main> by the tab bar's height plus the safe area, and drops it from md", () => {
    expect(rule(".pb-tab-bar").body).toMatch(
      /padding-bottom:\s*calc\(var\(--tab-bar-h\) \+ env\(safe-area-inset-bottom\)\)/,
    );
    const md = rule(String.raw`.md\:pb-0`);
    expect(md.body).toMatch(/padding-bottom:\s*0(px)?;/);
    expect(md.media).toBe("(width >= 48rem)");
  });

  it("puts the Coach composer right on top of the tab bar, safe area included", () => {
    expect(rule(".bottom-tab-bar").body).toMatch(
      /bottom:\s*calc\(var\(--tab-bar-h\) \+ env\(safe-area-inset-bottom\)\)/,
    );
  });

  it("sizes the tab bar's row from the same token", () => {
    expect(rule(":root", "--tab-bar-h").body).toMatch(/--tab-bar-h:\s*3\.5rem/);
    expect(rule(String.raw`.h-\(--tab-bar-h\)`).body).toMatch(/height:\s*var\(--tab-bar-h\)/);
  });
});

describe("date field on iOS", () => {
  it("drops the native look so min-height and padding apply", () => {
    const body = rule('input[type="date"]', "appearance").body;
    expect(body).toMatch(/-webkit-appearance:\s*none/);
    expect(body).toMatch(/(^|[^-])appearance:\s*none/);
    // Height and line-height belong to utilities on the input; in the base
    // layer, text-base's line-height would beat them.
    expect(body).not.toMatch(/(^|[\s;{])(height|line-height):/);
  });

  it("aligns the value left like the other fields", () => {
    const body = rule('input[type="date"]::-webkit-date-and-time-value').body;
    expect(body).toMatch(/text-align:\s*left/);
    expect(body).toMatch(/margin:\s*0/);
  });

  it("centres the value with a line-height utility that overrides text-base", () => {
    expect(rule(".h-11").body).toMatch(/height:\s*calc\(var\(--spacing\) \* 11\)/);
    const leading = rule(String.raw`.leading-\[calc\(2\.75rem-2px\)\]`).body;
    expect(leading).toMatch(/line-height:\s*calc\(2\.75rem - 2px\)/);
    // text-base's line-height yields to --tw-leading, which the utility sets.
    expect(leading).toMatch(/--tw-leading:\s*calc\(2\.75rem - 2px\)/);
    expect(rule(".text-base").body).toMatch(/line-height:\s*var\(--tw-leading,/);
  });

  it("compiles the shrinkable two-column grid", () => {
    expect(rule(String.raw`.grid-cols-\[minmax\(0\,1fr\)_minmax\(0\,1fr\)\]`).body).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\)/,
    );
  });
});
