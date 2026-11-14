// The weekly review (docs/design-proposals-2.md, N1). The numbers come from
// the backend (/training-load and /progression); this file only picks the
// reviewed week out of them and words them. The coach sentence is built from
// those numbers and the backend's trend words, never generated, so it can't
// claim more than the data says.

import {
  DISTANCE_BANDS,
  type DistanceBand,
  type Grade,
  type Progression,
  type TrainingLoad,
  type TrendWord,
} from "./api";
import { parseDay, shortDate, weekStart } from "./format";
import { supabaseBrowser } from "./supabase/client";

function toIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday of the week before the one containing `today`. */
export function lastWeekStart(today: Date = new Date()): string {
  const monday = parseDay(weekStart(toIso(today)));
  monday.setDate(monday.getDate() - 7);
  return toIso(monday);
}

/** "10–16 Nov", or "27 Oct – 2 Nov" across months. */
export function weekRange(start: string): string {
  const end = parseDay(start);
  end.setDate(end.getDate() + 6);
  const [s, e] = [parseDay(start), end];
  if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${shortDate(toIso(e))}`;
  return `${shortDate(start)} – ${shortDate(toIso(e))}`;
}

/** Whole weeks from `start` to the current week's Monday (0 = this week). */
export function weeksAgo(start: string, today: Date = new Date()): number {
  const diff = parseDay(weekStart(toIso(today))).getTime() - parseDay(start).getTime();
  return Math.round(diff / (7 * 24 * 3600 * 1000));
}

export type WeekReviewData = {
  weekStart: string;
  sessions: number;
  load: number;
  /** null when the week before isn't in the data. */
  prevSessions: number | null;
  prevLoad: number | null;
  runs: number;
  climbingSessions: number;
  hardestSent: Grade | null;
  hardestSentTrend: TrendWord;
  /** The distance band with the most runs that week, and its average pace. */
  pace: { band: DistanceBand; minPerKm: number; trend: TrendWord } | null;
  sentence: string;
};

/** The reviewed week out of the backend's numbers; null if it isn't covered. */
export function buildWeekReview(
  load: TrainingLoad,
  progression: Progression,
  start: string,
): WeekReviewData | null {
  const i = load.weekly.findIndex((w) => w.week_start === start);
  if (i < 0) return null;
  const week = load.weekly[i];
  const prev = i > 0 ? load.weekly[i - 1] : null;
  const run = progression.running.weekly.find((w) => w.week_start === start);
  const climb = progression.climbing.weekly.find((w) => w.week_start === start);

  let pace: WeekReviewData["pace"] = null;
  if (run) {
    const best = DISTANCE_BANDS.map((band) => ({ band, b: run.pace_by_distance[band] }))
      .filter((x) => x.b && x.b.runs > 0 && x.b.pace_min_per_km !== null)
      .sort((a, z) => z.b!.runs - a.b!.runs)[0];
    if (best) {
      pace = {
        band: best.band,
        minPerKm: best.b!.pace_min_per_km!,
        trend: progression.running.trends.pace_by_distance[best.band].trend,
      };
    }
  }

  const data: Omit<WeekReviewData, "sentence"> = {
    weekStart: start,
    sessions: week.sessions,
    load: week.load,
    prevSessions: prev?.sessions ?? null,
    prevLoad: prev?.load ?? null,
    runs: run?.runs ?? 0,
    climbingSessions: climb?.sessions ?? 0,
    hardestSent: climb?.hardest_sent ?? null,
    hardestSentTrend: progression.climbing.trends.avg_session_hardest_sent.trend,
    pace,
  };
  return { ...data, sentence: coachSentence(data) };
}

/** One or two plain sentences from the numbers. Positive where the data is,
 *  neutral otherwise, never "failed" (P17 [Consolvo 2009]). */
export function coachSentence(d: Omit<WeekReviewData, "sentence">): string {
  if (d.sessions === 0) return "No sessions logged that week. A fresh week starts now.";
  const parts: string[] = [];
  if (d.prevLoad === null || d.prevLoad === 0) parts.push("You got training logged");
  else if (d.load > d.prevLoad * 1.1) parts.push("More training than the week before");
  else if (d.load < d.prevLoad * 0.9) parts.push("A lighter week than the one before");
  else parts.push("About the same load as the week before");

  const details: string[] = [];
  if (d.hardestSent) details.push(`your hardest send was ${d.hardestSent}`);
  if (d.pace) {
    const words: Partial<Record<TrendWord, string>> = {
      improving: "your pace is improving",
      flat: "your pace held steady",
      declining: "your pace is a little slower than in the weeks before",
    };
    const w = words[d.pace.trend];
    if (w) details.push(w);
  }
  const first = `${parts[0]}.`;
  if (!details.length) return first;
  const second = details.join(", and ");
  return `${first} ${second[0].toUpperCase()}${second.slice(1)}.`;
}

// --- Stored reviews (table week_reviews, RLS: the user's own rows) ------------

export type WeekReviewStatus = "done" | "skipped";
export type StoredWeekReview = { status: WeekReviewStatus; note: string | null };

/** The stored review for `start`, or null. Throws when it can't be read. */
export async function getWeekReview(start: string): Promise<StoredWeekReview | null> {
  const { data, error } = await supabaseBrowser()
    .from("week_reviews")
    .select("status, note")
    .eq("week_start", start)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StoredWeekReview | null) ?? null;
}

export const NOTE_MAX = 500;

export async function saveWeekReview(start: string, review: StoredWeekReview): Promise<void> {
  const note = review.note?.trim().slice(0, NOTE_MAX) || null;
  const { error } = await supabaseBrowser()
    .from("week_reviews")
    .upsert(
      { week_start: start, status: review.status, note, updated_at: new Date().toISOString() },
      { onConflict: "user_id,week_start" },
    );
  if (error) throw new Error(error.message);
}
