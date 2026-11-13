"use client";

import { useState, useSyncExternalStore } from "react";
import { climbLabel, GradeDot } from "@/components/grade";
import { BoltIcon, CheckIcon, CloseIcon, SportBadge } from "@/components/icons";
import { Button } from "@/components/states";
import {
  ApiError,
  GRADES,
  type Climb,
  type Grade,
  type Session,
  type SessionInput,
  type Sport,
} from "@/lib/api";
import { climbOutcome, formatPace } from "@/lib/format";

type Style = Climb["style"];
type FormClimb = { grade: Grade; style: Style; sent: boolean; attempts: number | null };

const STYLES: { value: Style; label: string }[] = [
  { value: "boulder", label: "Boulder" },
  { value: "kilter", label: "Kilter" },
  { value: "rope", label: "Rope" },
];
const SPORTS: { value: Sport; label: string }[] = [
  { value: "running", label: "Run" },
  { value: "climbing", label: "Climb" },
];

export const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local

const noSubscribe = () => () => {};

/** Today's date, read only in the browser. The server and the prerender see
 *  "" so the date is never frozen into the page at build time (with
 *  cacheComponents, reading the clock during a prerender is an error). */
function useToday(): string {
  return useSyncExternalStore(noSubscribe, today, () => "");
}

/** Tapping a climb row: not sent -> sent -> flash -> not sent. A flash is a
 *  send in one attempt, the same rule the backend and the chips use. */
export function nextOutcome(c: FormClimb): FormClimb {
  switch (climbOutcome(c)) {
    case "tried":
      return { ...c, sent: true, attempts: c.attempts && c.attempts > 1 ? c.attempts : null };
    case "sent":
      return { ...c, sent: true, attempts: 1 };
    case "flash":
      return { ...c, sent: false, attempts: 1 };
  }
}

const field =
  "min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink tabular-nums";
const label = "mb-1 block text-sm font-medium";

/** The Log form. Without `session` it logs a new one; with `session` and
 *  `editing` it edits that session; with `session` alone it starts as a copy
 *  of it dated today ("repeat last session"). */
