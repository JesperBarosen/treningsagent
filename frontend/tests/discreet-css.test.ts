// @vitest-environment node
// Compiles app/globals.css with the same Tailwind plugin the app uses and checks
// that the discreet-mode rules survive into the output. tests/discreet.test.tsx
// only reads the source file; this catches rules dropped or rewritten by the
// build, or a later rule that turns the blur off.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss, { type Rule } from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const from = join(root, "app", "globals.css");
const source = readFileSync(from, "utf8");

/** Compile CSS text as if it were app/globals.css. Never writes the file: a
 *  running dev server would serve whatever it last compiled from disk. */
async function compile(css: string) {
  return (await postcss([tailwindcss({ base: root })]).process(css, { from })).root;
}

/** The compiled text of the [data-sensitive] blur rule, or null if missing. */
function blurRuleText(css: postcss.Root): string | null {
  let text: string | null = null;
  css.walkRules((rule) => {
    if (rule.selectors.some((s) => s.replace(/\s+/g, " ") === ":root[data-discreet] [data-sensitive]")) {
      text = rule.toString();
    }
  });
  return text;
}

let compiled: postcss.Root;

beforeAll(async () => {
  compiled = await compile(source);
}, 60_000);

/** Every compiled rule whose selector list includes `selector`, with its layer. */
function rulesFor(selector: string) {
  const found: { rule: Rule; layer: string | null }[] = [];
  compiled.walkRules((rule) => {
    if (!rule.selectors.some((s) => s.replace(/\s+/g, " ") === selector)) return;
    const layer = rule.parent?.type === "atrule" ? (rule.parent as postcss.AtRule).params : null;
    found.push({ rule, layer });
  });
  return found;
}

const decl = (rule: Rule, prop: string) => {
  let value: string | undefined;
  rule.walkDecls(prop, (d) => {
    value = d.value + (d.important ? " !important" : "");
  });
  return value;
};

describe("discreet mode in the compiled CSS", () => {
  it("blurs sensitive content under html[data-discreet]", () => {
    const [hit, ...more] = rulesFor(":root[data-discreet] [data-sensitive]");
    expect(hit, "the blur rule is missing from the compiled CSS").toBeDefined();
    expect(more).toHaveLength(0);
    expect(decl(hit.rule, "filter")).toBe("blur(6px)");
    expect(hit.layer).toBe("base");
    // The served rule must contain the blur itself, not only the selector.
    expect(blurRuleText(compiled)).toContain("blur(");
  });

  it("would catch a blur dropped from the rule (checked in memory)", async () => {
    const withoutBlur = source.replace(/^\s*filter: blur\(6px\);\s*$/m, "");
    expect(withoutBlur).not.toBe(source); // the line exists to be removed
    const text = blurRuleText(await compile(withoutBlur));
    expect(text).not.toBeNull(); // the selector alone survives...
    expect(text).not.toContain("blur("); // ...which is exactly the bug seen in the browser
  }, 60_000);

  it("unblurs only revealed content", () => {
    const selectors = [
      ":root[data-discreet] [data-sensitive][data-revealed]",
      ":root[data-discreet] [data-revealed] [data-sensitive]",
    ];
    for (const s of selectors) {
      const [hit] = rulesFor(s);
      expect(hit, s).toBeDefined();
      expect(decl(hit.rule, "filter")).toBe("none");
    }
  });

  it("hides chart value labels and tooltips, by our own attribute", () => {
    const [hit] = rulesFor(":root[data-discreet] [data-discreet-hide]");
    expect(hit, "the hide rule is missing from the compiled CSS").toBeDefined();
    expect(decl(hit.rule, "visibility")).toBe("hidden");
    // Recharts' internal classes moved in v3 (tick labels are portaled out of
    // .recharts-yAxis), so no rule may depend on them.
    compiled.walkRules((rule) => {
      if (/data-discreet/.test(rule.selector)) expect(rule.selector).not.toMatch(/recharts/);
    });
  });

  it("has no other rule that sets filter on sensitive content", () => {
    // Any rule mentioning [data-sensitive] or [data-discreet] besides the ones
    // above, or an !important filter anywhere, could switch the blur off.
    const allowed = new Set([
      ":root[data-discreet] [data-sensitive]",
      ":root[data-discreet] [data-sensitive][data-revealed]",
      ":root[data-discreet] [data-revealed] [data-sensitive]",
    ]);
    compiled.walkDecls("filter", (d) => {
      const rule = d.parent as Rule;
      const touchesDiscreet = rule.selectors?.some((s) => /data-(sensitive|discreet|revealed)/.test(s));
      if (touchesDiscreet) {
        for (const s of rule.selectors) expect(allowed.has(s.replace(/\s+/g, " ")), s).toBe(true);
      }
      expect(d.important, `!important filter in ${rule.selector}`).toBe(false);
    });
  });
});
