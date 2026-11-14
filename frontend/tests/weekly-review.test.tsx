import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Progression, TrainingLoad, Trend } from "@/lib/api";

const db = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    from: (table: string) =>
      table === "ui_events"
        ? { insert: db.insert }
        : {
            select: () => ({ eq: () => ({ maybeSingle: db.maybeSingle }) }),
            upsert: db.upsert,
          },
  }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ getTrainingLoad: vi.fn(), getProgression: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getTrainingLoad: api.getTrainingLoad,
  getProgression: api.getProgression,
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { buildWeekReview, coachSentence, lastWeekStart, weekRange, weeksAgo } = await import(
  "@/lib/week-review"
);
const { ReviewView, reviewedWeek } = await import("@/app/review/review-view");
const { WeekGlance } = await import("@/components/week-glance");

const TODAY = new Date(2026, 10, 18); // Wednesday 18 Nov 2026
const LAST = "2026-11-09";

const trend = (t: Trend["trend"]): Trend => ({
  recent: null,
  baseline: null,
  recent_sessions: 0,
  baseline_sessions: 0,
  trend: t,
});

function loadData(weeks: [string, number, number][]): TrainingLoad {
  return {
    daily: [],
    weekly: weeks.map(([week_start, sessions, load]) => ({ week_start, sessions, load, load_by_sport: {} })),
    acute_7d_avg: 0,
    chronic_28d_avg: 0,
    acute_chronic_ratio: null,
    ratio_status: "not_enough_data",
    history_days: 30,
  };
}

const LOAD = loadData([
  ["2026-11-02", 3, 1050],
  [LAST, 4, 1240],
  ["2026-11-16", 1, 300],
]);

const PROGRESSION = {
  weeks: 8,
  today: "2026-11-18",
  trend_rule: "",
  running: {
    last_session: null,
    days_since_last_session: null,
    sessions: 2,
    weekly: [
      {
        week_start: LAST,
        runs: 2,
        distance_km: 16,
        duration_min: 80,
        pace_min_per_km: 5,
        pace_by_distance: { "7_to_15km": { runs: 2, pace_min_per_km: 5.0333 } },
      },
    ],
    trends: {
      distance_km_per_week: trend("flat"),
      duration_min_per_week: trend("flat"),
      pace_min_per_km: trend("flat"),
      pace_by_distance: { under_7km: trend("not enough data"), "7_to_15km": trend("flat"), over_15km: trend("not enough data") },
    },
  },
  climbing: {
    last_session: null,
    days_since_last_session: null,
    sessions: 2,
    grade_scale: [],
    weekly: [
      { week_start: LAST, sessions: 2, climbs: 8, hardest_sent: "purple", flash_grade: "blue", send_rate_by_grade: {} },
    ],
    trends: {
      climbs_per_week: trend("flat"),
      avg_session_hardest_sent: { ...trend("improving"), recent_grade: "purple", baseline_grade: "blue" },
      avg_session_flash_grade: { ...trend("flat"), recent_grade: null, baseline_grade: null },
      send_rate_by_grade: {},
    },
  },
} as unknown as Progression;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); // only the clock; timers stay real
  vi.setSystemTime(TODAY);
  vi.clearAllMocks();
  db.maybeSingle.mockResolvedValue({ data: null, error: null });
  db.upsert.mockResolvedValue({ error: null });
  db.insert.mockResolvedValue({ error: null });
  api.getTrainingLoad.mockResolvedValue(LOAD);
  api.getProgression.mockResolvedValue(PROGRESSION);
});

describe("week helpers", () => {
  it("finds last week's Monday and words the range", () => {
    expect(lastWeekStart(TODAY)).toBe(LAST);
    expect(lastWeekStart(new Date(2026, 10, 16))).toBe(LAST); // on a Monday
    expect(weekRange(LAST)).toBe("9–15 Nov");
    expect(weekRange("2026-10-26")).toBe("26 Oct – 1 Nov");
    expect(weeksAgo(LAST, TODAY)).toBe(1);
  });

  it("only reviews a finished week's Monday from ?week=, else last week", () => {
    expect(reviewedWeek("2026-11-02", TODAY)).toBe("2026-11-02");
    for (const bad of [undefined, "2026-11-03", "2026-11-16", "2025-01-06", "nonsense"]) {
      expect(reviewedWeek(bad, TODAY)).toBe(LAST);
    }
  });
});

