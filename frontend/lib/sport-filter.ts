// The Dashboard's sport filter (#46): All, Running or Climbing. Remembered per
// device in localStorage, like the chart preferences (lib/chart-prefs.ts).

import { useSyncExternalStore } from "react";
import { SPORTS, type Sport } from "./api";

export type SportFilter = "all" | Sport;

// Strength and Other (#100) have their own load and ratio; no progression cards.
export const SPORT_FILTERS: SportFilter[] = ["all", ...SPORTS];
export const SPORT_FILTER_LABELS: Record<SportFilter, string> = {
  all: "All",
  running: "Running",
  climbing: "Climbing",
  strength: "Strength",
  other: "Other",
};

export const SPORT_FILTER_KEY = "treningsagent.dashboardSport";
const CHANGE_EVENT = "treningsagent:sport-filter";

/** The saved filter, or "all" when nothing valid is saved or storage is blocked. */
export function readSportFilter(): SportFilter {
  try {
    const saved = localStorage.getItem(SPORT_FILTER_KEY);
    return (SPORTS as readonly string[]).includes(saved ?? "") ? (saved as Sport) : "all";
  } catch {
    return "all";
  }
}

/** "all" stores nothing, so the default can change for everyone who never chose. */
export function saveSportFilter(filter: SportFilter): void {
  try {
    if (filter === "all") localStorage.removeItem(SPORT_FILTER_KEY);
    else localStorage.setItem(SPORT_FILTER_KEY, filter);
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore: a change here, or in another tab. */
export function subscribeSportFilter(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === SPORT_FILTER_KEY || e.key === null) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The current filter; "all" on the server and before hydration. */
export function useSportFilter(): SportFilter {
  return useSyncExternalStore(subscribeSportFilter, readSportFilter, () => "all" as const);
}
