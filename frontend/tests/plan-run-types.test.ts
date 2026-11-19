import { describe, expect, it } from "vitest";
import { targetText } from "@/lib/plans";

describe("run types in a plan's target (#147)", () => {
  it("names a strides session", () => {
    expect(targetText({ session_type: "strides", workout: "6 x 20 s strides", duration_min: 36, distance_km: 6 }))
      .toBe("Strides · 6 x 20 s strides · 36 min · 6 km");
  });
});
