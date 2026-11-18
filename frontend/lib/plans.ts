// Display rules for training plans (#118, #119, docs/training-plans.md). The
// numbers come from the backend (plans.py); these only decide how to show them.

import type { Goal, PlannedSession, PlannedState, PlanTarget, WeekKind, WeekMeta } from "./api";
import { BAND_LABELS } from "./dashboard";
import { formatPace } from "./format";

/** "send a red", "Over 15 km at 6:30 /km": what the plan's goal is. */
export function goalLine(g: Goal): string {
  if (g.kind === "climb_grade") return `${g.climb_mode} a ${g.grade}`;
  return `${BAND_LABELS[g.band]} at ${formatPace(g.target_pace)} /km`;
}

/** "35 min · effort 4 · 6 km · 3 × red", from whichever parts the target has. */
export function targetText(t: PlanTarget): string {
  const parts: string[] = [];
  if (t.duration_min) parts.push(`${t.duration_min} min`);
  if (t.effort) parts.push(`effort ${t.effort}`);
  if (t.distance_km) parts.push(`${t.distance_km} km`);
  for (const g of t.grades ?? []) parts.push(`${g.count} × ${g.grade}`);
  for (const [key, value] of Object.entries(t.values ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parts.push(Object.entries(value).map(([k, v]) => `${v} ${k}`).join(" · "));
    } else if (typeof value === "number" || typeof value === "string") {
      parts.push(`${key.replaceAll("_", " ")} ${value}`);
    }
  }
  return parts.join(" · ");
}

/** Week chip words: "lighter" for a deload week, the kind otherwise; build weeks have none. */
export const KIND_WORD: Record<WeekKind, string | null> = {
  build: null,
  deload: "lighter",
  taper: "taper",
  test: "test",
};

export function weekChip(w: Pick<WeekMeta, "index" | "kind">): string {
  const word = KIND_WORD[w.kind];
  return word ? `W${w.index} · ${word}` : `W${w.index}`;
}

/** The status pill: never red, never a failure (P17, P24, Q7). Upcoming has none. */
export const STATE_LABEL: Record<PlannedState, string | null> = {
  done: "Done",
  today: "Today",
  upcoming: null,
  not_done: "Not done",
  skipped: "Skipped",
  paused: "Paused",
};

/** "3 of 4 this week": done out of the week's sessions, skipped ones left out.
 *  Only ever counts up; "not done" is never subtracted or shown as missed. */
export function weekCount(sessions: PlannedSession[], week: number): { done: number; of: number } {
  const mine = sessions.filter((s) => s.week === week && s.state !== "skipped");
  return { done: mine.filter((s) => s.state === "done").length, of: mine.length };
}

/** Whole weeks left from today to the plan's last day (0 in its last week). */
export function weeksLeft(endDate: string, today: string): number {
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, Math.floor(days / 7));
}

/** Monday to Sunday of week `index` (1-based) from the plan's start. */
export function weekDays(startDate: string, index: number): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`) + (index - 1) * 7 * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

/** "23 Nov – 20 Dec". */
export function dateRange(from: string, to: string): string {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(from)} – ${fmt(to)}`;
}
