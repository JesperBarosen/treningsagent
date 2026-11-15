// #83: the active goal as one line in Coach's "This week" glance, linking to
// the goal on the Dashboard.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal, GradeGoal, PaceGoal, TrainingLoad } from "@/lib/api";

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: "done" }, error: null }) }) }),
      upsert: vi.fn(),
      insert: vi.fn(),
    }),
  }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ getTrainingLoad: vi.fn(), getGoals: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

const { coachGoal, GoalLine, GoalsSection, timeLeft } = await import("@/components/goals-panel");
const { WeekGlance } = await import("@/components/week-glance");

const base = { status: "active" as const, achieved_on: null, created_on: "2026-11-01", overdue: false };
const RED: GradeGoal = {
  ...base, id: 1, kind: "climb_grade", grade: "red", climb_mode: "send", target_date: "2027-03-01",
  progress: { steps: 4, of: 5, best_grade: "purple", best_count_28d: 3, reached_on: null },
};
const PACE: PaceGoal = {
  ...base, id: 2, kind: "run_pace", band: "7_to_15km", target_pace: 5, start_pace: 5.5, target_date: "2026-12-06",
  progress: { start_pace: 5.5, now_pace: 5.2, target_pace: 5, fraction: 0.6, reached_on: null },
};
const TODAY = new Date(2026, 10, 15); // 15 Nov 2026

const load = (history_days = 30): TrainingLoad => ({
  daily: [],
  weekly: [
    { week_start: "2026-11-02", load: 900, sessions: 3, load_by_sport: {} },
    { week_start: "2026-11-09", load: 300, sessions: 1, load_by_sport: {} },
  ],
  acute_7d_avg: 40, chronic_28d_avg: 50, acute_chronic_ratio: 0.8, ratio_status: "ok", history_days,
} as TrainingLoad);

beforeEach(() => {
  vi.clearAllMocks();
  api.getTrainingLoad.mockResolvedValue(load());
  api.getGoals.mockResolvedValue([RED, PACE]);
});

describe("which goal Coach shows", () => {
  it("picks the active, unreached goal with the nearest date, then the oldest", () => {
    expect(coachGoal([RED, PACE])?.id).toBe(2);
    expect(coachGoal([{ ...RED, target_date: null }, { ...PACE, target_date: null }])?.id).toBe(1);
    expect(coachGoal([{ ...PACE, status: "paused" }, RED])?.id).toBe(1);
    const reached = { ...PACE, progress: { ...PACE.progress, reached_on: "2026-11-10" } };
    expect(coachGoal([reached, RED])?.id).toBe(1);
    expect(coachGoal([{ ...RED, status: "dropped" } as Goal])).toBeNull();
    expect(coachGoal([])).toBeNull();
  });

  it("says how long is left in days, then weeks", () => {
    expect(timeLeft(null, TODAY)).toBeNull();
    expect(timeLeft("2026-11-15", TODAY)).toBe("due today");
    expect(timeLeft("2026-11-16", TODAY)).toBe("1 day left");
    expect(timeLeft("2026-11-28", TODAY)).toBe("13 days left");
    expect(timeLeft("2026-12-06", TODAY)).toBe("3 weeks left");
    expect(timeLeft("2026-11-14", TODAY)).toBe("date passed");
  });
});

describe("the goal line", () => {
  it("is one line linking to the goal on the Dashboard, with the numbers discreet", () => {
    render(<GoalLine goal={PACE} today={TODAY} />);
    const link = screen.getByRole("link", { name: /Goal/ });
    expect(link).toHaveAttribute("href", "/dashboard#goal-2");
    expect(link).toHaveTextContent("Goal7–15 km at 5:00 /km · 3 weeks left");
    expect(link).toHaveClass("min-h-11");
    expect(screen.getByText(/7–15 km at 5:00/)).toHaveAttribute("data-sensitive");
  });

  it("takes no space without a goal", () => {
    const { container } = render(<GoalLine goal={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows in the This week glance under the week's numbers", async () => {
    render(<WeekGlance />);
    const link = await screen.findByRole("link", { name: /Goal/ });
    expect(link).toHaveAttribute("href", "/dashboard#goal-2");
    expect(screen.getByLabelText("This week so far")).toBeInTheDocument();
  });

  it("is left out when there is no active goal, and the week still shows", async () => {
    api.getGoals.mockResolvedValue([{ ...RED, status: "paused" }]);
    render(<WeekGlance />);
    expect(await screen.findByLabelText("This week so far")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Goal/ })).toBeNull();
  });

  it("doesn't take the week down with it when goals fail to load", async () => {
    api.getGoals.mockRejectedValue(new Error("offline"));
    render(<WeekGlance />);
    expect(await screen.findByLabelText("This week so far")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Goal/ })).toBeNull();
  });

  it("still shows before the first session, when there is no week yet", async () => {
    api.getTrainingLoad.mockResolvedValue(load(0));
    render(<WeekGlance />);
    expect(await screen.findByRole("link", { name: /Goal/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("This week so far")).toBeNull();
  });
});

describe("the Dashboard end of the link", () => {
  it("gives each goal card an anchor and scrolls to the linked one", async () => {
    const scroll = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, "", "/dashboard#goal-2");
    render(<GoalsSection />);
    const card = await screen.findByRole("listitem", { name: /7–15 km/ });
    expect(card).toHaveAttribute("id", "goal-2");
    expect(scroll).toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });
});
