import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/api";

const auth = { getSession: vi.fn(), signInWithOtp: vi.fn(), signInWithPassword: vi.fn() };
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth }),
  accessToken: async () => "tok",
}));
const api = vi.hoisted(() => ({ getSessions: vi.fn(), sendChat: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getSessions: api.getSessions,
  sendChat: api.sendChat,
}));

const { ApiError } = await import("@/lib/api");
const { ErrorState, HIT_AREA_Y } = await import("@/components/states");
const { Chat } = await import("@/app/chat");
const { SessionsView } = await import("@/app/sessions/sessions-view");
const { SessionForm } = await import("@/components/session-form");
const { SignInForm } = await import("@/app/sign-in/sign-in-form");

/** A control reaches 44 px if it is at least min-h-11 itself, or a min-h-9/10
 *  pill whose hit area grows 4 px above and below (HIT_AREA_Y). */
function reaches44(el: HTMLElement) {
  const c = el.className;
  if (/\bmin-h-(11|12|14)\b/.test(c)) return true;
  return /\bmin-h-(9|10)\b/.test(c) && HIT_AREA_Y.split(" ").every((cls) => c.includes(cls));
}

const RUN: Session = { id: 1, sport: "running", date: "2026-11-10", duration_min: 30, effort: 5 } as Session;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("tap targets (DESIGN.md: at least 44 px)", () => {
  it("the hit-area helper adds exactly 4 px above and below", () => {
    expect(HIT_AREA_Y).toContain("before:-inset-y-1"); // 0.25 rem = 4 px each side: 36 + 8 = 44
  });

  it("Coach quick replies", async () => {
    render(<Chat />);
    const group = await screen.findByRole("group", { name: "Quick replies" });
    const chips = within(group).getAllByRole("button");
    expect(chips).toHaveLength(4);
    chips.forEach((b) => expect(reaches44(b)).toBe(true));
  });

  it("Sessions filter", async () => {
    api.getSessions.mockResolvedValue([RUN]);
    render(<SessionsView />);
    const group = await screen.findByRole("radiogroup", { name: "Show" });
    within(group).getAllByRole("radio").forEach((r) => expect(reaches44(r)).toBe(true));
  });

  it("Log form default style", async () => {
    render(<SessionForm onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Climb" }));
    const group = screen.getByRole("radiogroup", { name: "Default style" });
    within(group).getAllByRole("radio").forEach((r) => expect(reaches44(r)).toBe(true));
  });

  it("Sign-in method", () => {
    render(<SignInForm />);
    const group = screen.getByRole("radiogroup", { name: "Sign-in method" });
    within(group).getAllByRole("radio").forEach((r) => expect(reaches44(r)).toBe(true));
  });
});

describe("offline message", () => {
  const PLAIN = "Check your connection and try again.";

  it("is the same plain advice in the chat as on the other pages", async () => {
    api.sendChat.mockRejectedValue(new ApiError("Can't reach the backend.", null));
    render(<Chat />);
    await userEvent.type(await screen.findByLabelText("Message"), "Ran 5 km{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(PLAIN);
    expect(alert).not.toHaveTextContent(/API is running/);

    render(<ErrorState offline message="" onRetry={vi.fn()} />);
    expect(screen.getAllByText(PLAIN)).toHaveLength(2);
  });
});
