import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal, Plan, PlannedSession } from "@/lib/api";

// The Plan view (#118, mockup 2, Q2 variant A and Q7).

vi.mock("next/navigation", () => ({
  usePathname: () => "/you",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: { signOut: vi.fn() } }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ getPlans: vi.fn(), getGoals: vi.fn(), changePlan: vi.fn(), leavePlan: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
  getPause: async () => ({ active: null, recent: null }),
}));

const { PlanView } = await import("@/app/plan/plan-view");
const { YouView } = await import("@/app/you/you-view");

const planned = (over: Partial<PlannedSession>): PlannedSession => ({
  id: 1, plan_id: 3, date: "2026-11-24", slot: 0, sport: "running", template_id: null, title: "Easy run",
  target: { duration_min: 35, effort: 4, distance_km: 6 }, status: "planned", skip_reason: null,
  session_id: null, week: 1, planned_load: 140, state: "upcoming", done: null, ...over,
});

const PLAN: Plan = {
  id: 3, name: "6 weeks to a red", goal_id: 12, start_date: "2026-11-23", end_date: "2027-01-03", weeks: 6,
  week_meta: [1, 2, 3, 4, 5, 6].map((index) => ({ index, kind: index === 4 ? "deload" : "build", note: null })),
  status: "active", ended_on: null, rationale: null, source: "coach", weekly: [],
  today: "2026-11-26", current_week: 1,
  sessions: [
    planned({ id: 1, date: "2026-11-23", sport: "climbing", title: "Limit bouldering",
      target: { duration_min: 90, effort: 8, grades: [{ system: "gym", grade: "red", count: 3 }] }, state: "done",
      done: { id: 51, date: "2026-11-23", duration_min: 85, effort: 8, distance_km: null } }),
    planned({ id: 2, date: "2026-11-24", state: "not_done" }),
    planned({ id: 3, date: "2026-11-26", sport: "other", title: "Hangboard",
      target: { values: { hangboard: { kg: 5, s: 10, sets: 6 } } }, state: "today" }),
    planned({ id: 4, date: "2026-11-28", sport: "climbing", title: "Volume bouldering", state: "upcoming",
      target: { duration_min: 75, effort: 6 } }),
    planned({ id: 5, date: "2026-12-01", week: 2, title: "Tempo run", state: "upcoming" }),
  ],
};
const GOAL = { id: 12, kind: "climb_grade", grade: "red", climb_mode: "send" } as Goal;

beforeEach(() => {
  vi.clearAllMocks();
  api.getPlans.mockResolvedValue({ current: PLAN, plans: [] });
  api.getGoals.mockResolvedValue([GOAL]);
  api.changePlan.mockResolvedValue({ ...PLAN, status: "paused" });
  api.leavePlan.mockResolvedValue({ ...PLAN, status: "left" });
});

const week = () => screen.getByRole("list", { name: /^Week \d/ });

