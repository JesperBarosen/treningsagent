// Display rules for the dashboard. The numbers themselves come from the
// backend (/training-load and /progression); these only decide how to show them.

import type { DistanceBand, TrainingLoad } from "./api";

/** The backend's minimum history for the ratio (tools.RATIO_MIN_HISTORY_DAYS),
 *  used only in the explanatory text; the backend decides ratio_status. */
export const RATIO_MIN_HISTORY_DAYS = 28;

/** The ranges the agent's tool description cites (Gabbett 2016). */
export const RATIO_MODERATE = [0.8, 1.3] as const;
export const RATIO_SPIKE = 1.5;

export type RatioView =
  | { kind: "not enough data"; historyDays: number }
  | { kind: "ok"; ratio: number; zone: "below" | "moderate" | "above" | "spike" };

export function ratioView(load: TrainingLoad): RatioView {
  const ratio = load.acute_chronic_ratio;
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
