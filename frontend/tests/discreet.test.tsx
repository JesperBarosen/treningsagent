import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/api";

const events = vi.hoisted(() => ({ recordEvent: vi.fn() }));
vi.mock("@/lib/events", () => events);

const { DiscreetToggle } = await import("@/components/discreet-toggle");
const { SessionRow } = await import("@/components/session-card");
const { DISCREET_KEY, DISCREET_SCRIPT, readDiscreet } = await import("@/lib/discreet");

const RUN: Session = {
  id: 1,
  sport: "running",
  date: "2026-11-10",
  duration_min: 50,
  effort: 7,
  distance_km: 9.2,
};

const root = () => document.documentElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  root().removeAttribute("data-discreet");
});

describe("the discreet toggle", () => {
  it("turns discreet mode on and off, remembers it, and records the change", async () => {
    const user = userEvent.setup();
    render(<DiscreetToggle />);
    const button = screen.getByRole("button", { name: /discreet mode/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveClass("min-h-11", "min-w-11");
    // The label says it is visual only.
    expect(button).toHaveAccessibleName(/screen readers still read them/);

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(root()).toHaveAttribute("data-discreet");
    expect(localStorage.getItem(DISCREET_KEY)).toBe("on");
    expect(readDiscreet()).toBe(true);
    expect(events.recordEvent).toHaveBeenLastCalledWith("discreet_mode_on");
    expect(button).toHaveTextContent("Discreet"); // the pill's word (shown from sm)

    await user.click(button);
    expect(root()).not.toHaveAttribute("data-discreet");
    expect(localStorage.getItem(DISCREET_KEY)).toBeNull();
    expect(events.recordEvent).toHaveBeenLastCalledWith("discreet_mode_off");
  });

  it("is applied before the first paint by the head script", () => {
    localStorage.setItem(DISCREET_KEY, "on");
    new Function(DISCREET_SCRIPT)();
    expect(root()).toHaveAttribute("data-discreet");
  });
});

describe("tap to reveal", () => {
  it("marks a session row's numbers as sensitive", () => {
    render(<SessionRow session={RUN} onOpen={() => {}} />);
    expect(screen.getByText(/9\.2 km/)).toHaveAttribute("data-sensitive");
  });

  it("with discreet mode on, the first tap reveals a row and the second opens it", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <>
        <DiscreetToggle />
        <SessionRow session={RUN} onOpen={onOpen} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /discreet mode/i }));
    const row = screen.getByRole("button", { name: /Show details/ });

    await user.click(row);
    expect(onOpen).not.toHaveBeenCalled();
    expect(row).toHaveAttribute("data-revealed");

    await user.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("with discreet mode off, a tap acts at once", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <>
        <DiscreetToggle />
        <SessionRow session={RUN} onOpen={onOpen} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /Show details/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("turning it on again hides what was revealed", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DiscreetToggle />
        <SessionRow session={RUN} onOpen={() => {}} />
      </>,
    );
    const toggle = screen.getByRole("button", { name: /discreet mode/i });
    const row = screen.getByRole("button", { name: /Show details/ });
    await user.click(toggle);
    await user.click(row);
    expect(row).toHaveAttribute("data-revealed");
    await user.click(toggle);
    await user.click(toggle);
    expect(row).not.toHaveAttribute("data-revealed");
  });
});

describe("globals.css", () => {
  const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
  it("blurs sensitive content and chart value labels only in discreet mode", () => {
    expect(css).toMatch(/:root\[data-discreet\] \[data-sensitive\] \{\s*filter: blur/);
    expect(css).toContain(":root[data-discreet] [data-revealed] [data-sensitive]");
    expect(css).toContain(":root[data-discreet] .recharts-yAxis .recharts-cartesian-axis-tick-value");
  });
});
