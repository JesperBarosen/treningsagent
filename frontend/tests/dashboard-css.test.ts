// @vitest-environment node
// #59: the phone-only collapsing of Dashboard cards relies on classes that
// jsdom can't apply, so check they exist after Tailwind compiles globals.css
// (compiled in memory, the file is only read).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { expect, it } from "vitest";

const root = join(__dirname, "..");
const from = join(root, "app", "globals.css");

/** The rule for `selector` and the @media query it is grouped under. */
function rule(css: string, selector: string) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return { body: "", media: "" };
  const media = [...css.slice(0, at).matchAll(/@media ([^{]+)\{/g)].at(-1)?.[1].trim() ?? "";
  return { body: css.slice(at, css.indexOf("}", at)), media };
}

it("compiles the classes that collapse cards below 768 px and keep the grid from md", async () => {
  const out = (await postcss([tailwindcss({ base: root })]).process(readFileSync(from, "utf8"), { from })).css;

  // Collapsed bodies hide only below md (48rem = 768 px)...
  const below = rule(out, ".max-md\\:hidden");
  expect(below.body).toMatch(/display:\s*none/);
  expect(below.media).toBe("(width < 48rem)");

  // ...and the summary, row chips and row toggles hide from md.
  const from768 = rule(out, ".md\\:hidden");
  expect(from768.body).toMatch(/display:\s*none/);
  expect(from768.media).toBe("(width >= 48rem)");

  // The row's tap target is 60 px tall (at least 44).
  expect(rule(out, ".h-15").body).toMatch(/height:\s*calc\(var\(--spacing\) \* 15\)/);
}, 60_000);
