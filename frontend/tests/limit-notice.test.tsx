import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #144: a usage-limit notice describes a moment, not the conversation. It goes
// away once a message succeeds, is never saved, and isn't restored after a
// reload (the next message shows it again only if the backend still says 429).

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: {} }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ sendChat: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
  getTrainingLoad: () => Promise.reject(new Error("not under test")),
  getProfile: () => Promise.reject(new Error("not under test")),
}));

const { Chat } = await import("@/app/chat");
const { LimitError } = await import("@/lib/api");
const { loadChat, saveChat } = await import("@/lib/chat-storage");

const DAILY = { limit: "daily" as const, retry_after_minutes: 300 };
const OK = {
  reply: "Nice run!", history: [{ role: "user", content: "x" }, { role: "assistant", content: [] }],
  conversation_id: "c1", logged_sessions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

async function hitTheLimit() {
  api.sendChat.mockRejectedValueOnce(new LimitError(DAILY, 429));
  const user = userEvent.setup();
  render(<Chat />);
  await user.type(await screen.findByLabelText("Message"), "Ran 5 km{Enter}");
  expect(await screen.findByText("That's today's coach time used")).toBeInTheDocument();
  return user;
}

describe("the usage-limit notice", () => {
  it("disappears after a successful message, and the composer works while it shows", async () => {
    const user = await hitTheLimit();
    const input = screen.getByLabelText("Message");
    expect(input).toBeEnabled(); // you can try again while the notice shows
    api.sendChat.mockResolvedValueOnce(OK);
    await user.type(input, "Ran 5 km again{Enter}");
    expect(await screen.findByText("Nice run!")).toBeInTheDocument();
    expect(screen.queryByText("That's today's coach time used")).toBeNull();
  });

  it("is never saved, so a reload doesn't bring it back", async () => {
    await hitTheLimit();
    await waitFor(() => expect(loadChat("user-1")).not.toBeNull());
    expect(JSON.stringify(loadChat("user-1"))).not.toMatch(/"role":"error"|daily/);
  });

  it("is not restored from a chat saved before this fix", async () => {
    saveChat("user-1", {
      history: OK.history, conversationId: "c1",
      items: [
        { id: "u1", role: "user", text: "Hi" },
        { id: "a1", role: "agent", text: "Hello!", logged: [] },
        { id: "e1", role: "error", text: "limit", offline: false, retry: "Ran 5 km", limit: DAILY },
      ],
    });
    render(<Chat />);
    expect(await screen.findByText("Hello!")).toBeInTheDocument();
    expect(screen.queryByText("That's today's coach time used")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
