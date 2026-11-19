// Display rules for the training profile (#137).

import type { Injury, ProfileChanges, TrainingProfile, Weekday } from "./api";

export const FIELD_LABEL: Record<keyof Omit<TrainingProfile, "onboarding">, string> = {
  sessions_per_week: "Sessions a week",
  preferred_days: "Days",
  longest_run_km: "Longest recent run",
  weekly_run_km: "Typical running week",
  climbing_level: "Climbing level",
  injuries: "Injuries or pain",
  other_sports: "Other sports",
  goals_note: "Goals",
};

export const DAY_SHORT: Record<Weekday, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};

export function injuryText(i: Injury): string {
  return [i.body_part, i.pain != null ? `pain ${i.pain}/10` : null, i.note].filter(Boolean).join(", ");
}

/** One field's value in words, "–" when empty. */
export function valueText(key: keyof ProfileChanges, value: unknown): string {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "–";
  switch (key) {
    case "preferred_days":
      return (value as Weekday[]).map((d) => DAY_SHORT[d]).join(", ");
    case "injuries":
      return (value as Injury[]).map(injuryText).join("; ");
    case "longest_run_km":
    case "weekly_run_km":
      return `${value} km`;
    default:
      return String(value);
  }
}

/** "Sessions a week: 3 → 2" lines for a change the coach proposed. */
export function changeLines(changes: ProfileChanges, before: ProfileChanges): { label: string; from: string; to: string }[] {
  return (Object.keys(changes) as (keyof ProfileChanges)[])
    .filter((k) => k !== "onboarding")
    .map((k) => ({
      label: FIELD_LABEL[k as keyof typeof FIELD_LABEL],
      from: valueText(k, before[k]),
      to: valueText(k, changes[k]),
    }));
}