describe("buildWeekReview", () => {
  it("picks the week, the week before, the hardest send and the most-run band", () => {
    const r = buildWeekReview(LOAD, PROGRESSION, LAST)!;
    expect(r).toMatchObject({
      sessions: 4,
      load: 1240,
      prevSessions: 3,
      prevLoad: 1050,
      runs: 2,
      climbingSessions: 2,
      hardestSent: "purple",
      hardestSentTrend: "improving",
      pace: { band: "7_to_15km", trend: "flat" },
    });
    expect(r.sentence).toBe(
      "More training than the week before. Your hardest send was purple, and your pace held steady.",
    );
  });

  it("is null for a week the data doesn't cover", () => {
    expect(buildWeekReview(LOAD, PROGRESSION, "2026-10-05")).toBeNull();
  });
});

describe("coachSentence", () => {
  const base = {
    weekStart: LAST,
    sessions: 3,
    load: 900,
    prevSessions: 3,
    prevLoad: 1000,
    runs: 3,
    climbingSessions: 0,
    hardestSent: null,
    hardestSentTrend: "not enough data" as const,
    pace: null,
  };
  it("never calls a week failed and leaves out what it can't say", () => {
    expect(coachSentence(base)).toBe("About the same load as the week before.");
    expect(coachSentence({ ...base, load: 500 })).toBe("A lighter week than the one before.");
    expect(coachSentence({ ...base, sessions: 0, load: 0 })).toMatch(/fresh week/);
    const words = [base, { ...base, load: 500 }, { ...base, sessions: 0, load: 0 }].map(coachSentence).join(" ");
    expect(words).not.toMatch(/fail|bad|worse|missed/i);
  });
});

describe("the review page", () => {
  it("shows the week, records that it was opened, and saves the note on Done", async () => {
    const user = userEvent.setup();
    render(<ReviewView week={LAST} />);
    expect(await screen.findByText("1,240")).toBeInTheDocument();
    expect(screen.getByText("1,050 the week before")).toBeInTheDocument();
    expect(screen.getByText(/Your hardest send was purple/)).toBeInTheDocument();
    expect(db.insert).toHaveBeenCalledWith({ event: "weekly_review_opened" });

    await user.type(screen.getByLabelText("Note for next week"), "rest fingers Wednesday");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ week_start: LAST, status: "done", note: "rest fingers Wednesday" }),
      { onConflict: "user_id,week_start" },
    );
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("can be skipped", async () => {
    const user = userEvent.setup();
    render(<ReviewView week={LAST} />);
    await user.click(await screen.findByRole("button", { name: "Skip" }));
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", note: null }),
      expect.anything(),
    );
  });

  it("keeps the page and says so when saving fails", async () => {
    db.upsert.mockResolvedValue({ error: { message: "relation does not exist" } });
    const user = userEvent.setup();
    render(<ReviewView week={LAST} />);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your review");
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("the Coach glance", () => {
  beforeEach(() => {
    api.getTrainingLoad.mockResolvedValue(loadData([[LAST, 4, 1240], ["2026-11-16", 1, 300]]));
  });

  it("shows this week so far and a Your week card until last week is reviewed", async () => {
    render(<WeekGlance />);
    expect(await screen.findByRole("heading", { name: /Your week/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Look back/ })).toHaveAttribute("href", "/review");
    expect(screen.getByLabelText("This week so far")).toHaveTextContent("1 session · load 300");
    expect(screen.getByLabelText("This week so far")).toHaveTextContent("last week 1,240");
  });

  it("hides the card once the week is reviewed", async () => {
    db.maybeSingle.mockResolvedValue({ data: { status: "done", note: null }, error: null });
    render(<WeekGlance />);
    expect(await screen.findByLabelText("This week so far")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Your week/ })).not.toBeInTheDocument();
  });

  it("goes quiet after Skip", async () => {
    const user = userEvent.setup();
    render(<WeekGlance />);
    await user.click(await screen.findByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("heading", { name: /Your week/ })).not.toBeInTheDocument();
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped" }),
      expect.anything(),
    );
  });

  it("shows nothing when the numbers can't be loaded", async () => {
    api.getTrainingLoad.mockRejectedValue(new Error("offline"));
    const { container } = render(<WeekGlance />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