export function SessionForm({
  session,
  editing = false,
  onSubmit,
  onCancel,
}: {
  session?: Session;
  editing?: boolean;
  onSubmit: (input: SessionInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [sport, setSport] = useState<Sport | null>(session?.sport ?? null);
  const todayIso = useToday();
  // null means "today", resolved after mount; editing keeps the session's own date.
  const [pickedDate, setDate] = useState<string | null>(editing && session ? session.date : null);
  const date = pickedDate ?? todayIso;
  const [duration, setDuration] = useState(session ? String(session.duration_min) : "");
  const [distance, setDistance] = useState(session?.distance_km ? String(session.distance_km) : "");
  const [effort, setEffort] = useState(session?.effort ?? 5);
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [style, setStyle] = useState<Style>(session?.climbs?.[0]?.style ?? "boulder");
  const [climbs, setClimbs] = useState<FormClimb[]>(
    (session?.climbs ?? []).map(({ grade, style, sent, attempts }) => ({
      grade,
      style,
      sent,
      attempts: attempts ?? null,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutes = Number(duration);
  const km = Number(distance.replace(",", "."));
  const durationOk = Number.isInteger(minutes) && minutes > 0;
  const distanceOk = distance === "" || km > 0;
  const valid = sport !== null && date !== "" && durationOk && distanceOk;
  const pace = sport === "running" && durationOk && km > 0 ? formatPace(minutes / km) : null;

  const updateClimb = (i: number, f: (c: FormClimb) => FormClimb) =>
    setClimbs((cs) => cs.map((c, j) => (j === i ? f(c) : c)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !sport) return;
    const input: SessionInput = {
      sport,
      date,
      duration_min: minutes,
      effort,
      notes: notes.trim() || null,
    };
    if (sport === "running" && distance !== "") input.distance_km = km;
    if (sport === "climbing") input.climbs = climbs;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(input);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the session.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <fieldset>
        <legend className={label}>Sport</legend>
        <div role="radiogroup" aria-label="Sport" className="grid grid-cols-2 gap-2">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={sport === s.value}
              onClick={() => setSport(s.value)}
              className="flex min-h-14 items-center gap-3 rounded-md border border-line bg-surface px-3 font-medium aria-checked:border-accent aria-checked:bg-accent-soft"
            >
              <SportBadge sport={s.value} size="sm" />
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      {sport && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="date" className={label}>
                Date
              </label>
              <input
                id="date"
                type="date"
                value={date}
                max={todayIso || undefined}
                onChange={(e) => setDate(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="duration" className={label}>
                Duration (min)
              </label>
              <input
                id="duration"
                type="number"
                inputMode="numeric"
                min={1}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className={field}
              />
            </div>
          </div>

          {sport === "running" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="distance" className={label}>
                  Distance (km)
                </label>
                <input
                  id="distance"
                  type="text"
                  inputMode="decimal"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  aria-invalid={!distanceOk}
                  className={field}
                />
              </div>
              <div>
                <span className={label} id="pace-label">
                  Pace
                </span>
                <output
                  aria-labelledby="pace-label"
                  aria-live="polite"
                  className="flex min-h-11 items-center font-display text-lg font-semibold tabular-nums"
                >
                  {pace ? `${pace} /km` : "–"}
                </output>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="effort" className={`${label} flex justify-between`}>
              <span>Effort</span>
              <span className="tabular-nums text-ink-muted">{effort} / 10</span>
            </label>
            <input
              id="effort"
              type="range"
              min={1}
              max={10}
              step={1}
              value={effort}
              onChange={(e) => setEffort(Number(e.target.value))}
              className="h-11 w-full accent-accent"
            />
            <div className="flex justify-between text-xs text-ink-muted" aria-hidden="true">
              <span>Very easy</span>
              <span>Max</span>
            </div>
          </div>

          {sport === "climbing" && (
            <ClimbsField
              style={style}
              onStyle={setStyle}
              climbs={climbs}
              onAdd={(grade) =>
                setClimbs((cs) => [...cs, { grade, style, sent: false, attempts: 1 }])
              }
              onCycle={(i) => updateClimb(i, nextOutcome)}
              onAttempts={(i, delta) =>
                updateClimb(i, (c) => ({ ...c, attempts: Math.max(1, (c.attempts ?? 1) + delta) }))
              }
              onRemove={(i) => setClimbs((cs) => cs.filter((_, j) => j !== i))}
            />
          )}

          <div>
            <label htmlFor="notes" className={label}>
              Notes
            </label>
            <textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${field} py-2`}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={!valid || busy} className="flex-1">
              {busy ? "Saving…" : editing ? "Save changes" : "Log session"}
            </Button>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </>
      )}
    </form>
  );
}

function ClimbsField({
  style,
  onStyle,
  climbs,
  onAdd,
  onCycle,
  onAttempts,
  onRemove,
}: {
  style: Style;
  onStyle: (s: Style) => void;
  climbs: FormClimb[];
  onAdd: (g: Grade) => void;
  onCycle: (i: number) => void;
  onAttempts: (i: number, delta: number) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className={label}>Climbs</legend>
      <div role="radiogroup" aria-label="Default style" className="inline-flex self-start rounded-full border border-line bg-surface p-1">
        {STYLES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={style === s.value}
            onClick={() => onStyle(s.value)}
            className="min-h-9 rounded-full px-4 text-sm font-medium text-ink-muted aria-checked:bg-accent-soft aria-checked:text-accent"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {GRADES.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onAdd(g)}
            aria-label={`Add ${g}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-sunken px-3 text-sm font-medium capitalize"
          >
            <GradeDot grade={g} size={12} />
            {g}
          </button>
        ))}
      </div>

      {climbs.length > 0 ? (
        <ul className="divide-y divide-line rounded-md border border-line" aria-label="Logged climbs">
          {climbs.map((c, i) => {
            const outcome = climbOutcome(c);
            return (
              <li key={i} className="flex items-center gap-1 pl-3">
                <button
                  type="button"
                  onClick={() => onCycle(i)}
                  aria-label={`${climbLabel(c)}. Tap to change.`}
                  className="flex min-h-11 flex-1 items-center gap-3 text-left"
                >
                  <GradeDot grade={c.grade} size={14} />
                  <span className="flex-1 text-sm font-medium capitalize">{c.grade}</span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      outcome === "tried" ? "text-ink-muted" : "text-accent"
                    }`}
                  >
                    {outcome === "flash" && <BoltIcon size={12} />}
                    {outcome === "sent" && <CheckIcon size={12} />}
                    {outcome === "flash" ? "Flash" : outcome === "sent" ? "Sent" : "Not sent"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onAttempts(i, -1)}
                  aria-label={`Fewer attempts on ${c.grade}`}
                  className="grid size-11 place-items-center rounded-full text-lg hover:bg-sunken"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm tabular-nums" aria-label="attempts">
                  {c.attempts ?? "–"}
                </span>
                <button
                  type="button"
                  onClick={() => onAttempts(i, 1)}
                  aria-label={`More attempts on ${c.grade}`}
                  className="grid size-11 place-items-center rounded-full text-lg hover:bg-sunken"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label={`Remove ${c.grade}`}
                  className="grid size-11 place-items-center rounded-full text-ink-muted hover:bg-sunken"
                >
                  <CloseIcon size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">Tap a grade to add a climb.</p>
      )}
    </fieldset>
  );
}
