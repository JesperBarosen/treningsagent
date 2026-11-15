// @vitest-environment node
// #56: the 13 px "meta" step must exist as a utility after Tailwind compiles
// globals.css (compiled in memory, the file is only read).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { expect, it } from "vitest";

const root = join(__dirname, "..");
const from = join(root, "app", "globals.css");

it("text-meta compiles to 13 px on an 18 px line, between xs (12) and sm (14)", async () => {
  const out = (await postcss([tailwindcss({ base: root })]).process(readFileSync(from, "utf8"), { from })).css;
  const rule = out.match(/\.text-meta\s*\{[^}]*\}/)?.[0] ?? "";
  expect(rule, "the .text-meta utility is missing").not.toBe("");
  expect(rule).toMatch(/font-size:\s*var\(--text-meta\)/);
  expect(out).toMatch(/--text-meta:\s*0?\.8125rem/);
  expect(out).toMatch(/--text-meta--line-height:\s*1\.125rem/);
}, 60_000);
