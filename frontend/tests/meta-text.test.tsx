import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ValueTick } from "@/app/dashboard/charts";
import { LoggedSessionCard, SessionRow } from "@/components/session-card";
import type { Session } from "@/lib/api";

// #56 (design-visual V-S4): captions that carry information use the 13 px
// "meta" step; chart ticks stay 12 px.

const RUN: Session = { id: 1, sport: "running", date: "2026-11-10", duration_min: 30, effort: 5, distance_km: 5 };

describe("13 px informative captions (#56)", () => {
  it("dates on session rows and on the Logged card", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 15));
    render(<SessionRow session={RUN} onOpen={() => {}} />);
    expect(screen.getByText("Tue 10 Nov")).toHaveClass("text-meta");
    render(<LoggedSessionCard session={RUN} onEdit={() => {}} onUndone={() => {}} />);
    expect(screen.getByText(/Logged · /)).toHaveClass("text-meta");
    vi.useRealTimers();
  });

  it("chart tick values stay 12 px", () => {
    const { container } = render(
      <svg>
        <ValueTick x={0} y={0} payload={{ value: 1500 }} format={String} />
      </svg>,
    );
    expect(container.querySelector("text")).toHaveAttribute("font-size", "12");
  });
});
