import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadRows, loadSports } from "@/app/dashboard/charts";
import { SportBadge } from "@/components/icons";
import { SessionForm } from "@/components/session-form";
import type { TrainingLoad } from "@/lib/api";
import { sportName } from "@/lib/format";
import { readSportFilter, SPORT_FILTER_KEY, SPORT_FILTERS } from "@/lib/sport-filter";

// Strength and Other as built-in sports (#100, closes #27).

const load = (byWeek: Partial<Record<string, number>>[]): TrainingLoad =>
  ({
    weekly: byWeek.map((by, i) => ({
      week_start: `2026-11-0${i + 2}`,
      load: Object.values(by).reduce((a, b) => (a ?? 0) + (b ?? 0), 0),
      sessions: 1,
      load_by_sport: by,
    })),
  }) as unknown as TrainingLoad;

describe("Strength and Other", () => {
  it("stack after running and climbing, only when they have load", () => {
    expect(loadSports(load([{ running: 100 }]))).toEqual(["running", "climbing"]);
    expect(loadSports(load([{ running: 100 }, { other: 30, strength: 200 }]))).toEqual([
      "running",
      "climbing",
      "strength",
      "other",
    ]);
    expect(loadSports(load([{ running: 100 }]), ["strength"])).toEqual(["strength"]);
    const [row] = loadRows(load([{ strength: 420, other: 90 }]));
    expect([row.strength, row.other, row.running, row.total]).toEqual([420, 90, 0, 510]);
  });

  it("are in the filters and are remembered", () => {
    expect(SPORT_FILTERS).toEqual(["all", "running", "climbing", "strength", "other"]);
    localStorage.setItem(SPORT_FILTER_KEY, "strength");
    expect(readSportFilter()).toBe("strength");
    localStorage.setItem(SPORT_FILTER_KEY, "yoga");
    expect(readSportFilter()).toBe("all");
    localStorage.removeItem(SPORT_FILTER_KEY);
  });

  it("have names, badges and a Log form with the core fields only", () => {
    expect(sportName({ sport: "strength" })).toBe("Strength");
    expect(sportName({ sport: "other" })).toBe("Other");
    const { container } = render(<SportBadge sport="strength" />);
    expect(container.firstChild).toHaveClass("text-chart-strength");

    render(<SessionForm onSubmit={async () => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Strength" }));
    expect(screen.getByLabelText("Duration (min)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Distance (km)")).toBeNull();
    expect(screen.queryByRole("group", { name: "Tap a grade to add a climb" })).toBeNull();
  });
});
