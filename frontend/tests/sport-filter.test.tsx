// #46: the Dashboard filter, All / Running / Climbing. All is the combined
// picture; a single sport shows only its own metrics. Remembered per device.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pause, Progression, TrainingLoad, Trend } from "@/lib/api";

const api = vi.hoisted(() => ({ getTrainingLoad: vi.fn(), getProgression: vi.fn(), getGoals: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

const { Dashboard, DashboardView } = await import("@/app/dashboard/dashboard-view");
const { sessionsPerWeek, summarySentence } = await import("@/lib/dashboard");
const { readSportFilter, saveSportFilter, SPORT_FILTER_KEY } = await import("@/lib/sport-filter");

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const load = (over: Partial<TrainingLoad> = {}): TrainingLoad => ({
  daily: [],
  weekly: [
    { week_start: "2026-10-26", load: 700, sessions: 3, load_by_sport: { running: 400, climbing: 300 } },
    { week_start: "2026-11-02", load: 900, sessions: 4, load_by_sport: { running: 600, climbing: 300 } },
    { week_start: "2026-11-09", load: 400, sessions: 2, load_by_sport: { running: 400 } },
  ],
  acute_7d_avg: 80, chronic_28d_avg: 75, acute_chronic_ratio: 1.07, ratio_status: "ok", history_days: 50,
  ...over,
});
const runOnly = (over: Partial<TrainingLoad> = {}) =>
  load({
    weekly: [
      { week_start: "2026-10-26", load: 400, sessions: 2, load_by_sport: { running: 400 } },
      { week_start: "2026-11-02", load: 600, sessions: 2, load_by_sport: { running: 600 } },
      { week_start: "2026-11-09", load: 400, sessions: 2, load_by_sport: { running: 400 } },
    ],
    acute_chronic_ratio: 1.4,
    ...over,
  });

const trend = (t: Trend["trend"]): Trend => ({ recent: null, baseline: null, recent_sessions: 3, baseline_sessions: 4, trend: t });
const progression = (runs = 6, climbs = 3): Progression =>
  ({
    weeks: 8, today: "2026-11-11", trend_rule: "",
    running: {
      last_session: "2026-11-10", days_since_last_session: 1, sessions: runs, weekly: [],
      trends: {
        distance_km_per_week: trend("flat"), duration_min_per_week: trend("flat"), pace_min_per_km: trend("improving"),
        pace_by_distance: { under_7km: trend("not enough data"), "7_to_15km": trend("improving"), over_15km: trend("not enough data") },
      },
    },
    climbing: {
      last_session: "2026-11-05", days_since_last_session: 6, sessions: climbs, grade_scale: ["green", "blue"], weekly: [],
      trends: {
        climbs_per_week: trend("flat"),
        avg_session_hardest_sent: { ...trend("improving"), recent_grade: "blue", baseline_grade: "green" },
        avg_session_flash_grade: { ...trend("flat"), recent_grade: null, baseline_grade: null },
        send_rate_by_grade: {},
      },
    },
  }) as unknown as Progression;

const BREAK: Pause = {
  id: 1, start_date: "2026-11-04", planned_end: null, ended_on: null, reason: "travel",
  body_part: null, pain: null, note: null, resume_choice: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.getTrainingLoad.mockResolvedValue(load());
  api.getProgression.mockResolvedValue(progression());
  api.getGoals.mockResolvedValue([]);
});

describe("the remembered choice", () => {
  it("defaults to All, keeps Running or Climbing, and stores nothing for All", () => {
    expect(readSportFilter()).toBe("all");
    saveSportFilter("climbing");
    expect(localStorage.getItem(SPORT_FILTER_KEY)).toBe("climbing");
    expect(readSportFilter()).toBe("climbing");
    saveSportFilter("all");
    expect(localStorage.getItem(SPORT_FILTER_KEY)).toBeNull();
    localStorage.setItem(SPORT_FILTER_KEY, "swimming");
    expect(readSportFilter()).toBe("all");
  });

  it("falls back to All when storage is blocked", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSportFilter()).toBe("all");
    get.mockRestore();
  });
});

describe("sessions per week", () => {
  it("averages the complete weeks, leaving out the partial current one", () => {
    expect(sessionsPerWeek(load())).toBe(3.5); // (3 + 4) / 2
  });

  it("leaves out weeks a break that is on has reached", () => {
    expect(sessionsPerWeek(load({ pause: BREAK }))).toBe(3); // the week of 2 Nov ends after 4 Nov
  });

  it("is null without a complete week", () => {
    expect(sessionsPerWeek(load({ weekly: load().weekly.slice(-1) }))).toBeNull();
  });
});

