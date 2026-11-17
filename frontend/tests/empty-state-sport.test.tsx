// #110: an empty state filtered to one sport names that sport, in the title too.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { noneYetTitle } from "@/lib/format";

const getSessions = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getSessions,
}));

const { SessionsView } = await import("@/app/sessions/sessions-view");

describe("empty states name the chosen sport", () => {
  it("has a title for every sport", () => {
    expect(["running", "climbing", "strength", "other"].map((s) => noneYetTitle(s as "running"))).toEqual([
      "No runs yet",
      "No climbing yet",
      "No strength training yet",
      "No other training yet",
    ]);
  });

  it.each([
    ["Climbing", "No climbing yet", /No climbing in the last 8 weeks/],
    ["Strength", "No strength training yet", /No strength training in the last 8 weeks/],
    ["Other", "No other training yet", /No other training in the last 8 weeks/],
  ])("Sessions filtered to %s", async (filter, title, text) => {
    getSessions.mockResolvedValue([{ id: 1, sport: "running", date: "2026-11-10", duration_min: 30, effort: 5 }]);
    render(<SessionsView />);
    await userEvent.click(await screen.findByRole("radio", { name: filter }));
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
