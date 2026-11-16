// The Log form's instant checks against the server's own cases (#101):
// backend/tests/fixtures/forms.json is also run by backend/tests/test_templates.py.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Template } from "@/lib/api";
import { checkValues, cleanValues } from "@/lib/form-values";

type Case = { name: string; values: Record<string, unknown>; error?: string };
const fixture = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "backend", "tests", "fixtures", "forms.json"), "utf8"),
) as { template: Template; valid: Case[]; invalid: Case[] };

describe("template values, shared with the backend", () => {
  it.each(fixture.valid.map((c) => [c.name, c] as const))("accepts: %s", (_, c) => {
    expect(checkValues(fixture.template, c.values)).toBeNull();
  });

  it.each(fixture.invalid.map((c) => [c.name, c] as const))("refuses: %s", (_, c) => {
    expect(checkValues(fixture.template, c.values)).not.toBeNull();
  });

  it("uses the server's wording for the common cases", () => {
    const bad = fixture.invalid.find((c) => c.name === "extra column out of range")!;
    expect(checkValues(fixture.template, bad.values)).toContain(bad.error);
  });

  it("lets an edit keep an archived option", () => {
    const old = { hangs: [{ sets: 1, reps: 1 }], protocol: "density" };
    expect(checkValues(fixture.template, old, old)).toBeNull();
  });

  it("leaves empty answers out", () => {
    expect(cleanValues({ a: 1, b: "", c: null, d: [], e: false })).toEqual({ a: 1, e: false });
  });
});
