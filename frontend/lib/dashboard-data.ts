// The Dashboard's data for every sport filter (#46). One request brings the
// all-sports load and each sport's own (`by_sport`), split here, so switching
// All / Running / Climbing needs no request. With a backend from before
// `by_sport`, the missing sports are fetched one by one, in the background,
// right after the first load.

import {
  getProgression,
  getTrainingLoad,
  getTrainingLoadBySport,
  SPORTS,
  type Progression,
  type Sport,
  type TrainingLoad,
} from "./api";
import type { SportFilter } from "./sport-filter";

export type Loads = Partial<Record<SportFilter, TrainingLoad>>;
export type DashboardData = { loads: Loads; progression: Progression };

/** The load per filter and the progression, from one load request when the backend can. */
export async function fetchDashboard(weeks: number, signal?: AbortSignal): Promise<DashboardData> {
  const [load, progression] = await Promise.all([
    getTrainingLoadBySport(weeks, signal),
    getProgression(weeks, signal),
  ]);
  const { by_sport, ...all } = load;
  const loads: Loads = { all, ...(by_sport ?? {}) };
  return { loads, progression };
}

/** The filters `loads` has no numbers for yet. */
export function missingSports(loads: Loads): Sport[] {
  return SPORTS.filter((s) => !loads[s]);
}

/** One sport's load, for a backend without `by_sport`. */
export function fetchSportLoad(weeks: number, sport: Sport, signal?: AbortSignal): Promise<TrainingLoad> {
  return getTrainingLoad(weeks, signal, sport);
}

/** The filter to draw while `wanted` is still loading: itself when ready, else
 *  All, else whatever is there. Null when nothing is. */
export function shownFilter(loads: Loads, wanted: SportFilter): SportFilter | null {
  if (loads[wanted]) return wanted;
  if (loads.all) return "all";
  return (Object.keys(loads)[0] as SportFilter | undefined) ?? null;
}