describe("the summary sentence", () => {
  it("All speaks of the combined load and both sports", () => {
    expect(summarySentence(load(), progression(), "all")).toBe(
      "Your load is in your usual range. Pace on 7–15 km runs is getting faster. Your hardest sends are going up.",
    );
  });

  it("a single sport speaks only of itself", () => {
    expect(summarySentence(runOnly(), progression(), "running")).toBe(
      "Your running load is higher than your recent usual. Pace on 7–15 km runs is getting faster.",
    );
    expect(summarySentence(load(), progression(), "climbing")).toBe(
      "Your climbing load is in your usual range. Your hardest sends are going up.",
    );
    expect(summarySentence(load({ ratio_status: "paused", pause: BREAK }), progression(), "climbing")).toBe(
      "Your climbing load ratio is paused for your break. Your hardest sends are going up.",
    );
  });
});

describe("the Dashboard per sport", () => {
  const cards = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

  it("All shows the combined load and ratio and both sports' cards", () => {
    render(<Dashboard load={load()} progression={progression()} sport="all" />);
    expect(cards()).toEqual(
      expect.arrayContaining(["Weekly load", "Acute:chronic ratio", "Running pace", "Hardest grades", "Send rate per grade"]),
    );
    expect(screen.getByText("Last 7 days vs last 28 days, all sports")).toBeInTheDocument();
    const assessment = screen.getByLabelText("Assessment");
    expect(assessment).toHaveTextContent("Your load is in your usual range.");
    expect(assessment).toHaveTextContent("Sessions: 3.5 a week on average.");
    expect(within(assessment).getByText(/3\.5 a week/)).toHaveAttribute("data-sensitive");
  });

  it("Running shows only running: its load, its ratio and pace", () => {
    render(<Dashboard load={runOnly()} progression={progression()} sport="running" />);
    expect(cards()).toContain("Weekly running load");
    expect(cards()).toContain("Running pace");
    expect(cards()).not.toContain("Hardest grades");
    expect(cards()).not.toContain("Send rate per grade");
    expect(screen.getByText("Minutes × effort (session RPE), running only")).toBeInTheDocument();
    expect(screen.getByText("Last 7 days vs last 28 days, running only")).toBeInTheDocument();
    const load = screen.getByRole("region", { name: "Weekly running load" });
    expect(within(load).queryByText("Climbing")).toBeNull();
    expect(within(load).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Week of", "Running", "Sessions"]);
  });

  it("Climbing shows only climbing", () => {
    render(<Dashboard load={load()} progression={progression()} sport="climbing" />);
    expect(cards()).toEqual(expect.arrayContaining(["Weekly climbing load", "Hardest grades", "Send rate per grade"]));
    expect(cards()).not.toContain("Running pace");
  });

  it("says so when the chosen sport has nothing logged", () => {
    const empty = load({ weekly: load().weekly.map((w) => ({ ...w, load: 0, sessions: 0, load_by_sport: {} })) });
    render(<Dashboard load={empty} progression={progression(6, 0)} sport="climbing" />);
    expect(screen.getByText("No climbing yet")).toBeInTheDocument();
    expect(screen.getByText(/Choose All to see everything/)).toBeInTheDocument();
  });

  it("respects a break on every filter, and keeps numbers discreet", () => {
    render(
      <Dashboard
        load={runOnly({ pause: BREAK, ratio_status: "paused", acute_chronic_ratio: null })}
        progression={progression()}
        sport="running"
      />,
    );
    expect(screen.getByRole("region", { name: "On a break" })).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(summary.querySelector("dl")).toHaveAttribute("data-sensitive");
    expect(summary).toHaveTextContent("Your running load ratio is paused for your break.");
  });
});

describe("the filter on the Dashboard page", () => {
  it("starts on All, loads the chosen sport only, and remembers it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DashboardView />);
    const filter = screen.getByRole("radiogroup", { name: "Show sport" });
    expect(within(filter).getAllByRole("radio").map((r) => r.textContent)).toEqual(["All", "Running", "Climbing"]);
    expect(within(filter).getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    for (const r of within(filter).getAllByRole("radio")) expect(r).toHaveClass("min-h-11");
    await screen.findByRole("heading", { name: "Weekly load" });
    expect(api.getTrainingLoad).toHaveBeenLastCalledWith(8, expect.anything(), undefined);

    api.getTrainingLoad.mockResolvedValue(runOnly());
    await user.click(within(filter).getByRole("radio", { name: "Running" }));
    expect(await screen.findByRole("heading", { name: "Weekly running load" })).toBeInTheDocument();
    expect(api.getTrainingLoad).toHaveBeenLastCalledWith(8, expect.anything(), "running");
    expect(localStorage.getItem(SPORT_FILTER_KEY)).toBe("running");
    unmount();

    // Next visit: Running again, fetched for running from the start.
    api.getTrainingLoad.mockClear();
    render(<DashboardView />);
    expect(screen.getByRole("radio", { name: "Running" })).toHaveAttribute("aria-checked", "true");
    await screen.findByRole("heading", { name: "Weekly running load" });
    expect(api.getTrainingLoad).toHaveBeenCalledWith(8, expect.anything(), "running");
  });
});
