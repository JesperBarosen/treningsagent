import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { Dashboard } from "@/app/dashboard/dashboard-view";
import type { Progression, TrainingLoad, Trend } from "@/lib/api";
import { ratioView } from "@/lib/dashboard";

beforeAll(() => {
  // Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/** `days` consecutive days ending 2026-11-11, with load from day `firstLoad` on. */
function daily(days: number, firstLoad: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(2026, 10, 11 - (days - 1 - i));
    return { date: d.toLocaleDateString("sv-SE"), load: i >= firstLoad ? 100 : 0 };
  });
}

const load = (over: Partial<TrainingLoad> = {}): TrainingLoad => ({
  daily: daily(50, 0),
  weekly: [
    { week_start: "2026-11-02", load: 900, sessions: 4, load_by_sport: { running: 600, climbing: 300 } },
    { week_start: "2026-11-09", load: 400, sessions: 2, load_by_sport: { running: 400 } },
  ],
  acute_7d_avg: 80,
  chronic_28d_avg: 75,
  acute_chronic_ratio: 1.07,
  ratio_status: "ok",
  history_days: 50,
  ...over,
});

const trend = (t: Trend["trend"], recent: number | null = null, baseline: number | null = null): Trend => ({
  recent, baseline, recent_sessions: 3, baseline_sessions: 4, trend: t,
});

const progression = (): Progression => ({
  weeks: 2,
  today: "2026-11-11",
  trend_rule: "",
  running: {
    last_session: "2026-11-10",
    days_since_last_session: 1,
    sessions: 3,
    weekly: [],
    trends: {
      distance_km_per_week: trend("flat"),
      duration_min_per_week: trend("flat"),
      pace_min_per_km: trend("improving", 5.3, 5.5),
      pace_by_distance: {
        under_7km: trend("not enough data"),
        "7_to_15km": trend("improving", 5.1, 5.35),
        over_15km: trend("flat", 5.7, 5.72),
      },
    },
  },
  climbing: {
    last_session: "2026-11-10",
    days_since_last_session: 1,
    sessions: 2,
    grade_scale: ["yellow", "green", "blue", "purple", "red", "black", "white"],
    weekly: [],
    trends: {
      climbs_per_week: trend("flat"),
      avg_session_hardest_sent: { ...trend("improving", 4.2, 3.4), recent_grade: "purple", baseline_grade: "blue" },
      avg_session_flash_grade: { ...trend("flat", 3, 3), recent_grade: "blue", baseline_grade: "blue" },
      send_rate_by_grade: {
        red: trend("not enough data", 0.25, null),
        blue: trend("improving", 0.9, 0.6),
      },
    },
  },
});

describe("ratioView", () => {
  it("shows the backend's ratio once about 4 weeks are logged", () => {
    expect(ratioView(load())).toEqual({ kind: "ok", ratio: 1.07, zone: "moderate" });
    expect(ratioView(load({ acute_chronic_ratio: 1.6 }))).toMatchObject({ zone: "spike" });
    expect(ratioView(load({ acute_chronic_ratio: 0.5 }))).toMatchObject({ zone: "below" });
  });

  it("follows the backend's ratio_status, whatever the ratio", () => {
    const l = load({ acute_chronic_ratio: 1.9, ratio_status: "not_enough_data", history_days: 20 });
    expect(ratioView(l)).toEqual({ kind: "not enough data", historyDays: 20 });
  });

  it("says not enough data when the backend has no ratio", () => {
    const l = load({ acute_chronic_ratio: null, ratio_status: "not_enough_data", history_days: 0 });
    expect(ratioView(l)).toEqual({
      kind: "not enough data",
      historyDays: 0,
    });
  });
});

describe("Dashboard", () => {
  it("labels the ratio as a rough guide", () => {
    render(<Dashboard load={load()} progression={progression()} />);
    const card = screen.getByRole("region", { name: "Acute:chronic ratio" });
    expect(within(card).getByText("Rough guide")).toBeInTheDocument();
    expect(within(card).getByText("1.07")).toBeInTheDocument();
  });

  it("shows not enough data instead of a young ratio", () => {
    const young = load({ ratio_status: "not_enough_data", history_days: 10 });
    render(<Dashboard load={young} progression={progression()} />);
    const card = screen.getByRole("region", { name: "Acute:chronic ratio" });
    expect(within(card).getByText("Not enough data")).toBeInTheDocument();
    expect(within(card).getByText(/You have 10 days so far/)).toBeInTheDocument();
    expect(within(card).queryByText("1.07")).toBeNull();
  });

  it("shows the backend's send rates and trend words per grade, easiest first", () => {
    render(<Dashboard load={load()} progression={progression()} />);
    const card = screen.getByRole("region", { name: "Send rate per grade" });
    const items = within(card).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "blueImprovingLast 2 wks90%4 wks before60%",
      "redNot enough dataLast 2 wks25%4 wks before–",
    ]);
  });

  it("shows an empty state when nothing is logged", () => {
    const empty = progression();
    empty.running.sessions = 0;
    empty.climbing.sessions = 0;
    render(
      <Dashboard
        load={load({ weekly: [{ week_start: "2026-11-09", load: 0, sessions: 0, load_by_sport: {} }] })}
        progression={empty}
      />,
    );
    expect(screen.getByText("Nothing to chart yet")).toBeInTheDocument();
  });
});
