// iPhone layout: the Log and edit forms' date field stays in its cell, and the
// tab bar room is set once in the shared layout. tests/iphone-css.test.ts
// checks the CSS these classes compile to.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SessionForm } from "@/components/session-form";
import type { Session } from "@/lib/api";

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: {} }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));

const { SessionSheet } = await import("@/app/sessions/session-sheet");

const PAIR = "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";
const RUN: Session = { id: 7, sport: "running", date: "2026-11-14", duration_min: 30, effort: 5, distance_km: 5 };
const src = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

function expectDateFits() {
  const date = screen.getByLabelText("Date");
  for (const c of ["block", "w-full", "min-w-0", "min-h-11", "px-3", "appearance-none", "text-left"]) {
    expect(date).toHaveClass(c);
  }
  // Same height and padding as Duration next to it.
  const duration = screen.getByLabelText("Duration (min)");
  for (const c of ["min-h-11", "px-3", "rounded-md", "text-base"]) expect(duration).toHaveClass(c);
  // Both rows are two shrinkable columns, not grid-cols-2 (minmax(auto, 1fr)).
  const rows = [date, screen.getByLabelText("Distance (km)")].map((el) => el.parentElement!.parentElement!);
  for (const row of rows) {
    expect(row).toHaveClass(PAIR);
    expect(row).not.toHaveClass("grid-cols-2");
  }
}

describe("date field", () => {
  it("stays inside its cell on the Log form", () => {
    render(<SessionForm onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Run" }));
    expectDateFits();
  });

  it("stays inside its cell in the Sessions edit sheet", () => {
    render(<SessionSheet session={RUN} startEditing onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Edit session" })).toBeInTheDocument();
    expectDateFits();
  });
});

describe("tab bar room", () => {
  it("is set once on <main> in the shared layout, for phones only", () => {
    expect(src("app/layout.tsx")).toMatch(/<main id="main" className="[^"]*\bpb-tab-bar\b[^"]*\bmd:pb-0\b/);
  });

  it("is no longer guessed per page", () => {
    for (const page of [
      "app/log/log-view.tsx",
      "app/sessions/sessions-view.tsx",
      "app/dashboard/dashboard-view.tsx",
      "app/you/you-view.tsx",
      "app/review/review-view.tsx",
      "app/account/page.tsx",
      "app/chat.tsx",
    ]) {
      expect(src(page), page).not.toMatch(/\bpb-24\b|\bpb-64\b|\bbottom-14\b/);
    }
  });

  it("keeps the Coach composer above the tab bar and the home indicator", () => {
    expect(src("app/chat.tsx")).toMatch(/fixed inset-x-0 bottom-tab-bar\b[^"]*\bmd:bottom-0\b/);
  });

  it("matches the tab bar's own row height", () => {
    expect(src("components/nav.tsx")).toContain("h-(--tab-bar-h)");
  });
});
