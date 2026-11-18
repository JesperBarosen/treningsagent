import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Usage limits in the app (#129, #130): the backend says which limit was hit,
// lib/limits.ts has the words, the chat shows them kindly.

vi.mock("next/navigation", () => ({
  usePathname: () => "/closed-beta",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));

const { getSessions, LimitError, sendChat } = await import("@/lib/api");
const { Chat } = await import("@/app/chat");
const { ClosedBetaView } = await import("@/app/closed-beta/closed-beta-view");
const { limitMessage, waitText } = await import("@/lib/limits");
const { PUBLIC_PATHS } = await import("@/lib/supabase/config");

const MONTH =
  "This month's free coach budget is used up. Treningsagent is built and paid for by one student, and every " +
  "message costs real money. Logging still works, and the coach is back on the 1st.";

function answer(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

const replace = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { origin: "http://localhost:3000", replace } });
});
afterEach(() => vi.unstubAllGlobals());

describe("the limit messages", () => {
  it("say what happened, when the coach is back, and that logging still works", () => {
    expect(limitMessage({ limit: "global_month" }).text).toBe(MONTH);
    expect(limitMessage({ limit: "global_day" }).text).toBe(
      "The coach is taking a break for the rest of the day. Logging still works.",
    );
    expect(limitMessage({ limit: "hourly", retry_after_minutes: 12 }).text).toBe(
      "You can message the coach again in 12 minutes. Logging still works.",
    );
    expect(limitMessage({ limit: "daily", retry_after_minutes: 300 }).text).toMatch(/in about 5 hours, tomorrow/);
    expect(waitText(1)).toBe("in a minute");
    expect(waitText(61)).toBe("in about an hour");
  });

  it("never blame", () => {
    for (const limit of ["global_month", "global_day", "hourly", "daily", "closed_beta"] as const) {
      const { title, text } = limitMessage({ limit, retry_after_minutes: 30 });
      expect(`${title} ${text}`).not.toMatch(/you exceeded|too many|abuse|violat|banned|your fault/i);
    }
  });
});

describe("the API client", () => {
  it("turns a limit body into a LimitError with the words to show", async () => {
    answer(429, { limit: "hourly", retry_after_minutes: 7 });
    const err = await sendChat("hi", [], null).catch((e) => e);
    expect(err).toBeInstanceOf(LimitError);
    expect(err.limit).toEqual({ limit: "hourly", retry_after_minutes: 7 });
    expect(err.status).toBe(429);
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends an uninvited user to the closed-beta page, which needs no sign-in", async () => {
    answer(403, { limit: "closed_beta" });
    await expect(getSessions()).rejects.toBeInstanceOf(LimitError);
    expect(replace).toHaveBeenCalledWith("http://localhost:3000/closed-beta");
    expect(PUBLIC_PATHS).toContain("/closed-beta");
  });

  it("keeps other errors as they were", async () => {
    answer(422, { detail: "effort must be between 1 and 10" });
    const err = await getSessions().catch((e) => e);
    expect(err).not.toBeInstanceOf(LimitError);
    expect(err.message).toBe("effort must be between 1 and 10");
  });
});

describe("in the chat", () => {
  async function chatHitting(body: object) {
    answer(429, body);
    const user = userEvent.setup();
    render(<Chat />);
    await user.type(await screen.findByLabelText("Message"), "How was my week?{Enter}");
    return screen.findByRole("status");
  }

  it("shows the monthly budget message with a Support button when SUPPORT_URL is set", async () => {
    const notice = await chatHitting({ limit: "global_month", support_url: "https://example.com/support" });
    expect(notice).toHaveTextContent(MONTH);
    const support = within(notice).getByRole("link", { name: "Support the app" });
    expect(support).toHaveAttribute("href", "https://example.com/support");
    expect(support).toHaveAttribute("target", "_blank");
    expect(support).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(notice).getByRole("link", { name: "Log a session" })).toHaveAttribute("href", "/log");
    expect(screen.queryByRole("alert")).toBeNull(); // not shown as an error
  });

  it("shows no Support button without SUPPORT_URL", async () => {
    const notice = await chatHitting({ limit: "global_month" });
    expect(within(notice).queryByRole("link", { name: "Support the app" })).toBeNull();
  });

  it("shows the day break and the per-user limits kindly", async () => {
    expect(await chatHitting({ limit: "global_day" })).toHaveTextContent("taking a break for the rest of the day");
  });

  it("says when the hourly limit frees up", async () => {
    const notice = await chatHitting({ limit: "hourly", retry_after_minutes: 12 });
    expect(notice).toHaveTextContent("again in 12 minutes");
    expect(within(notice).queryByRole("link", { name: "Support the app" })).toBeNull();
  });
});

describe("the closed-beta page", () => {
  it("explains and lets the user sign out", () => {
    render(<ClosedBetaView />);
    expect(screen.getByRole("heading", { name: "The app is in closed beta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeInTheDocument();
  });
});
