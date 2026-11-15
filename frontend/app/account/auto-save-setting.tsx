"use client";

import { useSyncExternalStore } from "react";
import { readAutoSave, saveAutoSave, subscribeChatDrafts } from "@/lib/chat-drafts";

/** "Save chat sessions without asking" (N4). Off by default: the coach drafts a
 *  session and you save it. On: the coach saves it straight away, as before. */
export function AutoSaveSetting() {
  const on = useSyncExternalStore(subscribeChatDrafts, readAutoSave, () => false);

  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => saveAutoSave(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-accent"
      />
      <span>
        <span className="block font-medium">Save chat sessions without asking</span>
        <span className="block text-sm text-ink-muted">
          Off: the coach shows what it understood, and you tap Save or Review. On: it saves
          straight away, and you can still edit or undo. This device only.
        </span>
      </span>
    </label>
  );
}
