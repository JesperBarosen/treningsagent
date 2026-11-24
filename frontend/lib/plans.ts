// Display rules for training plans (#118, #119, docs/training-plans.md). The
// numbers come from the backend (plans.py); these only decide how to show them.

import type {
  Goal,
  PlannedSession,
  PlannedState,
  PlanTarget,
  PlanWeek,
  RunType,
  Session,
  WeekKind,
  WeekMeta,
} from "./api";

export const RUN_TYPE_LABEL: Record<RunType, string> = {
  easy: "Easy",
  long: "Long run",
  strides: "Strides",
  intervals: "Intervals",
  tempo: "Tempo",
  recovery: "Recovery",
};

/** What the proposal card's week bars show (#135 bug: they were flat when no
 *  session had both duration and effort). Planned load when any week has it,
 *  else running km, else the number of sessions; one bar height per week, 0-1. */
export function weekVolume(
  weekly: PlanWeek[],
  runningKm?: number[],
): { unit: "load" | "km" | "sessions"; values: number[]; heights: number[] } {
  const loads = weekly.map((w) => w.planned_load);
  const km = runningKm ?? [];
  const [unit, values]: ["load" | "km" | "sessions", number[]] = loads.some((v) => v > 0)
    ? ["load", loads]
    : km.some((v) => v > 0)
      ? ["km", weekly.map((_, i) => km[i] ?? 0)]
      : ["sessions", weekly.map((w) => w.sessions)];
  const top = Math.max(...values, 0);
  return { unit, values, heights: values.map((v) => (top > 0 ? v / top : 0)) };
}
import { BAND_LABELS } from "./dashboard";
import { formatPace } from "./format";

/** "send a red", "Over 15 km at 6:30 /km": what the plan's goal is. */
export function goalLine(g: Goal): string {
  if (g.kind === "climb_grade") return `${g.climb_mode} a ${g.grade}`;
  return `${BAND_LABELS[g.band]} at ${formatPace(g.target_pace)} /km`;
}

/** "Tempo · 20 min at tempo effort · 50 min · effort 6 · 8 km · 3 × red", from
 *  whichever parts the target has: the run's type and workout first (#135). */
export function targetText(t: PlanTarget): string {
  const parts: string[] = [];
  if (t.session_type) parts.push(RUN_TYPE_LABEL[t.session_type]);
  if (t.workout) parts.push(t.workout);
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

/** The week (1-based) of a plan that contains `today`, or null before the start or after the end. */
export function weekContaining(startDate: string, weeks: number, today: string): number | null {
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
  const week = Math.floor(days / 7) + 1;
  return days >= 0 && week <= weeks ? week : null;
}

// --- Logging a planned session (#117, #132) ------------------------------------------

/** "Log this" shows on a planned session that isn't done, skipped or paused. */
export const LOGGABLE: PlannedState[] = ["today", "upcoming", "not_done"];

/** "today's Easy run", "Thursday's Tempo run": how the app names a planned session. */
export function plannedName(p: Pick<PlannedSession, "date" | "title">, today: string): string {
  if (p.date === today) return `today's ${p.title}`;
  const weekday = new Date(`${p.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return `${weekday}'s ${p.title}`;
}

/** The Log form's starting values from a planned session's target: sport,
 *  template, duration, distance, effort, and the workout (intervals and the
 *  like) as a note. Dated its own day, or today if that is still ahead. */
export function plannedAsSession(p: PlannedSession, today: string): Session {
  const t = p.target ?? {};
  // "Tempo run: 6 x 800 m at 10 km pace": the workout, so the user sees what was planned.
  const note = t.workout ? `${p.title}: ${t.workout}` : null;
  return {
    id: 0,
    sport: p.sport,
    date: p.date > today ? today : p.date,
    // The form starts empty where the plan set no number.
    duration_min: t.duration_min as number,
    effort: t.effort as number,
    distance_km: t.distance_km ?? null,
    notes: note,
    template_id: p.template_id,
    custom_values: t.values,
  };
}

/** "23 Nov – 20 Dec". */
export function dateRange(from: string, to: string): string {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(from)} – ${fmt(to)}`;
}
