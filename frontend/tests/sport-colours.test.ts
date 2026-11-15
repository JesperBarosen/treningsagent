// #58 (design-visual V-M2): chart colours for running, climbing and a reserved
// third sport (strength), in that fixed order. The same checks as the dataviz
// palette validator: ΔE ×100 >= 15 for normal vision, >= 8 for protan and
// deutan, and 3:1 on the surface, for every pair in both themes.
import { describe, expect, it } from "vitest";
import { deltaE } from "./colour-check";
import { ratio, THEMES, tokens } from "./token-utils";

const SERIES = ["chart-run", "chart-climb", "chart-strength"];
const PAIRS = [[0, 1], [1, 2], [0, 2]].map(([a, b]) => [SERIES[a], SERIES[b]] as const);

describe("sport chart colours (#58)", () => {
  for (const [name, selector] of Object.entries(THEMES)) {
    const t = tokens(selector);

    it.each(PAIRS)(`${name}: %s and %s stay apart`, (a, b) => {
      expect(deltaE(t[a], t[b])).toBeGreaterThanOrEqual(15);
      expect(deltaE(t[a], t[b], "protan")).toBeGreaterThanOrEqual(8);
      expect(deltaE(t[a], t[b], "deutan")).toBeGreaterThanOrEqual(8);
    });

    it.each(SERIES)(`${name}: %s is at least 3:1 on the surface`, (series) => {
      expect(ratio(t[series], t.surface)).toBeGreaterThanOrEqual(3);
    });
  }
});
