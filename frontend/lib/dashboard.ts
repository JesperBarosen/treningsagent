// Display rules for the dashboard. The numbers themselves come from the
// backend (/training-load and /progression); these only decide how to show them.

import { DISTANCE_BANDS, type DistanceBand, type Progression, type TrainingLoad, type Trend, type TrendWord } from "./api";
import type { SportFilter } from "./sport-filter";

/** The backend's minimum history for the ratio (tools.RATIO_MIN_HISTORY_DAYS),
 *  used only in the explanatory text; the backend decides ratio_status. */
export const RATIO_MIN_HISTORY_DAYS = 28;

/** The ratio is only a rough warning signal of how this week compares with the
 *  last four, as the coach's get_training_load says (#133, #150): no range of
 *  it is shown as safe or moderate, and nothing cites a band (the research
 *  behind such bands is weak; Impellizzeri 2020). So the app shows it as plain
 *  arithmetic: how far the last 7 days' daily average is above or below the
 *  last 28 days'. */
export type RatioView =
  | { kind: "paused" }
  | { kind: "not enough data"; historyDays: number }
  | { kind: "ok"; ratio: number; /** Whole percent above (+) or below (−) the 28-day average. */ change: number };

export function ratioView(load: TrainingLoad): RatioView {
  const ratio = load.acute_chronic_ratio;
  if (load.ratio_status === "paused") return { kind: "paused" }; // N5: not counted on a break
  if (load.ratio_status !== "ok" || ratio === null) {
    return { kind: "not enough data", historyDays: load.history_days };
  }
  return { kind: "ok", ratio, change: Math.round((ratio - 1) * 100) || 0 };
}

/** "+7% vs usual", "−20% vs usual", "same as usual": the narrow summary tile. */
export function changeWord(change: number): string {
  if (change === 0) return "same as usual";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}% vs usual`;
}

/** "7% above your 4-week average": the card and the summary sentence. */
export function changeText(change: number): string {
  if (change === 0) return "the same as your 4-week average";
  return `${Math.abs(change)}% ${change > 0 ? "above" : "below"} your 4-week average`;
}

/** What the card and the tool say the ratio is, word for word. */
export const RATIO_CAVEAT =
  "Only a rough warning signal of how this week compares with the last four. No range of it is safe, and it doesn't predict injury.";

// --- What a trend or the ratio still needs (#126) ---------------------------------

/** The backend's trend rule (progression.MIN_SESSIONS): each window needs this
 *  many sessions with the metric, the last 2 weeks and the 4 weeks before. */
export const TREND_MIN_SESSIONS = 3;

export const TOO_EARLY = "Too early for a trend";

/** What a trend counts, for its label: `none` names what's missing ("runs",
 *  "sends"), `count` what the backend counted per window ("runs", "sessions"). */
export type TrendNoun = { none: string; count: string };

/** Instead of "Not enough data": what the trend is still missing, from the
 *  backend's own counts, in words that never blame (P17, P24). Null when the
 *  trend has a word. Short enough for a chip at 375 px. */
export function trendGap(t: Trend, noun: TrendNoun): string | null {
  if (t.trend !== "not enough data") return null;
  const { recent_sessions: recent, baseline_sessions: before } = t;
  if (recent === 0 && before === 0) return `No ${noun.none} in the last 6 weeks`;
  if (before === 0) return `No ${noun.none} in the 4 weeks before to compare with`;
  if (recent === 0) return `No ${noun.none} in the last 2 weeks`;
  if (recent < TREND_MIN_SESSIONS && before >= TREND_MIN_SESSIONS) {
    return `Trend after ${TREND_MIN_SESSIONS} recent ${noun.count} · ${recent} so far`;
  }
  // There are points on both sides, just not enough of them yet.
  return TOO_EARLY;
}

/** The ratio's history need in words: "Needs 4 weeks of sessions", and how
 *  far along the user is ("1 week so far", or days in the first week). */
export function ratioGap(historyDays: number): { need: string; sofar: string | null } {
  const need = `Needs ${RATIO_MIN_HISTORY_DAYS / 7} weeks of sessions`;
  if (historyDays <= 0) return { need, sofar: null };
  const weeks = Math.floor(historyDays / 7);
  const sofar =
    weeks === 0
      ? `${historyDays} ${historyDays === 1 ? "day" : "days"} so far`
      : `${weeks} ${weeks === 1 ? "week" : "weeks"} so far`;
  return { need, sofar };
}

export const BAND_LABELS: Record<DistanceBand, string> = {
  under_7km: "Under 7 km",
  "7_to_15km": "7–15 km",
  over_15km: "Over 15 km",
};

// --- Summary first on mobile (#59, design-visual V-M3) ---------------------------

/** The distance band with the most runs in the last 2 weeks that has a trend,
 *  so the collapsed pace row shows one honest chip instead of mixing bands. */
export function mainPaceBand(running: Progression["running"]): DistanceBand | null {
  let best: DistanceBand | null = null;
  for (const band of DISTANCE_BANDS) {
    const t = running.trends.pace_by_distance[band];
    if (!t || t.trend === "not enough data") continue;
    if (best === null || t.recent_sessions > running.trends.pace_by_distance[best].recent_sessions) best = band;
  }
  return best;
}

/** Whose load the sentence is about: everything (All) or one sport (#46). */
const LOAD_SUBJECT: Record<SportFilter, string> = {
  all: "Your",
  running: "Your running",
  climbing: "Your climbing",
  strength: "Your strength",
  other: "Your other training's",
};

/** Average sessions per week over the complete weeks shown (the current week is
 *  partial), leaving out weeks a break that is on has reached, so a break
 *  doesn't drag the average down. Null with no complete week to count. */
export function sessionsPerWeek(load: TrainingLoad): number | null {
  const breakStart = load.pause?.start_date;
  const weeks = load.weekly.slice(0, -1).filter((w) => {
    if (!breakStart) return true;
    const end = new Date(`${w.week_start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    return end.toISOString().slice(0, 10) < breakStart;
  });
  if (weeks.length === 0) return null;
  return weeks.reduce((sum, w) => sum + w.sessions, 0) / weeks.length;
}

