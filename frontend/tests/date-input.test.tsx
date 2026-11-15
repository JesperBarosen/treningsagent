// One DateInput for every date field: the iOS centring classes everywhere, and
// a Clear button for optional dates (iOS shows none with appearance: none).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GradeGoal } from "@/lib/api";

const api = vi.hoisted(() => ({
  getGoals: vi.fn(),
  addGoal: vi.fn(),
  changeGoal: vi.fn(),
  deleteGoal: vi.fn(),
  getPause: vi.fn(),
  startPause: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

const { DATE_FIELD, DateInput } = await import("@/components/date-input");
const { SessionForm } = await import("@/components/session-form");
const { GoalsSection } = await import("@/components/goals-panel");
const { PauseControl } = await import("@/components/pause-panel");

const root = join(__dirname, "..");
const CENTRING = DATE_FIELD.split(" "); // h-11 appearance-none text-left leading-[calc(2.75rem-2px)]

const RED: GradeGoal = {
  id: 1, kind: "climb_grade", grade: "red", climb_mode: "send", target_date: "2027-03-01",
  status: "active", achieved_on: null, created_on: "2026-11-01", overdue: false,
  progress: { steps: 4, of: 5, best_grade: "purple", best_count_28d: 3, reached_on: null },
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

/** Every date input on screen has the centring classes. Returns how many there are. */
function expectCentred() {
  const dates = [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')];
  for (const d of dates) expect(d).toHaveClass(...CENTRING, "min-h-11", "px-3");
  return dates.length;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getGoals.mockResolvedValue([RED]);
  api.addGoal.mockResolvedValue({});
  api.changeGoal.mockResolvedValue({});
  api.getPause.mockResolvedValue({ active: null, recent: null });
  api.startPause.mockImplementation(async (input) => ({ id: 2, start_date: "2026-11-15", ended_on: null, ...input }));
});

describe("every date field", () => {
  it("goes through DateInput: no raw type=date outside it", () => {
    const offenders = [...sources(join(root, "app")), ...sources(join(root, "components"))]
      .filter((f) => !f.endsWith(join("components", "date-input.tsx")))
      .filter((f) => /type=["{]+date|type:\s*["']date["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it("has the iOS centring classes on the Log form", () => {
    render(<SessionForm onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Run" }));
    expect(expectCentred()).toBe(1);
    // Required: no Clear button.
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();
  });

  it("has them on the Goals add and move-date forms", async () => {
    const user = userEvent.setup();
    render(<GoalsSection />);
    const card = await screen.findByRole("listitem");
    await user.click(within(card).getByRole("button", { name: "Move date" }));
    await user.click(screen.getByRole("button", { name: /Add a goal/ }));
    expect(screen.getByLabelText("New date")).toBeInTheDocument();
    expect(screen.getByLabelText(/^By/)).toBeInTheDocument();
    expect(expectCentred()).toBe(2);
  });

  it("has them on the break form", async () => {
    const user = userEvent.setup();
    render(<PauseControl />);
    await user.click(await screen.findByRole("button", { name: "Take a break" }));
    await user.click(screen.getByRole("radio", { name: "Travel" }));
    expect(screen.getByLabelText(/^Back by/)).toBeInTheDocument();
    expect(expectCentred()).toBe(1);
  });
});

describe("an optional date", () => {
  it("shows a 44 px Clear only while set, and Clear empties it", () => {
    const onChange = vi.fn();
    const { rerender } = render(<DateInput id="d" value="" onChange={onChange} optional />);
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();

    rerender(<DateInput id="d" value="2027-03-01" onChange={onChange} optional />);
    const clear = screen.getByRole("button", { name: "Clear date" });
    expect(clear).toHaveTextContent("Clear");
    expect(clear).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("Clear empties the field without focusing it, on a fresh input", async () => {
    // iOS: focusing the input opens the picker, which writes a date back, and a
    // controlled date input set to "" isn't repainted, so Clear remounts it.
    function Harness() {
      const [value, setValue] = useState("2027-03-01");
      return (
        <>
          <label htmlFor="d">By</label>
          <DateInput id="d" value={value} onChange={setValue} optional />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const before = screen.getByLabelText("By") as HTMLInputElement;
    const focus = vi.spyOn(HTMLInputElement.prototype, "focus");

    await user.click(screen.getByRole("button", { name: "Clear date" }));

    const after = screen.getByLabelText("By") as HTMLInputElement;
    expect(after).not.toBe(before); // remounted
    expect(after.value).toBe("");
    expect(after).not.toHaveFocus();
    expect(focus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();
    // Focus stays in the field's group (not lost to <body>) and the change is announced.
    expect(document.activeElement).toBe(after.parentElement);
    expect(screen.getByRole("status")).toHaveTextContent("Date cleared");
    // Still the same 44 px empty box.
    expect(after).toHaveClass(...CENTRING, "min-h-11");
    focus.mockRestore();

    // Picking a date again works and clears the announcement.
    fireEvent.change(after, { target: { value: "2027-04-01" } });
    expect(after.value).toBe("2027-04-01");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("adds a goal with target_date null after Clear", async () => {
    const user = userEvent.setup();
    api.getGoals.mockResolvedValue([]);
    render(<GoalsSection />);
    await user.click(await screen.findByRole("button", { name: /Add a goal/ }));
    fireEvent.change(screen.getByLabelText(/^By/), { target: { value: "2027-06-01" } });
    await user.click(screen.getByRole("button", { name: "Clear date" }));
    const by = screen.getByLabelText(/^By/) as HTMLInputElement;
    expect(by.value).toBe("");
    expect(by).not.toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Add goal" }));
    expect(api.addGoal).toHaveBeenCalledWith({ kind: "climb_grade", grade: "red", climb_mode: "send", target_date: null });
  });

  it("removes a goal's date with Clear, then Save date", async () => {
    const user = userEvent.setup();
    render(<GoalsSection />);
    const card = await screen.findByRole("listitem");
    await user.click(within(card).getByRole("button", { name: "Move date" }));
    expect(within(card).getByLabelText("New date")).toHaveValue("2027-03-01");
    await user.click(within(card).getByRole("button", { name: "Clear date" }));
    expect(within(card).getByLabelText("New date")).toHaveValue("");
    expect(within(card).getByLabelText("New date")).not.toHaveFocus();
    await user.click(within(card).getByRole("button", { name: "Save date" }));
    expect(api.changeGoal).toHaveBeenCalledWith(1, { target_date: null });
  });

  it("starts a break with no end date after Clear", async () => {
    const user = userEvent.setup();
    render(<PauseControl />);
    await user.click(await screen.findByRole("button", { name: "Take a break" }));
    await user.click(screen.getByRole("radio", { name: "Travel" }));
    fireEvent.change(screen.getByLabelText(/^Back by/), { target: { value: "2026-11-30" } });
    await user.click(screen.getByRole("button", { name: "Clear date" }));
    expect(screen.getByLabelText(/^Back by/)).toHaveValue("");
    expect(screen.getByLabelText(/^Back by/)).not.toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Start break" }));
    expect(api.startPause).toHaveBeenCalledWith(expect.objectContaining({ reason: "travel", planned_end: null }));
  });
});
