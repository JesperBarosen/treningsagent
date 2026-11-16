import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DraftCard } from "@/components/draft-card";
import { draftInput, type Draft } from "@/lib/api";

// The chat draft card for a templated session (#102, A2 variant A, mockup 6).

const DRAFT: Draft = {
  draft: true,
  sport: "other",
  date: "2026-11-16",
  duration_min: 40,
  effort: 7,
  template_id: 7,
  template: "Fingerboard",
  custom_values: { protocol: "max_hangs", hangs: [{ sets: 6, reps: 10, edge_mm: 20, load: 10 }] },
  fields: [
    { key: "protocol", label: "Protocol", type: "select", value: "max_hangs", text: "Max hangs" },
    { key: "hangs", label: "Hangs", type: "sets", value: [], text: "6 × 10 s · 20 mm · +10 kg" },
  ],
};

describe("templated draft card", () => {
  it("titles the draft by its template and shows one line per value, blurred in discreet mode", () => {
    render(<DraftCard draft={DRAFT} onSave={async () => {}} onReview={() => {}} onDismiss={() => {}} />);
    const card = screen.getByRole("region", { name: /^Draft: Fingerboard · 40 min · effort 7/ });
    const values = within(card).getByRole("list", { name: "Fingerboard values" });
    expect(within(values).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Max hangs",
      "6 × 10 s · 20 mm · +10 kg",
    ]);
    for (const li of within(values).getAllByRole("listitem")) expect(li).toHaveAttribute("data-sensitive");
  });

  it("saves with the template and its values", () => {
    expect(draftInput(DRAFT)).toEqual({
      sport: "other",
      date: "2026-11-16",
      duration_min: 40,
      effort: 7,
      notes: null,
      template_id: 7,
      values: DRAFT.custom_values,
    });
  });

  it("keeps a plain draft as before", () => {
    const plain: Draft = { draft: true, sport: "strength", date: "2026-11-16", duration_min: 50, effort: 7 };
    expect(draftInput(plain)).toEqual({ sport: "strength", date: "2026-11-16", duration_min: 50, effort: 7, notes: null });
  });
});
