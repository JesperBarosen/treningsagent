// Starting and ending a break must work at every width. The break section used
// to live only on the You tab, which is a phone tab (hidden from md). It is now
// also on the Account page, which the top bar's key icon opens from md.
// jsdom applies no media queries, so "desktop width" is checked through the
// responsive classes: nothing between the break control and the page is hidden
// from md, and the key icon sits in the part of the top bar shown from md.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pause } from "@/lib/api";

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: { signOut: vi.fn(), updateUser: vi.fn() } }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ getPause: vi.fn(), endPause: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getPause: api.getPause,
  endPause: api.endPause,
}));

const { default: AccountPage } = await import("@/app/account/page");
const { TabBar, TopBar } = await import("@/components/nav");

/** Classes that hide an element at desktop width (from md, 768 px). */
const HIDDEN_ON_DESKTOP = /(^|\s)(hidden|md:hidden|sr-only)(\s|$)/;

function hiddenOnDesktop(el: HTMLElement | null): boolean {
  for (let node = el; node; node = node.parentElement) {
    const cls = node.getAttribute("class") ?? "";
    // "hidden md:flex" is shown from md, so only a bare hidden without an md: display counts.
    const shownFromMd = /(^|\s)md:(flex|block|grid|inline-flex)(\s|$)/.test(cls);
    if (HIDDEN_ON_DESKTOP.test(cls) && !shownFromMd) return true;
  }
  return false;
}

const ACTIVE: Pause = {
  id: 1,
  start_date: "2026-11-10",
  planned_end: null,
  ended_on: null,
  reason: "injury",
  body_part: null,
  pain: null,
  note: null,
  resume_choice: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getPause.mockResolvedValue({ active: null });
});

describe("breaks at desktop width", () => {
  it("the You tab is a phone tab (the gap this fixes), and the helper sees that", () => {
    render(<TabBar />);
    expect(hiddenOnDesktop(screen.getByRole("link", { name: "You" }))).toBe(true);
  });

  it("the top bar's key icon, shown from md, opens the Account page", () => {
    render(<TopBar />);
    const key = screen.getByRole("link", { name: "Account" });
    expect(key).toHaveAttribute("href", "/account");
    expect(hiddenOnDesktop(key)).toBe(false);
  });

  it("the Account page renders the break control, not hidden from md", async () => {
    render(<AccountPage />);
    const section = screen.getByRole("region", { name: "A break from training" });
    const start = await within(section).findByRole("button", { name: "Take a break" });
    expect(hiddenOnDesktop(start)).toBe(false);
    await userEvent.setup().click(start); // opens the form to start one
    expect(within(section).queryByRole("button", { name: "Take a break" })).toBeNull();
  });

  it("shows an active break there, so it can be ended at desktop width", async () => {
    api.getPause.mockResolvedValue({ active: ACTIVE });
    render(<AccountPage />);
    const section = screen.getByRole("region", { name: "A break from training" });
    const end = await within(section).findByRole("button", { name: /End break/i });
    expect(hiddenOnDesktop(end)).toBe(false);
  });
});
