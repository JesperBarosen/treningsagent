"use client";

import { useState, type ReactNode } from "react";
import { ApiError, linkPlanned, unlinkPlanned, type PlanLink, type PlannedSession } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { plannedName } from "@/lib/plans";

/** What happened, for the chat to tell the coach. */
export type LinkChange =
  | { kind: "linked"; planned: PlannedSession }
  | { kind: "unlinked"; planned: PlannedSession }
  | { kind: "none" };

const ACTION =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-control px-4 text-sm font-semibold text-ink hover:bg-sunken disabled:opacity-40";

/** After a session is logged (#117, Q6 option A): "Counted as Thursday's Easy
 *  run" with Undo when it was linked, or "Was this Thursday's Easy run?" when
 *  the server found matches it didn't link on its own. Nothing when nothing
 *  planned matches. Matching is about the day, never the numbers (P9). */
export function PlanLinkNotice({
  sessionId,
  link,
  onChange,
}: {
  sessionId: number;
  link: PlanLink | undefined;
  onChange?: (change: LinkChange, link: PlanLink) => void;
}) {
  const [current, setCurrent] = useState<PlanLink>(link ?? {});
  const [undone, setUndone] = useState<PlannedSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function settle(next: PlanLink, change: LinkChange) {
    setCurrent(next);
    onChange?.(change, next);
  }

  const accept = (p: PlannedSession) =>
    run(async () => {
      const planned = await linkPlanned(p.id as number, sessionId);
      setUndone(null);
      settle({ linked: planned, auto: false }, { kind: "linked", planned });
    });

  const undo = (p: PlannedSession) =>
    run(async () => {
      const planned = await unlinkPlanned(p.id as number);
      setUndone(planned);
      settle({}, { kind: "unlinked", planned });
    });

  let body: ReactNode = null;
  if (current.linked) {
    const p = current.linked;
    body = (
      <>
        <p className="min-w-0 flex-1">Counted as {plannedName(p, today)}.</p>
        <button
          type="button"
          onClick={() => undo(p)}
          disabled={busy}
          aria-label={`Undo: don't count it as ${plannedName(p, today)}`}
          className={ACTION}
        >
          Undo
        </button>
      </>
    );
  } else if (current.candidates?.length) {
    const [only] = current.candidates;
    body =
      current.candidates.length === 1 ? (
        <>
          <p className="w-full">Was this {plannedName(only, today)}?</p>
          <button type="button" onClick={() => accept(only)} disabled={busy} className={ACTION}>
            Yes
          </button>
          <button type="button" onClick={() => settle({}, { kind: "none" })} disabled={busy} className={ACTION}>
            No
          </button>
        </>
      ) : (
        <>
          <p className="w-full">Was this one of your planned sessions?</p>
          {current.candidates.map((p) => (
            <button key={p.id} type="button" onClick={() => accept(p)} disabled={busy} className={ACTION}>
              {plannedName(p, today).replace(/^./, (c) => c.toUpperCase())}
            </button>
          ))}
          <button type="button" onClick={() => settle({}, { kind: "none" })} disabled={busy} className={ACTION}>
            None of these
          </button>
        </>
      );
  } else if (undone) {
    body = <p>No longer counted as {plannedName(undone, today)}.</p>;
  }
  if (!body) return null;
  return (
    <div role="status" aria-label="Plan" className="rounded-md bg-sunken px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">{body}</div>
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
