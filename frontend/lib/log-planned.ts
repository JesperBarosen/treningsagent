// "Log this" on a planned session (#132): the Plan view leaves the planned
// session for the Log form, which opens prefilled from its target and links
// the two on save (#117). Browser storage, like the chat's Review hand-off, so
// a reload of the Log page keeps it.

import type { PlannedSession } from "./api";

const KEY = "treningsagent.logPlanned";
const CHANGE_EVENT = "treningsagent:log-planned";

export function handPlannedToForm(planned: PlannedSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(planned));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore. */
export function subscribeLogPlanned(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The raw hand-off, a stable string for useSyncExternalStore; null if none. */
export function peekPlannedForForm(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parseHandedPlanned(raw: string | null): PlannedSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PlannedSession;
    return typeof value?.id === "number" && value.sport && value.date ? value : null;
  } catch {
    return null;
  }
}

export function clearPlannedForForm(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
