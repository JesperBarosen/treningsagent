import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft, Session } from "@/lib/api";

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: {} }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ sendChat: vi.fn(), createSession: vi.fn(), getSessions: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  sendChat: api.sendChat,
  createSession: api.createSession,
  getSessions: api.getSessions,
  getTrainingLoad: () => Promise.reject(new Error("not under test")),
}));

const { Chat } = await import("@/app/chat");
const { LogView } = await import("@/app/log/log-view");
const { AutoSaveSetting } = await import("@/app/account/auto-save-setting");
const drafts = await import("@/lib/chat-drafts");

const HISTORY = [
  { role: "user", content: "Ran 8 km in 45 min yesterday, effort 5" },
  { role: "assistant", content: [{ type: "text", text: "Ready to save." }] },
];
const DRAFT: Draft = {
  draft: true,
  sport: "running",
  date: "2026-11-13",
  duration_min: 45,
  effort: 5,
  notes: null,
  distance_km: 8,
};
const SAVED: Session = { ...DRAFT, id: 42 } as Session;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  api.sendChat.mockResolvedValue({
    reply: "Ready to save.",
    history: HISTORY,
    conversation_id: "c1",
    logged_sessions: [],
    drafts: [DRAFT],
  });
  api.createSession.mockResolvedValue(SAVED);
  api.getSessions.mockResolvedValue([]);
});

async function chatWithDraft() {
  const user = userEvent.setup();
  render(<Chat />);
  await user.type(await screen.findByLabelText("Message"), "Ran 8 km in 45 min yesterday{Enter}");
  const card = await screen.findByRole("region", { name: /^Draft: Run · 8 km · 45 min/ });
  return { user, card };
}

const lastHistory = () => {
  const calls = api.sendChat.mock.calls;
  return calls[calls.length - 1][1] as { role: string; content: unknown }[];
};

describe("a chat draft (N4)", () => {
  it("is shown as not saved, with Save, Review and Dismiss at 44 px, and blurs in discreet mode", async () => {
    const { card } = await chatWithDraft();
    expect(within(card).getByText(/Not saved yet/)).toBeInTheDocument();
    expect(within(card).getByText(/Run · 8 km · 45 min/)).toHaveAttribute("data-sensitive");
    expect(within(card).getByRole("button", { name: "Save" })).toHaveClass("min-h-11");
    expect(within(card).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/log");
    expect(within(card).getByRole("button", { name: "Dismiss draft" })).toHaveClass("size-11");
    expect(api.createSession).not.toHaveBeenCalled(); // nothing stored yet
    expect(api.sendChat.mock.calls[0][4]).toBe(false); // drafting is the default
  });

  it("Save stores it in one tap, turns it into a Logged card and tells the coach", async () => {
    const { user, card } = await chatWithDraft();
    await user.click(within(card).getByRole("button", { name: "Save" }));

    expect(api.createSession).toHaveBeenCalledWith({
      sport: "running", date: "2026-11-13", duration_min: 45, effort: 5, notes: null, distance_km: 8,
    });
    expect(await screen.findByText(/Logged ·/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Draft:/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument(); // like any logged session

    await user.type(screen.getByLabelText("Message"), "Thanks{Enter}");
    await screen.findAllByText("Ready to save.");
    expect(lastHistory().at(-1)).toEqual({
      role: "user",
      content: "[User saved the draft as: Run · 8 km · 45 min · effort 5 on 2026-11-13 (id 42).]",
    });
  });

  it("keeps the draft and shows the error when Save fails", async () => {
    const { ApiError } = await import("@/lib/api");
    api.createSession.mockRejectedValue(new ApiError("Network down.", null));
    const { user, card } = await chatWithDraft();
    await user.click(within(card).getByRole("button", { name: "Save" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Network down.");
    expect(screen.queryByText(/Logged ·/)).not.toBeInTheDocument();
  });

  it("Dismiss removes it, stores nothing and tells the coach", async () => {
    const { user, card } = await chatWithDraft();
    await user.click(within(card).getByRole("button", { name: "Dismiss draft" }));
    expect(screen.queryByRole("region", { name: /^Draft:/ })).not.toBeInTheDocument();
    expect(api.createSession).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Message"), "Never mind{Enter}");
    await screen.findAllByText("Ready to save.");
    expect(lastHistory().at(-1)).toEqual({
      role: "user",
      content: "[User dismissed the draft: Run · 8 km · 45 min · effort 5 on 2026-11-13. Nothing was stored.]",
    });
  });

  it("Review hands the draft to the Log form", async () => {
    const { card } = await chatWithDraft();
    within(card).getByRole("link", { name: "Review" }).addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(within(card).getByRole("link", { name: "Review" }));
    const handed = drafts.parseHandedDraft(drafts.peekDraftForForm());
    expect(handed?.draft).toEqual(DRAFT);
  });

  it("asks the coach to save straight away when the setting is on", async () => {
    drafts.saveAutoSave(true);
    const user = userEvent.setup();
    render(<Chat />);
    await user.type(await screen.findByLabelText("Message"), "Ran{Enter}");
    await screen.findByText("Ready to save.");
    expect(api.sendChat.mock.calls[0][4]).toBe(true);
  });
});

describe("the Log form opened from a draft", () => {
  const ref = { itemId: "item-1", key: "draft-1" };

  it("is prefilled with the draft, its date included, and reports the save back", async () => {
    drafts.handDraftToForm(ref, DRAFT);
    const user = userEvent.setup();
    render(<LogView />);

    expect(await screen.findByText(/Filled in from the coach/)).toBeInTheDocument();
    expect(screen.getByLabelText(/duration/i)).toHaveValue(45);
    expect(screen.getByLabelText(/^date/i)).toHaveValue("2026-11-13"); // not today

    await user.click(screen.getByRole("button", { name: "Log session" }));
    expect(api.createSession).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-11-13", duration_min: 45 }));
    expect(drafts.takeSavedDraft()).toEqual({ ref, session: SAVED });
    expect(drafts.peekDraftForForm()).toBeNull(); // used once
    expect(screen.queryByText(/Filled in from the coach/)).not.toBeInTheDocument();
  });

  it("the chat marks the draft saved when it opens again", async () => {
    // A chat with an open draft; the chat saves itself to localStorage.
    const { card } = await chatWithDraft();
    expect(card).toBeInTheDocument();
    const key = Object.keys(localStorage).find((k) => k.startsWith("treningsagent.chat.") && k.endsWith("user-1"));
    const convo = JSON.parse(localStorage.getItem(key!)!);
    const agent = convo.items.find((i: { role: string }) => i.role === "agent");
    const draftRef = { itemId: agent.id, key: agent.drafts[0].key };

    // The Log form saved it; then the user comes back to Coach.
    drafts.reportDraftSaved(draftRef, SAVED);
    document.body.innerHTML = "";
    render(<Chat />);

    expect(await screen.findByText(/Logged ·/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Draft:/ })).not.toBeInTheDocument();
    expect(drafts.takeSavedDraft()).toBeNull(); // applied once
  });
});

describe("the auto-save setting", () => {
  it("is off by default and remembered per device", async () => {
    const user = userEvent.setup();
    render(<AutoSaveSetting />);
    const box = screen.getByRole("checkbox", { name: /Save chat sessions without asking/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    expect(drafts.readAutoSave()).toBe(true);
    await user.click(box);
    expect(drafts.readAutoSave()).toBe(false);
  });
});
