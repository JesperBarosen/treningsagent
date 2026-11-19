import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, PlanProposal } from "@/lib/api";

// The coach's plan proposal card (#119, #120, mockup 1): nothing is stored
// until Accept, even with "Save without asking" on (Q5).

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: {} }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ sendChat: vi.fn(), createPlan: vi.fn(), createSession: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  sendChat: api.sendChat,
  createPlan: api.createPlan,
  createSession: api.createSession,
  getTrainingLoad: () => Promise.reject(new Error("not under test")),
}));

const { Chat } = await import("@/app/chat");
const { ApiError } = await import("@/lib/api");

const run = (date: string, km: number) => ({
  date, sport: "running" as const, title: "Easy run", template_id: null,
  target: { duration_min: 36, effort: 4, distance_km: km },
});
const SESSIONS = [run("2026-11-24", 6), run("2026-11-26", 6), run("2026-12-15", 5)];
const PROPOSAL: PlanProposal = {
  proposal: true,
  stored: false,
  plan: {
    id: null, status: "proposed", name: "4 weeks of steady running", goal_id: null,
    start_date: "2026-11-23", end_date: "2026-12-20", weeks: 4, rationale: "Runs grow at most 10% (L1a, P31); week 4 lighter (L2, P27).",
    source: "coach",
    week_meta: [1, 2, 3, 4].map((index) => ({ index, kind: index === 4 ? "deload" : "build", note: null })),
    sessions: SESSIONS.map((s, i) => ({ ...s, id: null, plan_id: null, slot: 0, status: "planned", skip_reason: null,
      session_id: null, week: i < 2 ? 1 : 4, planned_load: 144 })),
    weekly: [483, 554, 648, 324].map((planned_load, i) => ({
      index: i + 1, kind: i === 3 ? "deload" : "build", week_start: "2026-11-23", sessions: 3, planned_load })),
  },
  accept: {
    name: "4 weeks of steady running", start_date: "2026-11-23", weeks: 4, goal_id: null, rationale: "…",
    source: "coach", week_meta: [], sessions: SESSIONS,
  },
  goal: null,
  rules_applied: ["L1a: …"],
};
const STORED = { id: 7, name: PROPOSAL.plan.name, weeks: 4, start_date: "2026-11-23" } as Plan;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  api.sendChat.mockResolvedValue({
    reply: "Here's a proposal. Nothing is saved until you accept it.",
    history: [{ role: "user", content: "Make me a plan" }, { role: "assistant", content: [{ type: "text", text: "…" }] }],
    conversation_id: "c1",
    logged_sessions: [],
    proposals: [PROPOSAL],
  });
  api.createPlan.mockResolvedValue(STORED);
});

async function chatWithProposal() {
  const user = userEvent.setup();
  render(<Chat />);
  await user.type(await screen.findByLabelText("Message"), "Make me a plan{Enter}");
  const card = await screen.findByRole("region", { name: "Proposed plan: 4 weeks of steady running" });
  return { user, card };
}

const lastHistory = () => {
  const calls = api.sendChat.mock.calls;
  return calls[calls.length - 1][1] as { role: string; content: unknown }[];
};

describe("a plan proposal in Coach", () => {
  it("shows weeks, sessions, the lighter week and the reason, and stores nothing yet", async () => {
    const { card } = await chatWithProposal();
    expect(within(card).getByText("Proposed plan · not saved yet")).toBeInTheDocument();
    expect(within(card).getByText(/4 weeks · 23 Nov – 20 Dec/)).toBeInTheDocument();
    expect(within(card).getByText("0.8 sessions a week")).toBeInTheDocument();
    expect(within(card).getByText(/W4 · lighter, planned load 324/)).toBeInTheDocument();
    expect(within(card).getByText(/L1a, P31/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Accept" })).toHaveClass("min-h-11");
    expect(within(card).getByRole("button", { name: "Dismiss" })).toHaveClass("min-h-11");
    expect(api.createPlan).not.toHaveBeenCalled();
  });

  it("stores the plan only on Accept, even with Save without asking on, and tells the coach", async () => {
    localStorage.setItem("treningsagent.chatAutoSave", "on");
    const { user, card } = await chatWithProposal();
    expect(api.createPlan).not.toHaveBeenCalled(); // auto_save doesn't cover plans (Q5)
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(api.createPlan).toHaveBeenCalledWith(PROPOSAL.accept);
    expect(await within(card).findByText("Plan saved")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Open the plan/ })).toHaveAttribute("href", "/plan");
    await user.type(screen.getByLabelText("Message"), "Thanks{Enter}");
    expect(JSON.stringify(lastHistory())).toContain("[User accepted the plan: 4 weeks of steady running, 4 weeks from 2026-11-23 (plan id 7)");
  });

  it("dismisses without storing anything, and tells the coach", async () => {
    const { user, card } = await chatWithProposal();
    await user.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: /Proposed plan/ })).toBeNull();
    expect(api.createPlan).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Message"), "OK{Enter}");
    expect(JSON.stringify(lastHistory())).toContain("[User dismissed the plan proposal: 4 weeks of steady running. Nothing was stored.]");
  });

  it("says why when the plan can't be saved, e.g. another plan is active", async () => {
    api.createPlan.mockRejectedValue(new ApiError("there is already an active plan; leave or finish it first", 409));
    const { user, card } = await chatWithProposal();
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("already an active plan");
    expect(within(card).getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("links to the Plan view from the Coach header", async () => {
    render(<Chat />);
    expect(await screen.findByRole("link", { name: "Plan" })).toHaveAttribute("href", "/plan");
  });
});
