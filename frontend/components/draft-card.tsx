"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, type Draft, type Session } from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { dayLabel, sessionSummary } from "@/lib/format";
import { ClimbChips } from "./grade";
import { CloseIcon, SportBadge } from "./icons";
import { Button } from "./states";
import { TagList } from "./tag-list";

/** For display helpers that take a Session: a draft has no id yet. */
export const asSession = (d: Draft): Session => ({ ...d, id: 0 });

/** A session the coach understood but didn't store (N4). Save stores it in one
 *  tap; Review opens the Log form prefilled; the x dismisses it. Nothing is in
 *  the log until the user saves. */
export function DraftCard({
  draft,
  onSave,
  onReview,
  onDismiss,
}: {
  draft: Draft;
  /** Store the draft as it is. Resolves when saved; throws to show an error. */
  onSave: () => Promise<void>;
  onReview: () => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = asSession(draft);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the session. Try again.");
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={`Draft: ${sessionSummary(session)}`}
      className="animate-rise rounded-lg border border-dashed border-control bg-surface p-3"
    >
      <div className="flex items-start gap-3">
        <SportBadge sport={draft.sport} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-meta font-medium text-ink-muted">Not saved yet · {dayLabel(draft.date)}</p>
          <p {...SENSITIVE} className="truncate text-sm font-semibold tabular-nums">
            {sessionSummary(session)}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          aria-label="Dismiss draft"
          title="Dismiss draft"
          className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sunken"
        >
          <CloseIcon size={18} />
        </button>
      </div>
      <TagList tags={draft.tags} className="mt-2 pl-11" />
      {draft.climbs && draft.climbs.length > 0 && (
        <div className="mt-2.5 pl-11">
          <ClimbChips climbs={draft.climbs} max={6} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button onClick={save} disabled={busy} className="flex-1">
          {busy ? "Saving…" : "Save"}
        </Button>
        {/* A link, so it works as navigation; onReview hands the draft to the form first. */}
        <Link
          href="/log"
          onClick={onReview}
          aria-disabled={busy}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-control px-5 text-sm font-semibold text-ink transition hover:bg-sunken aria-disabled:pointer-events-none aria-disabled:opacity-40"
        >
          Review
        </Link>
      </div>
    </section>
  );
}
