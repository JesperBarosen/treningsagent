import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GradeDot } from "@/components/grade";
import { SessionForm } from "@/components/session-form";
import { reachedWith } from "@/components/goals-panel";
import type { GradeGoal, Gym } from "@/lib/api";
import { climbRank, gradeSwatch, startGym } from "@/lib/grades";

// Gyms in the Log form and the grade helpers (#99).

const KLATRE: Gym = {
  id: 3,
  name: "Klatreverket",
  range_system: "v",
  archived: false,
  colours: [
    { id: 31, name: "green", colour: "#3fae5f", range: ["V0", "V1"], range_text: "V0–V1", archived: false },
    { id: 32, name: "blue", colour: "#2f6fd6", range: ["V3", "V4"], range_text: "V3–V4", archived: false },
    { id: 33, name: "pink", colour: "#9440b8", range: null, range_text: null, archived: true },
  ],
};
const MY_GYM: Gym = { ...KLATRE, id: 1, name: "My gym", colours: KLATRE.colours.slice(0, 1) };

const getGyms = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getGyms,
}));

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  getGyms.mockReset();
  getGyms.mockResolvedValue({ gyms: [MY_GYM, KLATRE], last_gym_id: 3 });
});

async function climbingForm() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<SessionForm onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole("radio", { name: "Climb" }));
  fireEvent.change(screen.getByLabelText("Duration (min)"), { target: { value: "60" } });
  await screen.findByRole("button", { name: "Gym" });
  return onSubmit;
}

describe("Log form with gyms", () => {
  it("starts at the last gym used and offers its colours with their ranges", async () => {
    await climbingForm();
    expect(screen.getByRole("button", { name: "Gym" })).toHaveTextContent("Klatreverket");
    const chips = within(screen.getByRole("group", { name: "Tap a grade to add a climb" }));
    expect(chips.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Add green, about V0–V1",
      "Add blue, about V3–V4",
    ]); // the archived pink is not offered
  });

  it("logs a colour at the picked gym", async () => {
    const onSubmit = await climbingForm();
    fireEvent.click(screen.getByRole("button", { name: "Add blue, about V3–V4" }));
    fireEvent.click(screen.getByRole("button", { name: "Log session" }));
    expect(onSubmit.mock.calls[0][0].climbs).toEqual([
      { grade: "blue", style: "boulder", sent: false, attempts: 1, grade_system: "gym", gym_id: 3 },
    ]);
  });

  it("switches gym in the sheet, and logs V grades outdoors without a gym", async () => {
    const onSubmit = await climbingForm();
    fireEvent.click(screen.getByRole("button", { name: "Gym" }));
    fireEvent.click(screen.getByRole("button", { name: /^My gym/ }));
    expect(screen.getByRole("button", { name: "Gym" })).toHaveTextContent("My gym");

    fireEvent.click(screen.getByRole("button", { name: "Gym" }));
    fireEvent.click(screen.getByRole("button", { name: /Outdoors or a board/ }));
    expect(screen.queryByRole("radio", { name: "Gym colours" })).toBeNull();
    expect(screen.getByRole("radio", { name: "V-scale" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Add V4" }));
    fireEvent.click(screen.getByRole("radio", { name: "Font" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 6B+" }));
    fireEvent.click(screen.getByRole("button", { name: "Log session" }));
    expect(onSubmit.mock.calls[0][0].climbs).toEqual([
      { grade: "V4", style: "boulder", sent: false, attempts: 1, grade_system: "v" },
      { grade: "6B+", style: "boulder", sent: false, attempts: 1, grade_system: "font" },
    ]);
  });

  it("keeps My gym's colours when the gyms can't load", async () => {
    getGyms.mockRejectedValue(new Error("offline"));
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SessionForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("radio", { name: "Climb" }));
    await waitFor(() => expect(getGyms).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Gym" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Duration (min)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Add red" }));
    fireEvent.click(screen.getByRole("button", { name: "Log session" }));
    // No gym: the backend puts it at the last gym used, or makes My gym.
    expect(onSubmit.mock.calls[0][0].climbs).toEqual([{ grade: "red", style: "boulder", sent: false, attempts: 1 }]);
  });
});

describe("grade helpers", () => {
  it("picks a swatch: own colour, My gym token, or none for V/Font", () => {
    expect(gradeSwatch("blue", "#123456")).toBe("#123456");
    expect(gradeSwatch("blue")).toBe("var(--color-grade-blue)");
    expect(gradeSwatch("V4")).toBeNull();
    const { container } = render(<GradeDot grade="V4" />);
    expect(container.firstChild).toBeNull();
    const { container: own } = render(<GradeDot grade="teal" colour="#3fae5f" />);
    expect((own.firstChild as HTMLElement).style.background).toBe("rgb(63, 174, 95)");
  });

  it("orders climbs: gym colours by place, then V and Font", () => {
    const ranks = [
      climbRank({ grade: "V4", grade_system: "v" }),
      climbRank({ grade: "blue", grade_ordinal: 3, grade_system: "gym" }),
      climbRank({ grade: "red" }),
    ];
    expect(ranks[1]).toBeLessThan(ranks[2]);
    expect(ranks[2]).toBeLessThan(ranks[0]);
  });

  it("starts at the session's gym, else the last used, else the first live gym", () => {
    expect(startGym([MY_GYM, KLATRE], 3)?.id).toBe(3);
    expect(startGym([MY_GYM, KLATRE], 3, [{ grade: "green", style: "boulder", sent: true, gym_id: 1 }])?.id).toBe(1);
    expect(startGym([{ ...MY_GYM, archived: true }, KLATRE], null)?.id).toBe(3);
    expect(startGym([], null)).toBeNull();
  });

  it("says where a grade goal was reached", () => {
    const goal = (w: GradeGoal["progress"]["reached_with"]) =>
      ({ progress: { reached_with: w } }) as GradeGoal;
    expect(reachedWith(goal({ grade: "blue", grade_system: "gym", gym: "Klatreverket", about: "V3" }))).toBe(
      "blue at Klatreverket, about V3",
    );
    expect(reachedWith(goal({ grade: "V5", grade_system: "v", gym: null, about: "V5" }))).toBe(
      "V5 outdoors or on a board",
    );
    expect(reachedWith(goal(undefined))).toBeNull();
  });
});
