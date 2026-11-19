import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, PlannedSession, Session } from "@/lib/api";

// Logging a planned session (#132) and linking it (#117, Q6 option A).

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: nav.push }),
}));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: {} }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({
  getPlans: vi.fn(),
  getGoals: vi.fn(),
  createSession: vi.fn(),
  getSessions: vi.fn(),
  linkPlanned: vi.fn(),
  unlinkPlanned: vi.fn(),
  sendChat: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
  getPause: async () => ({ active: null, recent: null }),
  getTrainingLoad: () => Promise.reject(new Error("not under test")),
}));
// Today is fixed, so "today's" and weekday names are stable.
vi.mock("@/lib/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/format")>()),
  todayIso: () => "2026-11-26",
}));

const { PlanView, PlanCalendar } = await import("@/app/plan/plan-view");
const { LogView } = await import("@/app/log/log-view");
const { Chat } = await import("@/app/chat");
const handoff = await import("@/lib/log-planned");
const { plannedAsSession, plannedName } = await import("@/lib/plans");

const planned = (over: Partial<PlannedSession>): PlannedSession => ({
  id: 2, plan_id: 3, date: "2026-11-24", slot: 0, sport: "running", template_id: null, title: "Tempo run",
  target: { duration_min: 40, effort: 6, distance_km: 7, session_type: "tempo", workout: "3 x 8 min at tempo, 2 min jog" },
  status: "planned", skip_reason: null, session_id: null, week: 1, planned_load: 240, state: "not_done", done: null,
  ...over,
});
const TEMPO = planned({});

const PLAN: Plan = {
  id: 3, name: "4 weeks", goal_id: null, start_date: "2026-11-23", end_date: "2026-12-20", weeks: 4,
  week_meta: [1, 2, 3, 4].map((index) => ({ index, kind: index === 4 ? "deload" : "build", note: null })),
  status: "active", ended_on: null, rationale: null, source: "coach", weekly: [], today: "2026-11-26", current_week: 1,
  sessions: [
    planned({ id: 1, date: "2026-11-23", title: "Easy run", state: "done", session_id: 50,
      done: { id: 50, date: "2026-11-23", duration_min: 35, effort: 4, distance_km: 6 } }),
    TEMPO,
    planned({ id: 3, date: "2026-11-25", title: "Strides", state: "skipped", status: "skipped" }),
    planned({ id: 4, date: "2026-11-26", title: "Easy run", state: "today" }),
    planned({ id: 5, date: "2026-11-28", title: "Long run", state: "upcoming" }),
  ],
};

const SAVED: Session = { id: 77, sport: "running", date: "2026-11-24", duration_min: 42, effort: 6, distance_km: 7 };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  api.getPlans.mockResolvedValue({ current: PLAN, plans: [] });
  api.getGoals.mockResolvedValue([]);
  api.getSessions.mockResolvedValue([]);
  api.unlinkPlanned.mockResolvedValue({ ...TEMPO, session_id: null });
  api.linkPlanned.mockResolvedValue({ ...TEMPO, session_id: 77 });
});

describe("prefilling the Log form from a planned session", () => {
  it("takes the sport, template, duration, distance and effort, and the workout as a note", () => {
    expect(plannedAsSession(TEMPO, "2026-11-26")).toEqual(expect.objectContaining({
      sport: "running", date: "2026-11-24", duration_min: 40, effort: 6, distance_km: 7, template_id: null,
      notes: "Tempo run: 3 x 8 min at tempo, 2 min jog",
    }));
    const hangboard = planned({ sport: "other", template_id: 9, title: "Hangboard", date: "2026-11-30",
      target: { values: { hangboard: { kg: 5, s: 10, sets: 6 } } } });
    const s = plannedAsSession(hangboard, "2026-11-26");
    expect(s.template_id).toBe(9);
    expect(s.custom_values).toEqual({ hangboard: { kg: 5, s: 10, sets: 6 } });
    expect(s.date).toBe("2026-11-26"); // a day still ahead: logged today
    expect(s.notes).toBeNull();
  });

  it("names a planned session by its day", () => {
    expect(plannedName(TEMPO, "2026-11-26")).toBe("Tuesday's Tempo run");
    expect(plannedName(planned({ date: "2026-11-26" }), "2026-11-26")).toBe("today's Tempo run");
  });
});

describe("Log this in the Plan view", () => {
  it("shows on today's, upcoming and not done sessions, not on done or skipped ones", async () => {
    render(<PlanView />);
    await screen.findByRole("heading", { name: "4 weeks" });
    const buttons = screen.getAllByRole("button", { name: /^Log this/ }).map((b) => b.getAttribute("aria-label"));
    expect(buttons).toEqual(["Log this: Tempo run", "Log this: Easy run", "Log this: Long run"]);
    expect(screen.getByRole("button", { name: "Log this: Tempo run" })).toHaveClass("min-h-11");
  });

  it("hands the planned session to the Log form and opens it", async () => {
    const user = userEvent.setup();
    render(<PlanView />);
    await user.click(await screen.findByRole("button", { name: "Log this: Tempo run" }));
    expect(handoff.parseHandedPlanned(handoff.peekPlannedForForm())).toEqual(TEMPO);
    expect(nav.push).toHaveBeenCalledWith("/log");
  });

  it("isn't offered in the proposal preview, where nothing is stored yet", () => {
    render(<PlanCalendar startDate={PLAN.start_date} weeks={4} weekMeta={PLAN.week_meta} sessions={PLAN.sessions}
      today="2026-11-26" current={1} />);
    expect(screen.queryByRole("button", { name: /^Log this/ })).not.toBeInTheDocument();
  });
});

