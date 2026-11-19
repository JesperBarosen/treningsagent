"use client";

import { useState } from "react";
import { ApiError, type ProfileUpdate } from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { changeLines } from "@/lib/profile";
import { UserIcon } from "./icons";
import { Button } from "./states";

/** A change to the training profile the coach proposed (#137): what changes,
 *  from what to what, with Save and Dismiss. Nothing is stored until Save,
 *  whatever "Save without asking" says. */
export function ProfileUpdateCard({
  update,
  status,
  onSave,
  onDismiss,
}: {
  update: ProfileUpdate;
  status: "open" | "saved" | "dismissed";
  /** Store the change. Resolves when saved; throws to show an error. */
  onSave: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (status === "dismissed") return null;
  const lines = changeLines(update.changes, update.before);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the change. Try again.");
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Profile change"
      className={`animate-rise rounded-lg border bg-surface p-3 ${status === "open" ? "border-dashed border-control" : "border-line"}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <UserIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-meta font-medium text-ink-muted">
            {status === "saved" ? "Profile updated" : "Profile change · not saved yet"}
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {lines.map((l) => (
              <li key={l.label}>
                <span className="font-semibold">{l.label}: </span>
                <span {...SENSITIVE} className="tabular-nums">
                  <span className="text-ink-muted">{l.from}</span> → {l.to}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {status === "open" && (
        <div className="mt-3 flex gap-2">
          <Button onClick={save} disabled={busy} className="flex-1">
            {busy ? "Saving…" : "Save"}
          </Button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-control px-5 text-sm font-semibold text-ink transition hover:bg-sunken disabled:opacity-40"
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}
