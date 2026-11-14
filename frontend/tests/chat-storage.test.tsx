import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = { getSession: vi.fn(), signOut: vi.fn() };
let userId: string | null = null;
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth }),
  accessToken: async () => "tok",
  currentUserId: async () => userId,
}));
const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => router }));

const { chatKey, clearSavedChats, loadChat, saveChat } = await import("@/lib/chat-storage");
const { Chat } = await import("@/app/chat");
const { TopBar } = await import("@/components/nav");
const { getSessions } = await import("@/lib/api");

const chatWith = (text: string) => ({
  items: [{ id: "1", role: "user", text }],
  history: [{ role: "user", content: text }],
  conversationId: null,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  auth.signOut.mockResolvedValue({ error: null });
  userId = null;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("chat storage", () => {
  it("keeps each user's chat under their own key", () => {
    saveChat("alice", chatWith("alice's run"));
    expect(loadChat("alice")).toEqual(chatWith("alice's run"));
    expect(loadChat("bob")).toBeNull();
    expect(chatKey("alice")).not.toBe(chatKey("bob"));
  });

  it("clears every saved chat but leaves other settings alone", () => {
    saveChat("alice", chatWith("a"));
    saveChat("bob", chatWith("b"));
    localStorage.setItem("treningsagent.chat.v2", "{}"); // from before chats were per user
    localStorage.setItem("treningsagent.theme", "dark");

    clearSavedChats();

    expect(Object.keys(localStorage)).toEqual(["treningsagent.theme"]);
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(loadChat("alice")).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("Chat", () => {
  it("restores the signed-in user's own chat", async () => {
    saveChat("alice", chatWith("Ran 12 km, knee felt off"));
    userId = "alice";
    render(<Chat />);
    expect(await screen.findByText("Ran 12 km, knee felt off")).toBeInTheDocument();
  });

  it("never shows another user's chat on the same browser", async () => {
    saveChat("alice", chatWith("Ran 12 km, knee felt off"));
    userId = "bob";
    render(<Chat />);
    expect(await screen.findByText("How did training go?")).toBeInTheDocument();
    expect(screen.queryByText("Ran 12 km, knee felt off")).toBeNull();
  });

  it("drops a chat saved before chats were per user", async () => {
    localStorage.setItem("treningsagent.chat.v2", JSON.stringify(chatWith("whose is this?")));
    userId = "bob";
    render(<Chat />);
    expect(await screen.findByText("How did training go?")).toBeInTheDocument();
    expect(screen.queryByText("whose is this?")).toBeNull();
    expect(localStorage.getItem("treningsagent.chat.v2")).toBeNull();
  });
});

describe("signing out", () => {
  it("clears the saved chat before signing out", async () => {
    saveChat("alice", chatWith("private"));
    render(<TopBar />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(loadChat("alice")).toBeNull();
    expect(auth.signOut).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/sign-in");
  });

  it("clears the saved chat when the backend ends the session (401)", async () => {
    saveChat("alice", chatWith("private"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    vi.stubGlobal("location", { ...window.location, origin: "http://localhost:3000", replace: vi.fn() });
    await expect(getSessions(7)).rejects.toMatchObject({ status: 401 });
    expect(loadChat("alice")).toBeNull();
  });
});
