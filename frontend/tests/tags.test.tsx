import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftCard } from "@/components/draft-card";
import { SessionForm } from "@/components/session-form";
import { TagList } from "@/components/tag-list";
import { draftInput, type Draft, type Session, type SessionInput } from "@/lib/api";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

const RUN: Session = { id: 4, sport: "running", date: "2026-11-14", duration_min: 50, effort: 7, distance_km: 9.2 };

async function submitForm(session?: Session, toggles: string[] = []) {
  const onSubmit = vi.fn<(input: SessionInput) => Promise<void>>(async () => {});
  const user = userEvent.setup();
  render(<SessionForm session={session} editing={!!session} onSubmit={onSubmit} />);
  if (!session) {
    await user.click(screen.getByRole("radio", { name: /Run/ }));
    await user.type(screen.getByLabelText(/duration/i), "50");
  }
  const group = screen.getByRole("group", { name: "How did it feel?" });
  for (const name of toggles) await user.click(within(group).getByRole("button", { name }));
  await user.click(screen.getByRole("button", { name: session ? "Save changes" : "Log session" }));
  return onSubmit.mock.calls[0][0];
}

describe("context tags on the Log form (N6)", () => {
  it("offers six optional toggles, all off, each 44 px", async () => {
    render(<SessionForm onSubmit={async () => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: /Run/ })); // fields appear after a sport
    const buttons = within(screen.getByRole("group", { name: "How did it feel?" })).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Slept badly", "Sore", "Tired", "Felt strong", "Hot", "Stressed"]);
    for (const b of buttons) {
      expect(b).toHaveAttribute("aria-pressed", "false");
      expect(b).toHaveClass("min-h-11");
    }
    expect(screen.getByText("(optional)", { selector: "legend span" })).toBeInTheDocument();
  });

  it("sends no tags when none are picked", async () => {
    expect(await submitForm()).not.toHaveProperty("tags");
  });

  it("sends picked tags in a fixed order; a second tap turns one off", async () => {
    const input = await submitForm(undefined, ["Hot", "Slept badly", "Tired", "Tired"]);
    expect(input.tags).toEqual(["slept_badly", "hot"]);
  });

  it("keeps a session's tags when editing, and sends [] to clear them", async () => {
    const tagged = { ...RUN, tags: ["sore" as const] };
    render(<SessionForm session={tagged} editing onSubmit={async () => {}} />);
    expect(screen.getByRole("button", { name: "Sore" })).toHaveAttribute("aria-pressed", "true");
    document.body.innerHTML = "";
    expect((await submitForm(tagged, ["Sore"])).tags).toEqual([]);
  });
});

describe("tags elsewhere", () => {
  const DRAFT: Draft = { draft: true, sport: "running", date: "2026-11-14", duration_min: 48, effort: 8,
    distance_km: 8, notes: null, tags: ["slept_badly"] };

  it("a chat draft shows its tags, blurred in discreet mode, and saves them", () => {
    render(<DraftCard draft={DRAFT} onSave={async () => {}} onReview={() => {}} onDismiss={() => {}} />);
    const list = screen.getByRole("list", { name: "How it felt" });
    expect(list).toHaveTextContent("Slept badly");
    expect(list).toHaveAttribute("data-sensitive");
    expect(draftInput(DRAFT).tags).toEqual(["slept_badly"]);
    expect(draftInput({ ...DRAFT, tags: [] })).not.toHaveProperty("tags");
  });

  it("a run draft keeps its elevation gain, 0 included; a climb never sends one (#84)", () => {
    expect(draftInput({ ...DRAFT, elevation_m: 300 }).elevation_m).toBe(300);
    expect(draftInput({ ...DRAFT, elevation_m: 0 }).elevation_m).toBe(0);
    expect(draftInput({ ...DRAFT, elevation_m: null })).not.toHaveProperty("elevation_m");
    expect(draftInput(DRAFT)).not.toHaveProperty("elevation_m");
    expect(draftInput({ ...DRAFT, sport: "climbing", elevation_m: 300 })).not.toHaveProperty("elevation_m");
  });

  it("an untagged session shows nothing", () => {
    const { container } = render(<TagList tags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
