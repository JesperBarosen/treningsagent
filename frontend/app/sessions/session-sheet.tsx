"use client";

import { useEffect, useRef, useState } from "react";
import { climbLabel, ClimbLegend, GradeDot } from "@/components/grade";
import { BoltIcon, CheckIcon, CloseIcon, SportBadge } from "@/components/icons";
import { SessionForm } from "@/components/session-form";
import { Button } from "@/components/states";
import {
  ApiError,
  deleteSession,
  GRADES,
  updateSession,
  type Climb,
  type Session,
  type SessionInput,
} from "@/lib/api";
import {
  climbOutcome,
  formatDuration,
  formatKm,
  formatPace,
  fullDate,
  nf,
  sportName,
} from "@/lib/format";

/** Session details: a bottom sheet on mobile, a centred dialog from `sm`.
 *  Uses <dialog> for focus trapping, Escape and the backdrop for free. */
export function SessionSheet({
  session,
  onClose,
  onChanged,
  startEditing = false,
}: {
  session: Session | null;
  onClose: () => void;
  /** After an edit (with the updated session) or a delete (with nothing):
   *  the parent closes the sheet and reloads or updates what it shows. */
  onChanged: (updated?: Session) => void;
  /** Open straight in the edit form; Cancel then closes the sheet. */
  startEditing?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (session && !dialog.open) dialog.showModal();
    if (!session && dialog.open) dialog.close();
  }, [session]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()} // backdrop click
      aria-labelledby="session-title"
      className="m-0 mt-auto max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-lg bg-surface text-ink shadow-sheet backdrop:bg-ink/40 open:animate-rise sm:m-auto sm:max-w-lg sm:rounded-lg"
    >
      {session && (
        <SheetBody
          key={session.id}
          session={session}
          onClose={onClose}
          onChanged={onChanged}
          startEditing={startEditing}
        />
      )}
    </dialog>
  );
}

function withOrdinals(climbs: SessionInput["climbs"]): Climb[] | undefined {
  return climbs?.map((c) => ({ ...c, grade_ordinal: GRADES.indexOf(c.grade) + 1 }));
}

function SheetBody({
  session,
  onClose,
  onChanged,
  startEditing,
}: {
  session: Session;
  onClose: () => void;
  onChanged: (updated?: Session) => void;
  startEditing: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  if (!editing) {
    return (
      <Details session={session} onClose={onClose}>
        <SheetActions
          id={session.id}
          onEdit={() => setEditing(true)}
          onDeleted={() => onChanged()}
        />
      </Details>
    );
  }
  return (
    <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
      <h2 id="session-title" className="mb-4 font-display text-lg font-semibold">
        Edit session
      </h2>
      <SessionForm
        session={session}
        editing
        onCancel={() => (startEditing ? onClose() : setEditing(false))}
        onSubmit={async (input) => {
          const updated = await updateSession(session.id, input);
          // PATCH returns the session without its climbs; the form just sent them.
          onChanged({ ...updated, climbs: updated.climbs ?? withOrdinals(input.climbs) });
        }}
      />
    </div>
  );
}

/** Edit, and delete behind a second tap so one slip can't lose a session. */
function SheetActions({
  id,
  onEdit,
  onDeleted,
}: {
  id: number;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteSession(id);
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete the session.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-line pt-4">
      {error && (
        <p role="alert" className="mb-3 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-sm">Delete this session?</p>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button onClick={remove} disabled={busy} className="bg-danger!">
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onEdit} className="flex-1 border border-line">
            Edit
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirming(true)}
            className="flex-1 border border-line text-danger"
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}

function Details({
  session: s,
  onClose,
  children,
}: {
  session: Session;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const stats: [string, string][] = [];
  if (s.distance_km) stats.push(["Distance", formatKm(s.distance_km)]);
  stats.push(["Duration", formatDuration(s.duration_min)]);
  if (s.pace_min_per_km) stats.push(["Pace", `${formatPace(s.pace_min_per_km)} /km`]);
  if (s.elevation_m) stats.push(["Elevation", `${nf.format(s.elevation_m)} m`]);
  stats.push(["Effort", `${s.effort} / 10`]);
  if (s.load !== undefined) stats.push(["Load", nf.format(s.load)]);
  if (s.climbs?.length) {
    stats.push(["Sent", `${s.climbs_sent ?? 0} of ${s.climbs.length}`]);
  }

  return (
    <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <SportBadge sport={s.sport} />
        <div className="min-w-0 flex-1">
          <h2 id="session-title" className="font-display text-lg font-semibold">
            {sportName(s)}
          </h2>
          <p className="text-sm text-ink-muted">{fullDate(s.date)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          autoFocus
          className="-mt-1 -mr-2 grid size-11 place-items-center rounded-full text-ink-muted hover:bg-sunken"
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-2 min-[400px]:grid-cols-3">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-md border border-line bg-canvas px-3 py-2.5">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="font-display text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-muted">Load = minutes × effort (session-RPE).</p>

      {s.notes && (
        <p className="mt-4 rounded-md bg-sunken px-4 py-3 text-sm">{s.notes}</p>
      )}

      {s.climbs && s.climbs.length > 0 && (
        <section className="mt-5" aria-labelledby="climbs-title">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 id="climbs-title" className="font-semibold">
              Climbs
            </h3>
            <ClimbLegend />
          </div>
          <ul className="divide-y divide-line rounded-md border border-line">
            {[...s.climbs]
              .sort((a, b) => b.grade_ordinal - a.grade_ordinal)
              .map((c, i) => (
                <ClimbRow key={i} climb={c} />
              ))}
          </ul>
        </section>
      )}
      {children}
    </div>
  );
}

const STYLE_NAMES = { boulder: "Boulder", kilter: "Kilter board", rope: "Rope" } as const;

function ClimbRow({ climb: c }: { climb: Climb }) {
  const outcome = climbOutcome(c);
  return (
    <li className="flex min-h-11 items-center gap-3 px-3 py-2" aria-label={climbLabel(c)}>
      <GradeDot grade={c.grade} size={14} />
      <div className="min-w-0 flex-1" aria-hidden="true">
        <p className="text-sm font-medium capitalize">{c.grade}</p>
        <p className="text-xs text-ink-muted">
          {STYLE_NAMES[c.style]}
          {c.attempts ? ` · ${c.attempts} ${c.attempts === 1 ? "attempt" : "attempts"}` : ""}
          {c.notes ? ` · ${c.notes}` : ""}
        </p>
      </div>
      <span
        aria-hidden="true"
        className={`inline-flex items-center gap-1 text-xs font-medium ${
          outcome === "tried" ? "text-ink-muted" : "text-accent"
        }`}
      >
        {outcome === "flash" && <BoltIcon size={12} />}
        {outcome === "sent" && <CheckIcon size={12} />}
        {outcome === "flash" ? "Flash" : outcome === "sent" ? "Sent" : "Not sent"}
      </span>
    </li>
  );
}
