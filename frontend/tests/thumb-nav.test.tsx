import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/api";

const nav = vi.hoisted(() => ({ pathname: "/", replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ getSessions: vi.fn(), createSession: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getSessions: api.getSessions,
  createSession: api.createSession,
}));

const { TabBar, TopBar } = await import("@/components/nav");
const { YouView } = await import("@/app/you/you-view");
const { LogShortcuts, takeRepeatIntent } = await import("@/components/log-shortcuts");
const { LogView } = await import("@/app/log/log-view");

const RUN: Session = { id: 3, sport: "running", date: "2026-11-12", duration_min: 31, effort: 4, distance_km: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  nav.pathname = "/";
  auth.signOut.mockResolvedValue({});
  api.getSessions.mockResolvedValue([RUN]);
});

describe("the tab bar (N3)", () => {
  it("has five tabs with Log raised in the centre and You at the end", () => {
    render(<TabBar />);
    const tabs = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual(["Coach", "Sessions", "Log", "Dashboard", "You"]);
    expect(tabs.map((t) => t.getAttribute("href"))).toEqual(["/", "/sessions", "/log", "/dashboard", "/you"]);
    for (const t of tabs) expect(t).toHaveClass("h-14"); // 56 px tall, above 44
    expect(tabs[2].querySelector(".bg-accent.size-12")).not.toBeNull(); // the raised Log
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
  });

  it("is not shown on the sign-in page", () => {
    nav.pathname = "/sign-in";
    const { container } = render(<TabBar />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the top bar on mobile (N3)", () => {
  it("signed in, moves theme, account and sign out off the top corner below md, but keeps discreet", () => {
    render(<TopBar />);
    const group = screen.getByTestId("top-bar-account");
    expect(group).toHaveClass("hidden", "md:flex");
    expect(within(group).getByRole("button", { name: /^Switch/ })).toBeInTheDocument();
    expect(within(group).getByRole("link", { name: "Account" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    const discreet = screen.getByRole("button", { name: /discreet mode/i });
    expect(group).not.toContainElement(discreet);
  });

  it("signed out, keeps the theme switch visible (there is no You tab)", () => {
    nav.pathname = "/sign-in";
    render(<TopBar />);
    expect(screen.getByTestId("top-bar-account")).not.toHaveClass("hidden");
  });
});

describe("the You page", () => {
  it("has the theme switch, a way to Account, and Sign out in thumb reach", async () => {
    const user = userEvent.setup();
    render(<YouView />);
    expect(screen.getByRole("button", { name: /^Switch/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Account/ })).toHaveAttribute("href", "/account");
    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(signOut).toHaveClass("min-h-14");
    await user.click(signOut);
    expect(auth.signOut).toHaveBeenCalled();
    expect(nav.replace).toHaveBeenCalledWith("/sign-in");
  });
});

describe("the Coach log shortcuts", () => {
  it("offer Repeat (named after the last session) and Log a session, 44 px each", async () => {
    render(<LogShortcuts />);
    const repeat = await screen.findByRole("link", { name: "Repeat: Run 5 km" });
    const log = screen.getByRole("link", { name: "Log a session" });
    for (const l of [repeat, log]) {
      expect(l).toHaveAttribute("href", "/log");
      expect(l).toHaveClass("min-h-11");
    }
  });

  it("show only Log a session when there is nothing to repeat", async () => {
    api.getSessions.mockResolvedValue([]);
    render(<LogShortcuts />);
    expect(await screen.findByRole("link", { name: "Log a session" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Repeat/ })).not.toBeInTheDocument();
  });

  it("Repeat opens the Log form prefilled with the last session", async () => {
    render(<LogShortcuts />);
    const repeat = await screen.findByRole("link", { name: /^Repeat/ });
    repeat.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(repeat);
    document.body.innerHTML = "";

    render(<LogView />);
    expect(await screen.findByLabelText(/duration/i)).toHaveValue(31);
    expect(takeRepeatIntent()).toBe(false); // used once
  });
});
