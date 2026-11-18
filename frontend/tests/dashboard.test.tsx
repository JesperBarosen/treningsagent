import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { Dashboard } from "@/app/dashboard/dashboard-view";
import type { Progression, TrainingLoad, Trend } from "@/lib/api";
import { mainPaceBand, ratioGap, ratioView, summarySentence, trendGap } from "@/lib/dashboard";

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

describe("trendGap and ratioGap (#126)", () => {
  const runs = { none: "runs", count: "runs" };
  const gap = (recent_sessions: number, baseline_sessions: number) =>
    trendGap({ ...trend("not enough data"), recent_sessions, baseline_sessions }, runs);

  it("names what a trend is missing, from the backend's counts", () => {
    expect(gap(2, 0)).toBe("No runs in the 4 weeks before to compare with");
    expect(gap(0, 4)).toBe("No runs in the last 2 weeks");
    expect(gap(0, 0)).toBe("No runs in the last 6 weeks");
    expect(gap(1, 5)).toBe("Trend after 3 recent runs · 1 so far");
    // Points on both sides, but too few before: no count to promise.
    expect(gap(4, 2)).toBe("Too early for a trend");
    expect(gap(2, 1)).toBe("Too early for a trend");
    expect(trendGap(trend("flat"), runs)).toBeNull();
  });

  it("never blames", () => {
    for (const [r, b] of [[2, 0], [0, 4], [0, 0], [1, 5], [4, 2]]) {
      expect(gap(r, b)).not.toMatch(/not enough|missed|failed|only|behind|you didn/i);
    }
  });

  it("says how far along the ratio is", () => {
    expect(ratioGap(0)).toEqual({ need: "Needs 4 weeks of sessions", sofar: null });
    expect(ratioGap(1).sofar).toBe("1 day so far");
    expect(ratioGap(6).sofar).toBe("6 days so far");
    expect(ratioGap(10).sofar).toBe("1 week so far");
    expect(ratioGap(21).sofar).toBe("3 weeks so far");
  });
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

  it("says what a young ratio still needs instead of showing it (#126)", () => {
    const young = load({ ratio_status: "not_enough_data", history_days: 10 });
    render(<Dashboard load={young} progression={progression()} />);
    const card = screen.getByRole("region", { name: "Acute:chronic ratio" });
    expect(within(card).getByText("Needs 4 weeks of sessions")).toBeInTheDocument();
    expect(within(card).getByText(/^1 week so far\./)).toBeInTheDocument();
    expect(within(card).queryByText("1.07")).toBeNull();
    expect(screen.queryByText(/Not enough data/i)).toBeNull();
  });

  it("says what each trend is missing, in words that stay readable in discreet mode (#126)", () => {
    const p = progression();
    // Runs only in the last 2 weeks: nothing to compare with.
    p.running.trends.pace_by_distance.under_7km = { ...trend("not enough data"), recent_sessions: 2, baseline_sessions: 0 };
    // Plenty before, one session with a send since.
    p.climbing.weekly = [
      { week_start: "2026-11-09", sessions: 1, climbs: 4, hardest_sent: "purple", flash_grade: null,
        hardest_sent_level: 4, flash_level: null, send_rate_by_grade: {} },
    ];
    p.climbing.trends.avg_session_hardest_sent = {
      ...trend("not enough data", 4.2, 3.4), recent_sessions: 1, baseline_sessions: 5, recent_grade: "purple", baseline_grade: "blue",
    };
    render(<Dashboard load={load()} progression={p} />);

    const pace = screen.getByRole("region", { name: "Running pace" });
    const band = within(pace).getByRole("region", { name: "Under 7 km" });
    const gap = within(band).getByText("No runs in the 4 weeks before to compare with");
    expect(gap).not.toHaveAttribute("data-sensitive");
    expect(gap.closest("[data-sensitive]")).toBeNull();
    expect(gap).not.toHaveClass("whitespace-nowrap"); // wraps at 375 px

    const grades = screen.getByRole("region", { name: "Hardest grades" });
    expect(within(grades).getAllByText("Trend after 3 recent sessions · 1 so far").length).toBeGreaterThan(0);
  });

  it("shows the backend's send rates and trend words per grade, easiest first", () => {
    render(<Dashboard load={load()} progression={progression()} />);
    const card = screen.getByRole("region", { name: "Send rate per grade" });
    const items = within(card).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "blueImprovingLast 2 wks90%4 wks before60%",
      "redToo early for a trendLast 2 wks25%4 wks before–",
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

// #59 (design-visual V-M3): summary first on phones, charts as rows.
describe("summary first on mobile", () => {
  it("builds one sentence from the backend's ratio zone and trend words only", () => {
    expect(summarySentence(load(), progression())).toBe(
      "Your load is in your usual range. Pace on 7–15 km runs is getting faster. Your hardest sends are going up.",
    );
  });

  it("leaves out what the backend has not enough data for", () => {
    const p = progression();
    p.running.trends.pace_by_distance["7_to_15km"] = trend("not enough data");
    p.running.trends.pace_by_distance.over_15km = trend("not enough data");
    p.climbing.trends.avg_session_hardest_sent.trend = "not enough data";
    const young = load({ ratio_status: "not_enough_data", history_days: 10 });
    expect(summarySentence(young, p)).toBe("Too early for trends. They show up here after a few weeks of sessions.");
    expect(summarySentence(load({ ratio_status: "paused" }), p)).toBe("Your load ratio is paused for your break.");
  });

  it("picks the pace band with the most recent runs for the row chip", () => {
    const p = progression();
    p.running.trends.pace_by_distance.over_15km = { ...trend("flat"), recent_sessions: 5 };
    expect(mainPaceBand(p.running)).toBe("over_15km");
    expect(mainPaceBand(progression().running)).toBe("7_to_15km");
  });

  it("shows three headline numbers, blurred in discreet mode", () => {
    render(<Dashboard load={load()} progression={progression()} />);
    const summary = screen.getByRole("region", { name: "Summary" });
    const numbers = within(summary).getAllByRole("definition").map((d) => d.textContent);
    // Sessions this week, with the average over the complete weeks (#46).
    expect(numbers).toEqual(["2", "4/wk avg", "400", "900 last wk", "1.07", "moderate"]);
    expect(summary.querySelector("dl")).toHaveAttribute("data-sensitive");
    expect(summary).toHaveClass("md:hidden");
  });

  it("starts each chart as a row on phones that opens in place", async () => {
    const user = userEvent.setup();
    render(<Dashboard load={load()} progression={progression()} />);
    const toggle = screen.getByRole("button", { name: "Hardest grades" });
    const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(body).toHaveClass("max-md:hidden");
    expect(toggle).toHaveClass("md:hidden"); // from 768 px the grid stays open
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(body).not.toHaveClass("max-md:hidden");
  });

  it("opens every chart and drops the summary with Everything open (#61)", async () => {
    localStorage.setItem("treningsagent.dashboardDensity", "full");
    try {
      const user = userEvent.setup();
      render(<Dashboard load={load()} progression={progression()} />);
      expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
      const toggle = screen.getByRole("button", { name: "Weekly load" });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      await user.click(toggle); // a tap still folds it
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    } finally {
      localStorage.clear();
    }
  });

  it("keeps the trend chip on the collapsed row", () => {
    render(<Dashboard load={load()} progression={progression()} />);
    const pace = screen.getByRole("region", { name: "Running pace" });
    const header = pace.firstElementChild as HTMLElement;
    expect(within(header).getByText("7–15 km")).toBeInTheDocument();
    expect(within(header).getByText("Improving")).toBeInTheDocument();
  });
});
