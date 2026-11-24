import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, PlanProposal } from "@/lib/api";

// #135: the proposal preview, the card's week bars, and what the user said.

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/plan/proposal" }));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: {} }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ sendChat: vi.fn(), createPlan: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
  getTrainingLoad: () => Promise.reject(new Error("not under test")),
}));

const { Chat } = await import("@/app/chat");
const { ProposalPreview } = await import("@/app/plan/proposal/proposal-preview");
const { PlanProposalCard } = await import("@/components/plan-proposal-card");
const { weekVolume, targetText, weekContaining } = await import("@/lib/plans");
const preview = await import("@/lib/plan-preview");

const run = (date: string, km: number, type: "easy" | "tempo" | "long", workout?: string) => ({
  date, sport: "running" as const, title: type === "tempo" ? "Tempo run" : type === "long" ? "Long run" : "Easy run",
  template_id: null,
  target: { duration_min: 40, effort: type === "tempo" ? 7 : 4, distance_km: km, session_type: type,
    ...(workout ? { workout } : {}) },
});
const SESSIONS = [
  run("2026-11-24", 6, "easy"), run("2026-11-26", 6, "tempo", "20 min at tempo effort between 10 min easy"),
  run("2026-11-28", 6.5, "long"), run("2026-12-01", 6, "easy"),
];
const PROPOSAL: PlanProposal = {
  proposal: true, stored: false, goal: null, rules_applied: [],
  plan: {
    id: null, status: "proposed", name: "4 weeks of running", goal_id: null, start_date: "2026-11-23",
    end_date: "2026-12-20", weeks: 4, rationale: "Easy-paced runs for your sore calves (L1a, P31).", source: "coach",
    week_meta: [1, 2, 3, 4].map((index) => ({ index, kind: index === 4 ? "deload" : "build", note: null })),
    sessions: SESSIONS.map((s, i) => ({ ...s, id: null, plan_id: null, slot: 0, status: "planned", skip_reason: null,
      session_id: null, week: i < 3 ? 1 : 2, planned_load: 160 })),
    weekly: [480, 520, 560, 300].map((planned_load, i) => ({
      index: i + 1, kind: i === 3 ? "deload" : "build", week_start: "2026-11-23", sessions: 3, planned_load })),
    weekly_running_km: [18.5, 19.6, 21.3, 16],
  },
  accept: { name: "4 weeks of running", start_date: "2026-11-23", weeks: 4, goal_id: null, rationale: "…",
    source: "coach", week_meta: [], sessions: SESSIONS },
  context: { sessions_per_week: 3, available_days: ["tuesday", "thursday", "saturday"], injury_or_pain: "sore calves",
    user_said: ["I have sore calves", "3 days a week"] },
};
const STORED = { id: 9, name: "4 weeks of running", weeks: 4, start_date: "2026-11-23" } as Plan;
const REF = { itemId: "item-1", key: "k1" };

// Today is fixed, the Friday before the plan starts, so the tests can't break
// with the calendar. Only the clock is faked; timers stay real for userEvent.
const setToday = (y: number, m: number, d: number) => vi.setSystemTime(new Date(y, m - 1, d, 10));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setToday(2026, 11, 20);
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  api.createPlan.mockResolvedValue(STORED);
});
afterEach(() => vi.useRealTimers());

describe("the week bars on the proposal card (#135 bug)", () => {
  it("draws each week's planned load, not flat lines", () => {
    render(<PlanProposalCard proposal={PROPOSAL} status="open" onAccept={vi.fn()} onDismiss={vi.fn()} />);
    const bars = Array.from(screen.getByTestId("week-bars").children) as HTMLElement[];
    expect(bars.map((b) => b.dataset.volume)).toEqual(["480", "520", "560", "300"]);
    const heights = bars.map((b) => parseFloat(b.style.height));
    [480, 520, 560, 300].forEach((load, i) => expect(heights[i]).toBeCloseTo((load / 560) * 100, 2));
    expect(bars[0]).toHaveClass("block", "bg-sunken"); // a filled bar, not just a dashed outline
  });

  it("falls back to running km, then sessions, when no week has planned load", () => {
    const zero = PROPOSAL.plan.weekly.map((w) => ({ ...w, planned_load: 0 }));
    expect(weekVolume(zero, [18.5, 19.6, 21.3, 16])).toMatchObject({ unit: "km", values: [18.5, 19.6, 21.3, 16] });
    expect(weekVolume(zero, [0, 0, 0, 0])).toMatchObject({ unit: "sessions", values: [3, 3, 3, 3] });
    expect(weekVolume(zero).heights).toEqual([1, 1, 1, 1]);
    render(
      <PlanProposalCard
        proposal={{ ...PROPOSAL, plan: { ...PROPOSAL.plan, weekly: zero } }}
        status="open" onAccept={vi.fn()} onDismiss={vi.fn()}
      />,
    );
    const heights = (Array.from(screen.getByTestId("week-bars").children) as HTMLElement[]).map((b) => b.style.height);
    expect(new Set(heights).size).toBeGreaterThan(1);
  });
});

describe("the proposal card", () => {
  it("quotes what the user said and offers View plan next to Accept and Dismiss", () => {
    const onView = vi.fn();
    render(<PlanProposalCard proposal={PROPOSAL} status="open" onAccept={vi.fn()} onDismiss={vi.fn()} onView={onView} />);
    expect(screen.getByText("Based on what you said: “I have sore calves”, “3 days a week”")).toBeInTheDocument();
    const view = screen.getByRole("link", { name: /View plan/ });
    expect(view).toHaveAttribute("href", "/plan/proposal");
    view.click();
    expect(onView).toHaveBeenCalled();
  });

  it("shows a run's type and workout in its target", () => {
    expect(targetText(SESSIONS[1].target)).toBe(
      "Tempo · 20 min at tempo effort between 10 min easy · 40 min · effort 7 · 6 km",
    );
  });
});

