// Chat drafts (N4, docs/design-proposals-2.md): the coach drafts a session and
// the user confirms it. This holds the device setting that turns drafting off,
// and the hand-off between the chat's Review button and the Log form.

import type { Draft, Session } from "./api";

/** "Save chat sessions without asking": per device, like the theme. */
export const AUTO_SAVE_KEY = "treningsagent.chatAutoSave";

export function readAutoSave(): boolean {
  try {
    return localStorage.getItem(AUTO_SAVE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveAutoSave(on: boolean): void {
  try {
    if (on) localStorage.setItem(AUTO_SAVE_KEY, "on");
    else localStorage.removeItem(AUTO_SAVE_KEY);
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Which draft in which chat message: so a save in the Log form finds its card. */
export type DraftRef = { itemId: string; key: string };

const REVIEW_KEY = "treningsagent.reviewDraft";
const SAVED_KEY = "treningsagent.savedDraft";
const CHANGE_EVENT = "treningsagent:chat-drafts";

function put(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore: the auto-save setting or the hand-off changed. */
export function subscribeChatDrafts(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Read and remove: a hand-off is used once. */
function take<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Review: the chat leaves the draft for the Log form to open prefilled. It
 *  stays until the form saves it or the user starts over, so a reload of the
 *  Log page keeps it. */
export const handDraftToForm = (ref: DraftRef, draft: Draft) => put(REVIEW_KEY, { ref, draft });

export type HandedDraft = { ref: DraftRef; draft: Draft };

/** The raw hand-off, a stable string for useSyncExternalStore; null if none. */
export function peekDraftForForm(): string | null {
  try {
    return sessionStorage.getItem(REVIEW_KEY);
  } catch {
    return null;
  }
}

export function parseHandedDraft(raw: string | null): HandedDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as HandedDraft;
    return value?.ref && value?.draft ? value : null;
  } catch {
    return null;
  }
}

export function clearDraftForForm(): void {
  try {
    sessionStorage.removeItem(REVIEW_KEY);
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The Log form saved a reviewed draft: the chat marks its card when it next opens. */
export const reportDraftSaved = (ref: DraftRef, session: Session) => put(SAVED_KEY, { ref, session });
export const takeSavedDraft = () => take<{ ref: DraftRef; session: Session }>(SAVED_KEY);
