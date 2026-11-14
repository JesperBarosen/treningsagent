import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal, GradeGoal, PaceGoal } from "@/lib/api";

const api = vi.hoisted(() => ({ getGoals: vi.fn(), addGoal: vi.fn(), changeGoal: vi.fn(), deleteGoal: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getGoals: api.getGoals,
  addGoal: api.addGoal,
  changeGoal: api.changeGoal,
  deleteGoal: api.deleteGoal,
}));

const { GoalsSection, goalTitle, parsePace } = await import("@/components/goals-panel");

const base = { target_date: "2027-03-01", status: "active" as const, achieved_on: null, created_on: "2026-11-01", overdue: false };
const RED: GradeGoal = {
  ...base, id: 1, kind: "climb_grade", grade: "red", climb_mode: "send",
  progress: { steps: 4, of: 5, best_grade: "purple", best_count_28d: 3, reached_on: null },
};
const PACE: PaceGoal = {
  ...base, id: 2, kind: "run_pace", band: "7_to_15km", target_pace: 5, start_pace: 5.52, target_date: "2027-04-30",
  progress: { start_pace: 5.52, now_pace: 5.2, target_pace: 5, fraction: 0.62, reached_on: null },
};

async function show(goals: Goal[]) {
  api.getGoals.mockResolvedValue(goals);
  const user = userEvent.setup();
  render(<GoalsSection />);
  await screen.findByRole("heading", { name: "Goals" });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.changeGoal.mockResolvedValue({});
  api.addGoal.mockResolvedValue({});
  api.deleteGoal.mockResolvedValue(undefined);
});

describe("goal helpers", () => {
  it("title goals in plain words", () => {
    expect(goalTitle(RED)).toBe("Send a red by 1 Mar");
    expect(goalTitle({ ...PACE, target_date: null })).toBe("7–15 km at 5:00 /km");
  });

  it("read a pace as 5:00, 4:45 or 4.75", () => {
    expect(parsePace("5:00")).toBe(5);
    expect(parsePace("4:45")).toBe(4.75);
    expect(parsePace("4,75")).toBe(4.75);
    expect(parsePace("5")).toBe(5);
    for (const bad of ["", "5:75", "fast", "5:0"]) expect(parsePace(bad)).toBeNull();
  });
});

describe("goal cards (N2)", () => {
  it("show grade steps and the pace bar with their numbers, blurred in discreet mode", async () => {
    await show([RED, PACE]);
    const red = await screen.findByRole("listitem", { name: "Send a red by 1 Mar" });
    expect(within(red).getByText("4 of 5 steps · purple sent 3 times this month")).toHaveAttribute("data-sensitive");
    const pace = screen.getByRole("listitem", { name: "7–15 km at 5:00 /km by 30 Apr" });
    expect(within(pace).getByText("5:31 at start")).toBeInTheDocument();
    expect(within(pace).getByText("5:12 now")).toBeInTheDocument();
    expect(within(pace).getByText("5:00 goal")).toBeInTheDocument();
  });

  it("mark a reached goal quietly", async () => {
    await show([{ ...RED, status: "achieved", achieved_on: "2026-11-12", progress: { ...RED.progress, steps: 5, reached_on: "2026-11-12" } }]);
    const card = await screen.findByRole("listitem");
    expect(within(card).getByText(/Reached 12 Nov/)).toHaveClass("text-accent");
    expect(within(card).queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("ask keep, move or let go when the date passed, never 'failed' and never red", async () => {
    const user = await show([{ ...RED, overdue: true }]);
    const card = await screen.findByRole("listitem");
    expect(card).toHaveTextContent("The date has passed. Keep it, move the date, or let it go?");
    expect(card.textContent).not.toMatch(/fail|missed/i);
    expect(card.innerHTML).not.toMatch(/danger/); // the red grade dot is the hold's colour, not a warning

    await user.click(within(card).getByRole("button", { name: "Keep it" }));
    expect(api.changeGoal).toHaveBeenCalledWith(1, { target_date: null });
    await user.click(within(card).getByRole("button", { name: "Let it go" }));
    expect(api.changeGoal).toHaveBeenCalledWith(1, { status: "dropped" });
  });

  it("can be paused, have their date moved, and be removed with a second tap", async () => {
    const user = await show([RED]);
    const card = await screen.findByRole("listitem");
    await user.click(within(card).getByRole("button", { name: "Pause" }));
    expect(api.changeGoal).toHaveBeenCalledWith(1, { status: "paused" });

    await user.click(within(card).getByRole("button", { name: "Move date" }));
    const input = within(card).getByLabelText("New date");
    await user.clear(input);
    await user.type(input, "2027-05-01");
    await user.click(within(card).getByRole("button", { name: "Save date" }));
    expect(api.changeGoal).toHaveBeenCalledWith(1, { target_date: "2027-05-01" });
  });

  it("removes only after a second tap", async () => {
    const user = await show([RED]);
    const card = await screen.findByRole("listitem");
    await user.click(within(card).getByRole("button", { name: "Remove" }));
    expect(api.deleteGoal).not.toHaveBeenCalled();
    await user.click(within(card).getByRole("button", { name: "Remove for good" }));
    expect(api.deleteGoal).toHaveBeenCalledWith(1);
  });

  it("hides goals the user let go", async () => {
    await show([{ ...RED, status: "dropped" }]);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.getByText(/Something to aim for/)).toBeInTheDocument();
  });
});

describe("adding a goal", () => {
  it("adds a grade goal with the user's own choices", async () => {
    const user = await show([]);
    await user.click(screen.getByRole("button", { name: /Add a goal/ }));
    await user.selectOptions(screen.getByLabelText("Grade"), "black");
    await user.selectOptions(screen.getByLabelText("How"), "flash");
    await user.click(screen.getByRole("button", { name: "Add goal" }));
    expect(api.addGoal).toHaveBeenCalledWith({ kind: "climb_grade", grade: "black", climb_mode: "flash", target_date: null });
  });

  it("adds a pace goal only with a readable pace", async () => {
    const user = await show([]);
    await user.click(screen.getByRole("button", { name: /Add a goal/ }));
    await user.click(screen.getByRole("radio", { name: "Running pace" }));
    const add = screen.getByRole("button", { name: "Add goal" });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText(/Pace/), "4:45");
    await user.click(add);
    expect(api.addGoal).toHaveBeenCalledWith({ kind: "run_pace", band: "7_to_15km", target_pace: 4.75, target_date: null });
  });
});