describe("the proposal preview (/plan/proposal)", () => {
  it("shows the whole proposal week by week, marked not saved", async () => {
    preview.handProposalToPreview(REF, PROPOSAL);
    render(<ProposalPreview />);
    expect(screen.getByRole("status")).toHaveTextContent("Proposal, not saved");
    expect(screen.getByRole("heading", { name: "4 weeks of running" })).toBeInTheDocument();
    expect(screen.getByText(/Based on what you said/)).toHaveTextContent("I have sore calves");
    const week1 = screen.getByRole("list", { name: "Week 1" });
    expect(within(week1).getByText("Tempo run")).toBeInTheDocument();
    expect(within(week1).getByText(/20 min at tempo effort between 10 min easy/)).toHaveAttribute("data-sensitive");
    await userEvent.click(screen.getByRole("radio", { name: "W2" }));
    expect(within(screen.getByRole("list", { name: "Week 2" })).getByText("Easy run")).toBeInTheDocument();
    expect(api.createPlan).not.toHaveBeenCalled();
  });

  it("opens on the week containing today once the plan has started, never on the last week", async () => {
    setToday(2026, 11, 24); // the plan started yesterday
    preview.handProposalToPreview(REF, PROPOSAL);
    const { unmount } = render(<ProposalPreview />);
    expect(within(screen.getByRole("list", { name: "Week 1" })).getByText("Tempo run")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /W1/ })).toHaveAccessibleName(/this week/);
    unmount();

    setToday(2026, 12, 2); // in week 2
    preview.handProposalToPreview(REF, PROPOSAL);
    render(<ProposalPreview />);
    expect(screen.getByRole("list", { name: "Week 2" })).toBeInTheDocument();
  });

  it("opens on week 1 when today is past the plan's end", () => {
    setToday(2027, 1, 15);
    preview.handProposalToPreview(REF, PROPOSAL);
    render(<ProposalPreview />);
    expect(screen.getByRole("list", { name: "Week 1" })).toBeInTheDocument();
  });

  it("finds the week containing a day, or none outside the plan", () => {
    expect(weekContaining("2026-11-23", 4, "2026-11-22")).toBeNull();
    expect(weekContaining("2026-11-23", 4, "2026-11-23")).toBe(1);
    expect(weekContaining("2026-11-23", 4, "2026-11-29")).toBe(1);
    expect(weekContaining("2026-11-23", 4, "2026-11-30")).toBe(2);
    expect(weekContaining("2026-11-23", 4, "2026-12-20")).toBe(4);
    expect(weekContaining("2026-11-23", 4, "2026-12-21")).toBeNull();
  });

  it("stores the plan on Accept and tells the chat", async () => {
    preview.handProposalToPreview(REF, PROPOSAL);
    render(<ProposalPreview />);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(api.createPlan).toHaveBeenCalledWith(PROPOSAL.accept);
    expect(router.push).toHaveBeenCalledWith("/plan");
    expect(preview.takeSettledProposal()).toEqual({ ref: REF, outcome: { accepted: STORED } });
    expect(preview.peekPreview()).toBeNull();
  });

  it("dismisses without storing anything", async () => {
    preview.handProposalToPreview(REF, PROPOSAL);
    render(<ProposalPreview />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(api.createPlan).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/");
    expect(preview.takeSettledProposal()?.outcome).toEqual({ dismissed: PROPOSAL });
  });

  it("without a proposal, points back to the coach", () => {
    render(<ProposalPreview />);
    expect(screen.getByText("No proposal to show")).toBeInTheDocument();
  });
});

describe("the chat and the preview", () => {
  it("hands the proposal to View plan, then marks the card when the preview accepted it", async () => {
    api.sendChat.mockResolvedValue({
      reply: "Here's a proposal.", history: [{ role: "user", content: "plan" }, { role: "assistant", content: [] }],
      conversation_id: "c1", logged_sessions: [], proposals: [PROPOSAL],
    });
    const user = userEvent.setup();
    const { unmount } = render(<Chat />);
    await user.type(await screen.findByLabelText("Message"), "Make me a plan{Enter}");
    const card = await screen.findByRole("region", { name: "Proposed plan: 4 weeks of running" });
    await user.click(within(card).getByRole("link", { name: /View plan/ }));
    const handed = preview.parsePreview(preview.peekPreview());
    expect(handed?.proposal.plan.name).toBe("4 weeks of running");

    // The preview accepts; the chat opens again and settles the card once.
    preview.reportProposalSettled(handed!.ref, { accepted: STORED });
    unmount();
    render(<Chat />);
    const again = await screen.findByRole("region", { name: "Proposed plan: 4 weeks of running" });
    expect(await within(again).findByText("Plan saved")).toBeInTheDocument();
    api.sendChat.mockResolvedValue({ reply: "ok", history: [], conversation_id: "c1", logged_sessions: [] });
    await user.type(screen.getByLabelText("Message"), "Thanks{Enter}");
    const history = JSON.stringify(api.sendChat.mock.calls.at(-1)![1]);
    expect(history.match(/User accepted the plan/g)).toHaveLength(1);
  });
});
