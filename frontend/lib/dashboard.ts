// Display rules for the dashboard. The numbers themselves come from the
// backend (/training-load and /progression); these only decide how to show them.

import { DISTANCE_BANDS, type DistanceBand, type Progression, type TrainingLoad, type TrendWord } from "./api";

/** The backend's minimum history for the ratio (tools.RATIO_MIN_HISTORY_DAYS),
 *  used only in the explanatory text; the backend decides ratio_status. */
export const RATIO_MIN_HISTORY_DAYS = 28;

/** The ranges the agent's tool description cites (Gabbett 2016). */
export const RATIO_MODERATE = [0.8, 1.3] as const;
export const RATIO_SPIKE = 1.5;

export type RatioView =
  | { kind: "paused" }
  | { kind: "not enough data"; historyDays: number }
  | { kind: "ok"; ratio: number; zone: "below" | "moderate" | "above" | "spike" };

export function ratioView(load: TrainingLoad): RatioView {
  const ratio = load.acute_chronic_ratio;
  if (load.ratio_status === "paused") return { kind: "paused" }; // N5: not counted on a break
  if (load.ratio_status !== "ok" || ratio === null) {
    return { kind: "not enough data", historyDays: load.history_days };
  }
  const zone =
    ratio >= RATIO_SPIKE
      ? "spike"
      : ratio > RATIO_MODERATE[1]
        ? "above"
        : ratio >= RATIO_MODERATE[0]
          ? "moderate"
          : "below";
  return { kind: "ok", ratio, zone };
}

export const BAND_LABELS: Record<DistanceBand, string> = {
  under_7km: "Under 7 km",
  "7_to_15km": "7–15 km",
  over_15km: "Over 15 km",
};

// --- Summary first on mobile (#59, design-visual V-M3) ---------------------------

/** The ratio zone as one word, for the summary tile. */
export const ZONE_WORD = { below: "lighter", moderate: "moderate", above: "higher", spike: "spike" } as const;

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

const LOAD_SENTENCE = {
  below: "Your load is lighter than your recent usual.",
  moderate: "Your load is in your usual range.",
  above: "Your load is higher than your recent usual.",
  spike: "Your load is well above your recent usual.",
} as const;

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
 *  words. No new judgements: words the backend says "not enough data" to are left out. */
export function summarySentence(load: TrainingLoad, progression: Progression): string {
  const parts: string[] = [];
  const view = ratioView(load);
  if (view.kind === "ok") parts.push(LOAD_SENTENCE[view.zone]);
  else if (view.kind === "paused") parts.push("Your load ratio is paused for your break.");
  const band = mainPaceBand(progression.running);
  const pace = band && PACE_SENTENCE[progression.running.trends.pace_by_distance[band].trend];
  if (band && pace) parts.push(`Pace on ${BAND_LABELS[band].toLowerCase()} runs ${pace}.`);
  const grade = GRADE_SENTENCE[progression.climbing.trends.avg_session_hardest_sent.trend];
  if (grade) parts.push(grade);
  return parts.length > 0 ? parts.join(" ") : "Not enough data for trends yet. Keep logging and they show up here.";
}
