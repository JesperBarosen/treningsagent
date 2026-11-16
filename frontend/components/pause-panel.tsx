"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { DateInput } from "@/components/date-input";
import {
  ApiError,
  editPause,
  endPause,
  getPause,
  PAUSE_REASONS,
  startPause,
  type Pause,
  type PauseReason,
} from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { shortDate } from "@/lib/format";
import { Button, HIT_AREA_Y } from "./states";

// Pausing tracking on purpose (N5, docs/design-proposals-2.md). Wording stays
// neutral: the app records what the user notes and never diagnoses.

const REASON_LABEL: Record<PauseReason, string> = {
  injury: "Injury",
  illness: "Illness",
  travel: "Travel",
  other: "Other",
};

/** Shown with an injury: a suggestion, not advice about the injury itself. */
export const PHYSIO_HINT = "If the pain persists or gets worse, consider seeing a physiotherapist.";

/** "since 2 Nov · injury · until 23 Nov". */
export function pauseSummary(p: Pause): string {
  const parts = [`since ${shortDate(p.start_date)}`, REASON_LABEL[p.reason].toLowerCase()];
  if (p.planned_end) parts.push(`until ${shortDate(p.planned_end)}`);
  return parts.join(" · ");
}

/** The two ways back, asked when a break ends. */
function ResumeChoice({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function end(choice: "continue" | "fresh") {
    setBusy(true);
    setError(null);
    try {
      await endPause(choice);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't end the break. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <p className="text-sm font-medium">When the break ends</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={() => end("continue")} disabled={busy}>
          Pick up where I left off
        </Button>
        <Button variant="ghost" onClick={() => end("fresh")} disabled={busy} className="border border-control">
          Start fresh
        </Button>
      </div>
      <p className="mt-2 text-meta text-ink-muted">Start fresh hides the old baseline for 4 weeks. Nothing is deleted.</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The calm banner while a break is on (Dashboard and You), with Edit and End break. */
export function PauseBanner({
  pause,
  onEnded,
  onEdited,
}: {
  pause: Pause;
  onEnded: () => void;
  /** After an edit (#82), with the updated break. */
  onEdited: (p: Pause) => void;
}) {
  const [ending, setEnding] = useState(false);
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <section aria-label="Edit break" className="mb-4">
        <PauseForm
          pause={pause}
          onCancel={() => setEditing(false)}
          onStarted={(p) => {
            setEditing(false);
            onEdited(p);
          }}
        />
      </section>
    );
  }
  return (
    <section aria-label="On a break" className="mb-4 rounded-lg border border-line bg-sunken p-4">
      <p className="font-semibold">On a break</p>
      <p {...SENSITIVE} className="text-sm text-ink-muted">
        {pauseSummary(pause)}
      </p>
      <p className="mt-1 text-sm">Trends and the ratio leave these days out.</p>
      {pause.reason === "injury" && <p className="mt-1 text-sm text-ink-muted">{PHYSIO_HINT}</p>}
      {ending ? (
        <ResumeChoice onDone={onEnded} />
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setEditing(true)} className="-ml-1 border border-control">
            Edit
          </Button>
          <Button variant="ghost" onClick={() => setEnding(true)} className="border border-control">
            End break
          </Button>
        </div>
      )}
    </section>
  );
}

/** "Take a break" on the You page: start one, or see and end the one that is on. */
export function PauseControl() {
  const [state, setState] = useState<{ loaded: boolean; active: Pause | null }>({ loaded: false, active: null });
  const [open, setOpen] = useState(false);

  function load() {
    getPause()
      .then((p) => setState({ loaded: true, active: p.active }))
      .catch(() => setState({ loaded: true, active: null }));
  }
  useEffect(load, []);

  if (!state.loaded) return null;
  if (state.active) {
    return (
      <PauseBanner
        pause={state.active}
        onEnded={() => {
          setOpen(false);
          load();
        }}
        onEdited={(p) => setState({ loaded: true, active: p })}
      />
    );
  }
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} className="w-full border border-control">
        Take a break
      </Button>
    );
  }
  return (
    <PauseForm
      onCancel={() => setOpen(false)}
      onStarted={(p) => {
        setOpen(false);
        setState({ loaded: true, active: p });
      }}
    />
  );
}

