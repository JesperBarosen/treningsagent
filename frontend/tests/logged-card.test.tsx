import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/api";

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: {} }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({
  sendChat: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  sendChat: api.sendChat,
  updateSession: api.updateSession,
  deleteSession: api.deleteSession,
}));

const { Chat } = await import("@/app/chat");

const HISTORY = [
  { role: "user", content: "Ran 5 km in 30 min" },
  { role: "assistant", content: [{ type: "text", text: "Logged your run." }] },
];

const RUN: Session = { id: 7, sport: "running", date: "2026-11-14", duration_min: 30, effort: 5, distance_km: 5 };

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
  vi.clearAllMocks();
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  api.sendChat.mockResolvedValue({
    reply: "Logged your run.",
    history: HISTORY,
    conversation_id: "c1",
    logged_sessions: [RUN],
  });
});

async function logARun() {
  const user = userEvent.setup();
  render(<Chat />);
  await user.type(await screen.findByLabelText("Message"), "Ran 5 km in 30 min{Enter}");
  await screen.findByText("Logged your run.");
  return user;
}

describe("the chat's Logged card", () => {
  it("has 44 px Edit and Undo buttons instead of a link to Sessions", async () => {
    await logARun();
    for (const name of ["Edit", "Undo"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("min-h-11");
    }
    expect(screen.queryByRole("link", { name: "Open sessions" })).not.toBeInTheDocument();
  });

  it("Edit opens that session's sheet in edit mode and updates the card in place", async () => {
    api.updateSession.mockResolvedValue({ ...RUN, duration_min: 35 });
    const user = await logARun();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const sheet = screen.getByRole("dialog", { hidden: true });
    expect(within(sheet).getByRole("heading", { name: "Edit session" })).toBeInTheDocument();
    const duration = within(sheet).getByLabelText(/duration/i);
    await user.clear(duration);
    await user.type(duration, "35");
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));

    expect(api.updateSession).toHaveBeenCalledWith(7, expect.objectContaining({ duration_min: 35 }));
    expect(await screen.findByText(/Edited ·/)).toBeInTheDocument();
    expect(screen.getByText(/35 min/)).toBeInTheDocument();
  });

  it("Cancel in the edit form closes the sheet without changes", async () => {
    const user = await logARun();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Cancel", hidden: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.updateSession).not.toHaveBeenCalled();
    expect(screen.getByText(/Logged ·/)).toBeInTheDocument();
  });

  it("Undo needs a second tap, then deletes the session and marks the card", async () => {
    api.deleteSession.mockResolvedValue(undefined);
    const user = await logARun();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(api.deleteSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(api.deleteSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(api.deleteSession).toHaveBeenCalledWith(7);
    expect(await screen.findByText("Undone · removed from your log")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows an error and keeps the session when Undo fails", async () => {
    const { ApiError } = await import("@/lib/api");
    api.deleteSession.mockRejectedValue(new ApiError("Session not found.", 404));
    const user = await logARun();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Session not found.");
    expect(screen.queryByText(/Undone/)).not.toBeInTheDocument();
  });
});

describe("telling the coach about changes made on the card (#63)", () => {
  /** The history the chat sends with the next message. */
  async function nextHistory(user: Awaited<ReturnType<typeof logARun>>) {
    await user.type(screen.getByLabelText("Message"), "Ran 5 km in 30 min{Enter}");
    await screen.findAllByText("Logged your run.");
    return api.sendChat.mock.calls[1][1] as { role: string; content: unknown }[];
  }

  it("appends a 'removed' note to the history after Undo", async () => {
    api.deleteSession.mockResolvedValue(undefined);
    const user = await logARun();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("Undone · removed from your log");

    const history = await nextHistory(user);
    expect(history.slice(0, 2)).toEqual(HISTORY); // earlier turns are untouched
    expect(history[2]).toEqual({
      role: "user",
      content:
        "[User removed the session: Run · 5 km · 30 min · effort 5 on 2026-11-14 (id 7). It is no longer in their log.]",
    });
  });

  it("appends an 'edited' note with the new values after Edit", async () => {
    api.updateSession.mockResolvedValue({ ...RUN, duration_min: 35 });
    const user = await logARun();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = screen.getByRole("dialog", { hidden: true });
    const duration = within(sheet).getByLabelText(/duration/i);
    await user.clear(duration);
    await user.type(duration, "35");
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Edited ·/);

    const history = await nextHistory(user);
    expect(history[2]).toEqual({
      role: "user",
      content: "[User edited the session to: Run · 5 km · 35 min · effort 5 on 2026-11-14 (id 7).]",
    });
  });

  it("adds no note when nothing changed (Cancel)", async () => {
    const user = await logARun();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Cancel", hidden: true }));
    const history = await nextHistory(user);
    expect(history).toEqual(HISTORY);
  });
});
