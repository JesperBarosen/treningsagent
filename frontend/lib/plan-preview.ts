// The proposal preview (#135): the chat card's "View plan" hands the proposal
// to /plan/proposal, and Accept or Dismiss there is handed back, so the chat
// marks its card and tells the coach when it next opens. Like the draft
// hand-off (lib/chat-drafts.ts), per tab in sessionStorage. Nothing here
// stores a plan: only Accept does, through POST /plans.

import type { Plan, PlanProposal } from "./api";
import type { DraftRef } from "./chat-drafts";

const PREVIEW_KEY = "treningsagent.previewProposal";
const SETTLED_KEY = "treningsagent.settledProposal";
const CHANGE_EVENT = "treningsagent:plan-preview";

export type HandedProposal = { ref: DraftRef; proposal: PlanProposal };
export type ProposalOutcome = { accepted: Plan } | { dismissed: PlanProposal };

function put(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribePreview(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export const handProposalToPreview = (ref: DraftRef, proposal: PlanProposal) => put(PREVIEW_KEY, { ref, proposal });

/** The raw hand-off, a stable string for useSyncExternalStore; null if none. */
export function peekPreview(): string | null {
  try {
    return sessionStorage.getItem(PREVIEW_KEY);
  } catch {
    return null;
  }
}

export function parsePreview(raw: string | null): HandedProposal | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as HandedProposal;
    return value?.ref && value?.proposal?.plan ? value : null;
  } catch {
    return null;
  }
}

/** Accept or Dismiss in the preview: the preview is done, the chat settles its card. */
export function reportProposalSettled(ref: DraftRef, outcome: ProposalOutcome): void {
  try {
    sessionStorage.removeItem(PREVIEW_KEY);
  } catch {}
  put(SETTLED_KEY, { ref, outcome });
}

/** Read and remove: the chat uses the outcome once. */
export function takeSettledProposal(): { ref: DraftRef; outcome: ProposalOutcome } | null {
  try {
    const raw = sessionStorage.getItem(SETTLED_KEY);
    sessionStorage.removeItem(SETTLED_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
