// Display rules for the dashboard. The numbers themselves come from the
// backend (/training-load and /progression); these only decide how to show them.

import type { DistanceBand, TrainingLoad } from "./api";
import { parseDay } from "./format";

/** The acute:chronic ratio compares the last 7 days with the last 28, so it
 *  means little until about 4 weeks have been logged (the same caveat the
 *  agent's get_training_load tool gives). */
export const RATIO_MIN_HISTORY_DAYS = 28;

/** The ranges the agent's tool description cites (Gabbett 2016). */
export const RATIO_MODERATE = [0.8, 1.3] as const;
export const RATIO_SPIKE = 1.5;

export type RatioView =
  | { kind: "not enough data"; historyDays: number }
  | { kind: "ok"; ratio: number; zone: "below" | "moderate" | "above" | "spike" };

/** Days from the first day with any load in `daily` up to the last day
 *  (the backend's today), both included. 0 when nothing is logged. */
export function historyDays(daily: TrainingLoad["daily"]): number {
  const first = daily.find((d) => d.load > 0);
  if (!first || daily.length === 0) return 0;
  const last = daily[daily.length - 1];
  const ms = parseDay(last.date).getTime() - parseDay(first.date).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function ratioView(load: TrainingLoad): RatioView {
  const days = historyDays(load.daily);
  const ratio = load.acute_chronic_ratio;
  if (ratio === null || days < RATIO_MIN_HISTORY_DAYS) {
    return { kind: "not enough data", historyDays: days };
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
