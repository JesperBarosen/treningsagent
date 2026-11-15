import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pause, Progression, TrainingLoad, Trend } from "@/lib/api";

const api = vi.hoisted(() => ({ getPause: vi.fn(), startPause: vi.fn(), endPause: vi.fn(), editPause: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getPause: api.getPause,
  startPause: api.startPause,
  endPause: api.endPause,
  editPause: api.editPause,
}));

const { PauseControl, PauseBanner, PHYSIO_HINT } = await import("@/components/pause-panel");
const { Dashboard } = await import("@/app/dashboard/dashboard-view");
const { HIT_AREA_Y } = await import("@/components/states");

const INJURY: Pause = {
  id: 1, start_date: "2026-11-02", planned_end: "2026-11-23", ended_on: null, reason: "injury",
  body_part: "left ankle", pain: 4, note: "rolled it", resume_choice: null,
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getPause.mockResolvedValue({ active: null, recent: null });
  api.startPause.mockImplementation(async (input) => ({ ...INJURY, ...input, id: 2 }));
  api.endPause.mockResolvedValue({ ...INJURY, ended_on: "2026-11-15", resume_choice: "fresh" });
  api.editPause.mockImplementation(async (input) => ({ ...INJURY, ...input }));
});

describe("taking a break (N5)", () => {
  it("asks for a reason; an injury adds body part, pain 0-10 and a physio suggestion", async () => {
    const user = userEvent.setup();
    render(<PauseControl />);
    await user.click(await screen.findByRole("button", { name: "Take a break" }));

    const reasons = screen.getByRole("radiogroup", { name: "Reason" });
    expect(within(reasons).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Injury", "Illness", "Travel", "Other",
    ]);
    expect(screen.getByRole("button", { name: "Start break" })).toBeDisabled(); // a reason first

    await user.click(within(reasons).getByRole("radio", { name: "Injury" }));
    expect(screen.getByText(PHYSIO_HINT)).toBeInTheDocument();
    const pains = within(screen.getByRole("radiogroup", { name: "Pain from 0 to 10" })).getAllByRole("radio");
    expect(pains).toHaveLength(11);
    for (const p of pains) expect(p.className).toContain(HIT_AREA_Y.split(" ")[0]); // 44 px hit area

    await user.type(screen.getByLabelText(/Where\?/), " left ankle ");
    await user.click(screen.getByRole("radio", { name: "Pain 4" }));
    await user.type(screen.getByLabelText(/Note/), "rolled it");
    await user.click(screen.getByRole("button", { name: "Start break" }));

    expect(api.startPause).toHaveBeenCalledWith({
      reason: "injury", body_part: "left ankle", pain: 4, note: "rolled it", planned_end: null,
    });
    expect(await screen.findByRole("region", { name: "On a break" })).toBeInTheDocument();
  });

  it("other reasons never send injury details", async () => {
    const user = userEvent.setup();
    render(<PauseControl />);
    await user.click(await screen.findByRole("button", { name: "Take a break" }));
    await user.click(screen.getByRole("radio", { name: "Injury" }));
    await user.click(screen.getByRole("radio", { name: "Pain 7" }));
    await user.click(screen.getByRole("radio", { name: "Travel" }));
    expect(screen.queryByText(PHYSIO_HINT)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start break" }));
    expect(api.startPause).toHaveBeenCalledWith(expect.objectContaining({ reason: "travel", body_part: null, pain: null }));
  });

  it("shows the break that is on instead of the button", async () => {
    api.getPause.mockResolvedValue({ active: INJURY, recent: null });
    render(<PauseControl />);
    expect(await screen.findByText("since 2 Nov · injury · until 23 Nov")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take a break" })).not.toBeInTheDocument();
  });
});

describe("the break banner", () => {
  it("is calm, neutral, suggests a physio for an injury, and asks how to come back", async () => {
    const user = userEvent.setup();
    const onEnded = vi.fn();
    render(<PauseBanner pause={INJURY} onEnded={onEnded} onEdited={() => {}} />);
    const banner = screen.getByRole("region", { name: "On a break" });
    expect(banner).toHaveTextContent("Trends and the ratio leave these days out.");
    expect(banner).toHaveTextContent(PHYSIO_HINT);
    expect(banner.textContent).not.toMatch(/diagnos|sprain|fracture|tear|you have/i);
    expect(within(banner).getByText(/since 2 Nov/)).toHaveAttribute("data-sensitive");

    await user.click(within(banner).getByRole("button", { name: "End break" }));
    expect(within(banner).getByText(/Nothing is deleted/)).toBeInTheDocument();
    await user.click(within(banner).getByRole("button", { name: "Start fresh" }));
    expect(api.endPause).toHaveBeenCalledWith("fresh");
    expect(onEnded).toHaveBeenCalled();
  });

  it("has no physio line for travel", () => {
    render(<PauseBanner pause={{ ...INJURY, reason: "travel", body_part: null, pain: null }} onEnded={() => {}} onEdited={() => {}} />);
    expect(screen.queryByText(PHYSIO_HINT)).not.toBeInTheDocument();
  });
});

describe("editing a break that is on (#82)", () => {
  it("opens the start form prefilled and saves every field without ending the break", async () => {
    const user = userEvent.setup();
    const onEdited = vi.fn();
    render(<PauseBanner pause={INJURY} onEnded={vi.fn()} onEdited={onEdited} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const form = screen.getByRole("region", { name: "Edit break" });
    expect(within(form).getByRole("radio", { name: "Injury" })).toHaveAttribute("aria-checked", "true");
    expect(within(form).getByLabelText(/Where\?/)).toHaveValue("left ankle");
    expect(within(form).getByRole("radio", { name: "Pain 4" })).toHaveAttribute("aria-checked", "true");
    expect(within(form).getByLabelText(/Note/)).toHaveValue("rolled it");
    const backBy = within(form).getByLabelText(/Back by/);
    expect(backBy).toHaveValue("2026-11-23");
    expect(backBy).toHaveAttribute("min", "2026-11-02"); // not before the start

    await user.clear(within(form).getByLabelText(/Note/));
    await user.type(within(form).getByLabelText(/Note/), "slower than hoped");
    await user.click(within(form).getByRole("radio", { name: "Pain 2" }));
    fireEvent.change(backBy, { target: { value: "2026-12-07" } });
    await user.click(within(form).getByRole("button", { name: "Save break" }));

    expect(api.editPause).toHaveBeenCalledWith({
      reason: "injury", body_part: "left ankle", pain: 2, note: "slower than hoped", planned_end: "2026-12-07",
    });
    expect(api.startPause).not.toHaveBeenCalled();
    expect(api.endPause).not.toHaveBeenCalled();
    expect(onEdited).toHaveBeenCalledWith(expect.objectContaining({ planned_end: "2026-12-07", start_date: "2026-11-02" }));
  });

  it("drops the injury details and the date when the reason changes and Back by is cleared", async () => {
    const user = userEvent.setup();
    render(<PauseBanner pause={INJURY} onEnded={vi.fn()} onEdited={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("radio", { name: "Illness" }));
    await user.click(screen.getByRole("button", { name: "Clear date" }));
    await user.click(screen.getByRole("button", { name: "Save break" }));
    expect(api.editPause).toHaveBeenCalledWith({
      reason: "illness", body_part: null, pain: null, note: "rolled it", planned_end: null,
    });
  });

  it("Cancel goes back to the banner without saving", async () => {
    const user = userEvent.setup();
    render(<PauseBanner pause={INJURY} onEnded={vi.fn()} onEdited={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("region", { name: "On a break" })).toBeInTheDocument();
    expect(api.editPause).not.toHaveBeenCalled();
  });

  it("shows the server's message when the edit is refused", async () => {
    const { ApiError } = await import("@/lib/api");
    api.editPause.mockRejectedValue(new ApiError("planned_end can't be before the start of the break", 422));
    const user = userEvent.setup();
    render(<PauseBanner pause={INJURY} onEnded={vi.fn()} onEdited={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save break" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("before the start of the break");
  });

  it("updates the You tab's banner after an edit", async () => {
    api.getPause.mockResolvedValue({ active: INJURY, recent: null });
    const user = userEvent.setup();
    render(<PauseControl />);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("radio", { name: "Travel" }));
    await user.click(screen.getByRole("button", { name: "Clear date" }));
    await user.click(screen.getByRole("button", { name: "Save break" }));
    expect(await screen.findByText("since 2 Nov · travel")).toBeInTheDocument();
  });
});

describe("the Dashboard during and after a break", () => {
  const trend = (t: Trend["trend"]): Trend => ({ recent: null, baseline: null, recent_sessions: 0, baseline_sessions: 0, trend: t });
  const load = (over: Partial<TrainingLoad> = {}): TrainingLoad => ({
    daily: [],
    weekly: [{ week_start: "2026-11-09", load: 400, sessions: 2, load_by_sport: { running: 400 } }],
    acute_7d_avg: 50, chronic_28d_avg: 60, acute_chronic_ratio: 0.83, ratio_status: "ok",
    history_days: 60, paused_days: 0, pause: null, ...over,
  });
  const progression = (paused_days = 0) => ({
    weeks: 8, today: "2026-11-15", trend_rule: "", paused_days,
    running: { last_session: null, days_since_last_session: null, sessions: 0, weekly: [],
      trends: { distance_km_per_week: trend("flat"), duration_min_per_week: trend("flat"), pace_min_per_km: trend("flat"),
        pace_by_distance: { under_7km: trend("flat"), "7_to_15km": trend("flat"), over_15km: trend("flat") } } },
    climbing: { last_session: null, days_since_last_session: null, sessions: 0, grade_scale: [], weekly: [],
      trends: { climbs_per_week: trend("flat"), avg_session_hardest_sent: { ...trend("flat"), recent_grade: null, baseline_grade: null },
        avg_session_flash_grade: { ...trend("flat"), recent_grade: null, baseline_grade: null }, send_rate_by_grade: {} } },
  }) as unknown as Progression;

  it("shows the banner and a paused ratio while a break is on", () => {
    render(<Dashboard load={load({ pause: INJURY, ratio_status: "paused", acute_chronic_ratio: null })} progression={progression(13)} />);
    expect(screen.getByRole("region", { name: "On a break" })).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Not counted while you're on a break.")).toBeInTheDocument();
  });

  it("says how many break days trends leave out after it ends", () => {
    render(<Dashboard load={load()} progression={progression(9)} />);
    expect(screen.queryByRole("region", { name: "On a break" })).not.toBeInTheDocument();
    expect(screen.getByText("Trends leave out 9 days from a break.")).toBeInTheDocument();
  });
});
