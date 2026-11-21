import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanChangeProposal } from "@/lib/api";

// The coach's change card (#131, mockup 4): only what changes, applied only
// on Accept (all) or Review (the ones ticked); Not now leaves nothing behind.

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: {} }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ sendChat: vi.fn(), applyPlanChange: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  sendChat: api.sendChat,
  applyPlanChange: api.applyPlanChange,
  getTrainingLoad: () => Promise.reject(new Error("not under test")),
}));

const { Chat } = await import("@/app/chat");
const { ApiError } = await import("@/lib/api");

const MOVE = { type: "move" as const, planned_id: 2, date: "2026-11-27" };
const SKIP = { type: "remove" as const, planned_id: 3 };
const LIGHTER = { type: "lighter" as const, week: 2, sessions: [{ planned_id: 5, duration_min: 30 }] };
const PROPOSAL: PlanChangeProposal = {
  change_proposal: true,
  stored: false,
  plan: { id: 7, name: "6 weeks to a red", start_date: "2026-11-23", weeks: 6, end_date: "2027-01-03" },
  version: "abc123",
  reason: "A calmer end to the week, and a lighter week 2.",
  changes: [
    { index: 0, type: "move", label: "Move", description: "Move Thursday's Easy run to Friday" },
    { index: 1, type: "remove", label: "Skip", description: "Skip Saturday's Hangboard" },
    { index: 2, type: "lighter", label: "Lighter", description: "Make week 2 lighter: Tuesday's Easy run 40 → 30 min" },
  ],
  warnings: ["How much lighter has no sourced number yet (L2b, needs source)."],
  accept: { version: "abc123", changes: [MOVE, SKIP, LIGHTER], context: { available_days: ["friday"] } },
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  api.sendChat.mockResolvedValue({
    reply: "Here's what I'd change. Nothing changes until you accept it.",
    history: [{ role: "user", content: "Move Thursday's run" }, { role: "assistant", content: [{ type: "text", text: "…" }] }],
    conversation_id: "c1",
    logged_sessions: [],
    change_proposals: [PROPOSAL],
  });
  api.applyPlanChange.mockResolvedValue({ plan: { id: 7 }, applied: [] });
});

async function chatWithChange() {
  const user = userEvent.setup();
  render(<Chat />);
  await user.type(await screen.findByLabelText("Message"), "Move Thursday's run{Enter}");
  const card = await screen.findByRole("region", { name: "Proposed change: 6 weeks to a red" });
  return { user, card };
}

const lastHistory = () => {
  const calls = api.sendChat.mock.calls;
  return JSON.stringify(calls[calls.length - 1][1]);
};

describe("a change proposal in Coach", () => {
  it("shows only the changes, the coach's reason and the warnings, and applies nothing yet", async () => {
    const { card } = await chatWithChange();
    expect(within(card).getByText("Proposed change · not saved yet")).toBeInTheDocument();
    const lines = within(within(card).getByRole("list", { name: "Changes" })).getAllByRole("listitem");
    expect(lines.map((l) => l.textContent)).toEqual([
      "MoveMove Thursday's Easy run to Friday",
      "SkipSkip Saturday's Hangboard",
      "LighterMake week 2 lighter: Tuesday's Easy run 40 → 30 min",
    ]);
    expect(within(card).getByText(PROPOSAL.reason)).toBeInTheDocument();
    expect(within(card).getByText(/L2b, needs source/)).toBeInTheDocument();
    for (const name of ["Accept", "Review", "Not now"]) {
      expect(within(card).getByRole("button", { name })).toHaveClass("min-h-11");
    }
    // An opaque card: the conversation never shows through behind it.
    expect(card).toHaveClass("bg-surface");
    expect(api.applyPlanChange).not.toHaveBeenCalled();
  });

  it("Accept applies every change, then links to the plan and tells the coach", async () => {
    const { user, card } = await chatWithChange();
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(api.applyPlanChange).toHaveBeenCalledWith(7, PROPOSAL.accept);
    expect(await within(card).findByText("Plan updated")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Open the plan/ })).toHaveAttribute("href", "/plan");
    expect(within(card).queryByRole("button", { name: "Accept" })).toBeNull();
    await user.type(screen.getByLabelText("Message"), "Thanks{Enter}");
    expect(lastHistory()).toContain(
      "[User accepted the plan change: Move Thursday's Easy run to Friday; Skip Saturday's Hangboard; " +
        "Make week 2 lighter: Tuesday's Easy run 40 → 30 min (plan id 7). It is saved.]",
    );
  });

  it("Review shows a checkbox per change and applies only the ticked ones", async () => {
    const { user, card } = await chatWithChange();
    await user.click(within(card).getByRole("button", { name: "Review" }));
    const boxes = within(card).getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(boxes[0].closest("label")).toHaveClass("min-h-11");

    await user.click(within(card).getByRole("checkbox", { name: /Skip Saturday's Hangboard/ }));
    await user.click(within(card).getByRole("button", { name: "Accept 2 of 3" }));

    expect(api.applyPlanChange).toHaveBeenCalledWith(7, { ...PROPOSAL.accept, changes: [MOVE, LIGHTER] });
    expect(await within(card).findByText("Plan updated")).toBeInTheDocument();
    expect(within(card).queryByText("Skip Saturday's Hangboard")).toBeNull();
    await user.type(screen.getByLabelText("Message"), "OK{Enter}");
    expect(lastHistory()).toContain("They left out: Skip Saturday's Hangboard.");
  });

  it("can't accept an empty selection in Review", async () => {
    const { user, card } = await chatWithChange();
    await user.click(within(card).getByRole("button", { name: "Review" }));
    for (const box of within(card).getAllByRole("checkbox")) await user.click(box);
    expect(within(card).getByRole("button", { name: "Accept 0 of 3" })).toBeDisabled();
  });

  it("Not now leaves nothing behind and tells the coach", async () => {
    const { user, card } = await chatWithChange();
    await user.click(within(card).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region", { name: /Proposed change/ })).toBeNull();
    expect(api.applyPlanChange).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Message"), "OK{Enter}");
    expect(lastHistory()).toContain("[User dismissed the plan change: Move Thursday's Easy run to Friday;");
    expect(lastHistory()).toContain("Nothing was changed.]");
  });

  it("says so plainly when the plan changed since the proposal", async () => {
    api.applyPlanChange.mockRejectedValue(new ApiError("the plan has changed since this proposal", 409));
    const { user, card } = await chatWithChange();
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "Your plan has changed since this proposal. Ask the coach again.",
    );
    expect(within(card).getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("a single change has no Review step", async () => {
    api.sendChat.mockResolvedValue({
      reply: "…", history: [{ role: "user", content: "x" }], conversation_id: "c1", logged_sessions: [],
      change_proposals: [{ ...PROPOSAL, changes: PROPOSAL.changes.slice(0, 1), warnings: [],
                           accept: { ...PROPOSAL.accept, changes: [MOVE] } }],
    });
    const { card } = await chatWithChange();
    expect(within(card).queryByRole("button", { name: "Review" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Not now" })).toBeInTheDocument();
  });
});
