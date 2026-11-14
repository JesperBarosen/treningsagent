"use client";

import { useState } from "react";
import { ApiError, deleteSession, type Session } from "@/lib/api";
import {
  dayLabel,
  formatDuration,
  formatKm,
  formatPace,
  sessionSummary,
  sportName,
} from "@/lib/format";
import { ClimbChips } from "./grade";
import { CheckIcon, SportBadge } from "./icons";
import { Button } from "./states";

/** In-chat confirmation that the agent stored a session, with Edit and Undo so
 *  a misread session can be fixed where it happened (design-research.md, item 3).
 *  Undo deletes behind a second tap, like the sheet's Delete (WCAG 3.3.4). */
export function LoggedSessionCard({
  session,
  undone = false,
  edited = false,
  onEdit,
  onUndone,
}: {
  session: Session;
  /** The session was deleted from the card: show it struck through, without actions. */
  undone?: boolean;
  /** The session was changed from the card since the agent logged it. */
  edited?: boolean;
  onEdit: () => void;
  onUndone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      await deleteSession(session.id);
      setConfirming(false);
      onUndone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't undo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (undone) {
    return (
      <div className="rounded-lg border border-dashed border-line p-3 text-ink-muted">
        <p className="text-xs font-medium">Undone · removed from your log</p>
        <p className="truncate text-sm line-through tabular-nums">{sessionSummary(session)}</p>
      </div>
    );
  }

  return (
    <div className="animate-rise rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-3">
        <SportBadge sport={session.sport} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-xs font-medium text-accent">
            <CheckIcon size={12} /> {edited ? "Edited" : "Logged"} · {dayLabel(session.date)}
          </p>
          <p className="truncate text-sm font-semibold tabular-nums">{sessionSummary(session)}</p>
        </div>
      </div>
      {session.climbs && session.climbs.length > 0 && (
        <div className="mt-2.5 pl-11">
          <ClimbChips climbs={session.climbs} max={6} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="mt-3 flex items-center gap-2">
          <p className="flex-1 text-sm">Remove this session from your log?</p>
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Keep
          </Button>
          <Button onClick={undo} disabled={busy} className="bg-danger!">
            {busy ? "Removing…" : "Remove"}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button variant="ghost" onClick={onEdit} className="flex-1 border border-line">
            Edit
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirming(true)}
            className="flex-1 border border-line"
          >
            Undo
          </Button>
        </div>
      )}
    </div>
  );
}

function stats(s: Session): string[] {
  const out: string[] = [];
  if (s.distance_km) out.push(formatKm(s.distance_km));
  out.push(formatDuration(s.duration_min));
  if (s.pace_min_per_km) out.push(`${formatPace(s.pace_min_per_km)} /km`);
  if (s.climbs?.length) out.push(`${s.climbs_sent ?? 0}/${s.climbs.length} sent`);
  out.push(`effort ${s.effort}`);
  return out;
}

/** A row in the sessions list. The whole row opens the details. */
export function SessionRow({ session, onOpen }: { session: Session; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-sunken"
      aria-label={`${sportName(session)} on ${dayLabel(session.date)}: ${stats(session).join(", ")}. Show details`}
    >
      <SportBadge sport={session.sport} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-semibold">{sportName(session)}</p>
          <p className="shrink-0 text-xs text-ink-muted">{dayLabel(session.date)}</p>
        </div>
        <p className="mt-0.5 text-sm text-ink-muted tabular-nums">{stats(session).join(" · ")}</p>
        {session.climbs && session.climbs.length > 0 && (
          <div className="mt-2">
            <ClimbChips climbs={session.climbs} max={5} />
          </div>
        )}
      </div>
    </button>
  );
}