describe("the Plan view", () => {
  it("shows the plan, its goal and this week, with today highlighted", async () => {
    render(<PlanView />);
    expect(await screen.findByRole("heading", { name: "6 weeks to a red" })).toBeInTheDocument();
    expect(screen.getByText(/Goal: send a red/)).toBeInTheDocument();
    expect(screen.getByText("5 weeks left")).toBeInTheDocument();
    // Counts up only: done of this week's sessions.
    expect(screen.getByText("1 of 4 this week")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /W1/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "W4 · lighter" })).toBeInTheDocument();
    const days = within(week()).getAllByRole("listitem");
    expect(days).toHaveLength(7); // Monday to Sunday, rest days included
    const today = days.find((d) => d.getAttribute("aria-current") === "date")!;
    expect(today).toHaveTextContent("Hangboard");
    expect(today).toHaveTextContent("Today");
    expect(within(week()).getAllByText("Rest").length).toBe(3);
  });

  it("links a done session to what was logged, and keeps not done grey, never red (Q7)", async () => {
    render(<PlanView />);
    await screen.findByRole("heading", { name: "6 weeks to a red" });
    expect(screen.getByText("Done")).toHaveClass("text-accent");
    expect(screen.getByRole("link", { name: "Logged: 85 min · effort 8" })).toHaveAttribute("href", "/sessions");
    const notDone = screen.getByText("Not done");
    expect(notDone).toHaveClass("text-ink-muted");
    expect(notDone.className).not.toMatch(/danger|red/);
    expect(document.body.textContent).not.toMatch(/missed|failed|behind/i);
  });

  it("blurs targets in discreet mode but keeps titles and days", async () => {
    render(<PlanView />);
    await screen.findByRole("heading", { name: "6 weeks to a red" });
    expect(screen.getByText("90 min · effort 8 · 3 × red")).toHaveAttribute("data-sensitive");
    expect(screen.getByText("5 kg · 10 s · 6 sets")).toHaveAttribute("data-sensitive");
    expect(screen.getByText("Limit bouldering")).not.toHaveAttribute("data-sensitive");
  });

  it("shows another week from its chip, inside a row that scrolls on its own", async () => {
    const user = userEvent.setup();
    render(<PlanView />);
    await screen.findByRole("heading", { name: "6 weeks to a red" });
    const chips = screen.getByRole("radiogroup", { name: "Week" });
    expect(chips).toHaveClass("overflow-x-auto", "min-w-0"); // no page overflow at 375 px
    await user.click(screen.getByRole("radio", { name: /W2/ }));
    expect(within(week()).getByText("Tempo run")).toBeInTheDocument();
    expect(within(week()).queryByText("Hangboard")).toBeNull();
  });

  it("leaves the plan only after a confirm, and deletes nothing", async () => {
    const user = userEvent.setup();
    render(<PlanView />);
    await screen.findByRole("heading", { name: "6 weeks to a red" });
    await user.click(screen.getByRole("button", { name: "Leave plan" }));
    const ask = screen.getByRole("alertdialog");
    expect(ask).toHaveTextContent("Nothing is deleted");
    await user.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(api.leavePlan).not.toHaveBeenCalled();

    api.getPlans.mockResolvedValue({ current: null, plans: [] });
    await user.click(screen.getByRole("button", { name: "Leave plan" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Leave plan" }));
    expect(api.leavePlan).toHaveBeenCalledWith(3);
    expect(await screen.findByText("You left the plan.")).toBeInTheDocument();
  });

  it("pauses, resumes and finishes with a confirm", async () => {
    const user = userEvent.setup();
    render(<PlanView />);
    await screen.findByRole("heading", { name: "6 weeks to a red" });
    await user.click(screen.getByRole("button", { name: "Pause plan" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Pause plan" }));
    expect(api.changePlan).toHaveBeenCalledWith(3, { status: "paused" });

    api.getPlans.mockResolvedValue({ current: { ...PLAN, status: "paused" }, plans: [] });
    render(<PlanView />);
    await user.click((await screen.findAllByRole("button", { name: "Resume plan" }))[0]);
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Resume plan" }));
    expect(api.changePlan).toHaveBeenCalledWith(3, { status: "active" });

    await user.click(screen.getAllByRole("button", { name: "Finish plan" })[0]);
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Finish plan" }));
    expect(api.changePlan).toHaveBeenCalledWith(3, { status: "finished" });
  });

  it("without a plan, points to the coach", async () => {
    api.getPlans.mockResolvedValue({ current: null, plans: [] });
    render(<PlanView />);
    expect(await screen.findByText("No plan yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask the coach" })).toHaveAttribute("href", "/");
  });

  it("is reached from the You tab, with no tab of its own (Q2)", () => {
    render(<YouView />);
    expect(screen.getByRole("link", { name: /^Plan/ })).toHaveAttribute("href", "/plan");
  });
});