/** Start a break, or with `pause`, edit the one that is on (#82): the same
 *  form, prefilled. Switching away from Injury drops body part and pain. */
export function PauseForm({
  pause,
  onStarted,
  onCancel,
}: {
  pause?: Pause;
  /** With the started or edited break. */
  onStarted: (p: Pause) => void;
  onCancel: () => void;
}) {
  const editing = pause !== undefined;
  const [reason, setReason] = useState<PauseReason | null>(pause?.reason ?? null);
  const [bodyPart, setBodyPart] = useState(pause?.body_part ?? "");
  const [pain, setPain] = useState<number | null>(pause?.pain ?? null);
  const [note, setNote] = useState(pause?.note ?? "");
  const [until, setUntil] = useState(pause?.planned_end ?? "");
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field =
    "min-h-11 w-full rounded-md border border-control bg-surface px-3 text-base text-ink placeholder:text-ink-muted";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const injury = reason === "injury";
      const input = {
        reason,
        body_part: injury ? bodyPart.trim() || null : null,
        pain: injury ? pain : null,
        note: note.trim() || null,
        planned_end: until || null,
      };
      onStarted(await (editing ? editPause(input) : startPause(input)));
    } catch (err) {
      const fallback = editing ? "Couldn't save the break." : "Couldn't start the break.";
      setError(err instanceof ApiError ? err.message : fallback);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4" noValidate>
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium">Why are you taking a break?</legend>
        <div role="radiogroup" aria-label="Reason" className="grid grid-cols-2 gap-2">
          {PAUSE_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className="min-h-11 rounded-md border border-control px-3 font-medium aria-checked:border-accent aria-checked:bg-accent-soft aria-checked:text-accent"
            >
              {REASON_LABEL[r]}
            </button>
          ))}
        </div>
      </fieldset>

      {reason === "injury" && (
        <>
          <label className="text-sm font-medium">
            Where? <span className="font-normal text-ink-muted">(optional)</span>
            <input
              value={bodyPart}
              onChange={(e) => setBodyPart(e.target.value)}
              maxLength={60}
              placeholder="e.g. left knee"
              className={`${field} mt-1.5`}
            />
          </label>
          <fieldset className="min-w-0">
            <legend className="text-sm font-medium">
              Pain right now, 0–10 <span className="font-normal text-ink-muted">(optional)</span>
            </legend>
            <div role="radiogroup" aria-label="Pain from 0 to 10" className="mt-1.5 flex flex-wrap gap-1.5">
              {Array.from({ length: 11 }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={pain === n}
                  aria-label={`Pain ${n}`}
                  onClick={() => setPain(pain === n ? null : n)}
                  className={`min-h-9 min-w-9 rounded-full border border-control text-sm tabular-nums aria-checked:border-accent aria-checked:bg-accent-soft aria-checked:text-accent ${HIT_AREA_Y}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="text-sm text-ink-muted">{PHYSIO_HINT}</p>
        </>
      )}

      {reason && (
        <>
          <label className="text-sm font-medium">
            Note <span className="font-normal text-ink-muted">(optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              className={`${field} mt-1.5 resize-none py-2`}
            />
          </label>
          <div>
            <label htmlFor={`${uid}-until`} className="text-sm font-medium">
              Back by <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <DateInput
              id={`${uid}-until`}
              value={until}
              onChange={setUntil}
              optional
              min={pause?.start_date}
              className="mt-1.5"
            />
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!reason || busy} className="flex-1">
          {editing ? (busy ? "Saving…" : "Save break") : busy ? "Starting…" : "Start break"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