describe("the Log form opened from a planned session", () => {
  it("is prefilled, links the planned session on save, and offers Undo", async () => {
    api.createSession.mockResolvedValue({ ...SAVED, plan_link: { linked: { ...TEMPO, session_id: 77 }, auto: false } });
    handoff.handPlannedToForm(TEMPO);
    const user = userEvent.setup();
    render(<LogView />);

    expect(await screen.findByText(/Planned: Tuesday's Tempo run/)).toBeInTheDocument();
    expect(screen.getByLabelText("Duration (min)")).toHaveValue(40);
    expect(screen.getByLabelText("Distance (km)")).toHaveValue("7");
    expect(screen.getByLabelText("Notes")).toHaveValue("Tempo run: 3 x 8 min at tempo, 2 min jog");
    expect(screen.getByLabelText(/^date/i)).toHaveValue("2026-11-24");

    await user.clear(screen.getByLabelText("Duration (min)"));
    await user.type(screen.getByLabelText("Duration (min)"), "42");
    await user.click(screen.getByRole("button", { name: "Log session" }));
    expect(api.createSession).toHaveBeenCalledWith(expect.objectContaining({ planned_id: 2, duration_min: 42 }));
    expect(handoff.peekPlannedForForm()).toBeNull(); // used once
    expect(screen.queryByText(/Planned:/)).not.toBeInTheDocument();

    expect(screen.getByText("Counted as Tuesday's Tempo run.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo: don't count it as Tuesday's Tempo run" }));
    expect(api.unlinkPlanned).toHaveBeenCalledWith(2);
    expect(await screen.findByText("No longer counted as Tuesday's Tempo run.")).toBeInTheDocument();
  });

  it("Clear drops the planned session and starts an empty form", async () => {
    handoff.handPlannedToForm(TEMPO);
    const user = userEvent.setup();
    render(<LogView />);
    await user.click(await screen.findByRole("button", { name: "Clear" }));
    expect(screen.queryByText(/Planned:/)).not.toBeInTheDocument();
    expect(handoff.peekPlannedForForm()).toBeNull();
  });
});

describe("matching a session logged another way", () => {
  async function logAnyRun() {
    const user = userEvent.setup();
    render(<LogView />);
    await user.click(await screen.findByRole("radio", { name: /run/i }));
    await user.type(screen.getByLabelText("Duration (min)"), "42");
    await user.click(screen.getByRole("button", { name: "Log session" }));
    return user;
  }

  it("says when it was counted automatically, with Undo", async () => {
    api.createSession.mockResolvedValue({ ...SAVED, plan_link: { linked: planned({ date: "2026-11-26", title: "Easy run" }), auto: true } });
    await logAnyRun();
    expect(await screen.findByText("Counted as today's Easy run.")).toBeInTheDocument();
    expect(api.createSession.mock.calls[0][0]).not.toHaveProperty("planned_id");
  });

  it("asks about a single match on another day: Yes links it, No leaves it", async () => {
    api.createSession.mockResolvedValue({ ...SAVED, plan_link: { candidates: [TEMPO] } });
    const user = await logAnyRun();
    expect(await screen.findByText("Was this Tuesday's Tempo run?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(api.linkPlanned).toHaveBeenCalledWith(2, 77);
    expect(await screen.findByText("Counted as Tuesday's Tempo run.")).toBeInTheDocument();
  });

  it("No stores nothing and the question goes away", async () => {
    api.createSession.mockResolvedValue({ ...SAVED, plan_link: { candidates: [TEMPO] } });
    const user = await logAnyRun();
    await user.click(await screen.findByRole("button", { name: "No" }));
    expect(api.linkPlanned).not.toHaveBeenCalled();
    expect(screen.queryByText(/Was this/)).not.toBeInTheDocument();
  });

  it("with several matches, asks which one", async () => {
    const thursday = planned({ id: 6, date: "2026-11-26", title: "Easy run" });
    api.createSession.mockResolvedValue({ ...SAVED, plan_link: { candidates: [TEMPO, thursday] } });
    const user = await logAnyRun();
    expect(await screen.findByText("Was this one of your planned sessions?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "None of these" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today's Easy run" }));
    expect(api.linkPlanned).toHaveBeenCalledWith(6, 77);
  });

  it("shows nothing when nothing planned matches", async () => {
    api.createSession.mockResolvedValue({ ...SAVED, plan_link: {} });
    await logAnyRun();
    expect(await screen.findByText(/Logged:/)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Plan" })).not.toBeInTheDocument();
  });
});

describe("a session the coach logged", () => {
  it("shows the link on its card, and Undo tells the coach", async () => {
    const linked = { ...SAVED, plan_link: { linked: planned({ date: "2026-11-26", title: "Easy run", id: 4 }), auto: true } };
    api.sendChat.mockResolvedValue({ reply: "Logged.", history: [{ role: "user", content: "ran" }], conversation_id: "c1",
      logged_sessions: [linked] });
    const user = userEvent.setup();
    render(<Chat />);
    await user.type(await screen.findByLabelText("Message"), "Ran 7 km{Enter}");
    const notice = await screen.findByRole("status", { name: "Plan" });
    expect(notice).toHaveTextContent("Counted as today's Easy run.");
    await user.click(within(notice).getByRole("button", { name: "Undo: don't count it as today's Easy run" }));
    expect(api.unlinkPlanned).toHaveBeenCalledWith(4);

    await user.type(screen.getByLabelText("Message"), "ok{Enter}");
    await screen.findAllByText("Logged.");
    const history = api.sendChat.mock.calls.at(-1)![1] as { content: string }[];
    expect(history.at(-1)!.content).toMatch(/^\[User undid the link: the session .* no longer counts as the planned Tempo run on 2026-11-24\.\]$/);
  });
});
