import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { nextOutcome, SessionForm, today } from "@/components/session-form";
import type { Session } from "@/lib/api";

const pick = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("SessionForm", () => {
  it("asks for the sport first", () => {
    render(<SessionForm onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText("Duration (min)")).toBeNull();
    pick("Run");
    expect(screen.getByLabelText("Duration (min)")).toBeTruthy();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(today());
  });

  it("shows the pace live and submits a run", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SessionForm onSubmit={onSubmit} />);
    pick("Run");
    type("Duration (min)", "50");
    type("Distance (km)", "10");
    expect(screen.getByText("5:00 /km")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Effort/), { target: { value: "7" } });

    fireEvent.click(screen.getByRole("button", { name: "Log session" }));

    expect(onSubmit).toHaveBeenCalledWith({
      sport: "running",
      date: today(),
      duration_min: 50,
      effort: 7,
      notes: null,
      distance_km: 10,
    });
  });

  it("adds climbs from grade chips and cycles their outcome", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SessionForm onSubmit={onSubmit} />);
    pick("Climb");
    pick("Kilter");
    fireEvent.click(screen.getByRole("button", { name: "Add blue" }));
    const list = screen.getByRole("list", { name: "Logged climbs" });

    const row = () => within(list).getByRole("button", { name: /^blue kilter/ });
    expect(row().getAttribute("aria-label")).toMatch(/not sent/);
    fireEvent.click(row());
    fireEvent.click(screen.getByRole("button", { name: "More attempts on blue" }));
    expect(row().getAttribute("aria-label")).toMatch(/sent, 2 attempts/);
    fireEvent.click(row());
    expect(row().getAttribute("aria-label")).toMatch(/flashed/);

    type("Duration (min)", "90");
    fireEvent.click(screen.getByRole("button", { name: "Log session" }));
    expect(onSubmit.mock.calls[0][0].climbs).toEqual([
      { grade: "blue", style: "kilter", sent: true, attempts: 1 },
    ]);
  });

  it("can't submit without a duration", () => {
    render(<SessionForm onSubmit={vi.fn()} />);
    pick("Run");
    expect(screen.getByRole("button", { name: "Log session" })).toHaveProperty("disabled", true);
  });

  it("repeats a session dated today, or edits it on its own date", () => {
    const last: Session = {
      id: 3,
      sport: "running",
      date: "2026-11-01",
      duration_min: 40,
      effort: 4,
      distance_km: 8,
    };
    const { unmount } = render(<SessionForm session={last} onSubmit={vi.fn()} />);
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(today());
    expect((screen.getByLabelText("Distance (km)") as HTMLInputElement).value).toBe("8");
    unmount();

    render(<SessionForm session={last} editing onSubmit={vi.fn()} />);
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-11-01");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });
});

describe("nextOutcome", () => {
  it("cycles not sent -> sent -> flash -> not sent", () => {
    const tried = { grade: "red" as const, style: "boulder" as const, sent: false, attempts: 1 };
    const sent = nextOutcome(tried);
    expect(sent).toMatchObject({ sent: true, attempts: null });
    const flash = nextOutcome(sent);
    expect(flash).toMatchObject({ sent: true, attempts: 1 });
    expect(nextOutcome(flash)).toMatchObject({ sent: false, attempts: 1 });
  });
});