const PACE_SENTENCE: Partial<Record<TrendWord, string>> = {
  improving: "is getting faster",
  flat: "held steady",
  declining: "is slower than the 4 weeks before",
};

const GRADE_SENTENCE: Partial<Record<TrendWord, string>> = {
  improving: "Your hardest sends are going up.",
  flat: "Your hardest sends held steady.",
  declining: "Your hardest sends dipped a little.",
};

/** One plain sentence built only from the backend's ratio status and trend
 *  words. No new judgements: words the backend says "not enough data" to are left out.
 *  `load` is the filtered one; with a single sport (#46) only that sport's trend is used. */
export function summarySentence(load: TrainingLoad, progression: Progression, sport: SportFilter = "all"): string {
  const parts: string[] = [];
  const view = ratioView(load);
  if (view.kind === "ok") parts.push(`${LOAD_SUBJECT[sport]} load over the last 7 days is ${changeText(view.change)}.`);
  else if (view.kind === "paused") parts.push(`${LOAD_SUBJECT[sport]} load ratio is paused for your break.`);
  if (sport === "all" || sport === "running") {
    const band = mainPaceBand(progression.running);
    const pace = band && PACE_SENTENCE[progression.running.trends.pace_by_distance[band].trend];
    if (band && pace) parts.push(`Pace on ${BAND_LABELS[band].toLowerCase()} runs ${pace}.`);
  }
  if (sport === "all" || sport === "climbing") {
    const grade = GRADE_SENTENCE[progression.climbing.trends.avg_session_hardest_sent.trend];
    if (grade) parts.push(grade);
  }
  return parts.length > 0 ? parts.join(" ") : "Too early for trends. They show up here after a few weeks of sessions.";
}
