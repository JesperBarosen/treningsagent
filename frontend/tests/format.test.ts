import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/api";
import { formatPace, groupByWeek, sessionSummary, weekLabel, weekStart } from "@/lib/format";

const run = (id: number, date: string): Session => ({
  id, sport: "running", date, duration_min: 50, effort: 6, distance_km: 10,
});

describe("format", () => {
  it("summarises a run like the chat card", () => {
    expect(sessionSummary(run(1, "2026-11-10"))).toBe("Run · 10 km · 50 min · effort 6");
  });

  it("formats pace as m:ss and carries rounded seconds", () => {
    expect(formatPace(5.25)).toBe("5:15");
    expect(formatPace(4.999)).toBe("5:00");
  });

  it("starts weeks on Monday", () => {
    expect(weekStart("2026-11-11")).toBe("2026-11-09"); // Wednesday
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday
  });

  it("groups by week, newest first", () => {
    const groups = groupByWeek([run(1, "2026-11-01"), run(2, "2026-11-10"), run(3, "2026-11-09")]);
    expect(groups.map((g) => g.weekStart)).toEqual(["2026-11-09", "2026-10-26"]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual([2, 3]);
  });

  it("labels this and last week", () => {
    const today = new Date(2026, 10, 11);
    expect(weekLabel("2026-11-09", today)).toBe("This week");
    expect(weekLabel("2026-11-02", today)).toBe("Last week");
    expect(weekLabel("2026-10-26", today)).toBe("Week of 26 Oct");
  });
});
