"use client";

import { useState, type FormEvent } from "react";
import { ApiError, WEEKDAYS, type Injury, type ProfileChanges, type TrainingProfile } from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { DAY_SHORT } from "@/lib/profile";
import { CloseIcon, PlusIcon } from "./icons";
import { Button } from "./states";

const field = "block min-h-11 w-full min-w-0 rounded-md border border-control bg-surface px-3 text-base text-ink tabular-nums";
const label = "mb-1 block text-sm font-medium";
const chip =
  "inline-flex min-h-11 items-center rounded-full border border-control bg-surface px-3.5 text-sm font-medium text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent";

const num = (text: string): number | null => {
  const t = text.trim().replace(",", ".");
  return t === "" ? null : Number(t);
};

/** The training profile's fields (#137): the first-login step and the You tab
 *  editor. Every field is optional. Values blur in discreet mode, labels stay.
 *  Saves every field at once; the caller adds `onboarding` when it needs to. */
export function ProfileForm({
  initial,
  onSave,
  saveLabel = "Save",
  extra,
}: {
  initial: TrainingProfile;
  onSave: (changes: ProfileChanges) => Promise<void>;
  saveLabel?: string;
  /** More buttons next to Save, e.g. Skip in the first-login step. */
  extra?: React.ReactNode;
}) {
  const [sessions, setSessions] = useState(initial.sessions_per_week ? String(initial.sessions_per_week) : "");
  const [days, setDays] = useState(new Set(initial.preferred_days));
  const [longest, setLongest] = useState(initial.longest_run_km != null ? String(initial.longest_run_km) : "");
  const [weekly, setWeekly] = useState(initial.weekly_run_km != null ? String(initial.weekly_run_km) : "");
  const [climbing, setClimbing] = useState(initial.climbing_level ?? "");
  const [injuries, setInjuries] = useState<Injury[]>(initial.injuries);
  const [other, setOther] = useState(initial.other_sports ?? "");
  const [goals, setGoals] = useState(initial.goals_note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bad =
    [longest, weekly].some((t) => t.trim() !== "" && !Number.isFinite(num(t))) ||
    injuries.some((i) => !i.body_part.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (bad) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        sessions_per_week: sessions ? Number(sessions) : null,
        preferred_days: WEEKDAYS.filter((d) => days.has(d)),
        longest_run_km: num(longest),
        weekly_run_km: num(weekly),
        climbing_level: climbing.trim() || null,
        injuries: injuries.map((i) => ({ ...i, body_part: i.body_part.trim(), note: i.note?.trim() || null })),
        other_sports: other.trim() || null,
        goals_note: goals.trim() || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const setInjury = (i: number, change: Partial<Injury>) =>
    setInjuries((list) => list.map((x, j) => (j === i ? { ...x, ...change } : x)));

  return (
    <form onSubmit={submit} className="min-w-0 space-y-4" aria-label="Training profile">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div>
          <label htmlFor="pf-sessions" className={label}>
            Sessions a week
          </label>
          <select id="pf-sessions" value={sessions} onChange={(e) => setSessions(e.target.value)} className={field}>
            <option value="">Not set</option>
            {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pf-climbing" className={label}>
            Climbing level
          </label>
          <input id="pf-climbing" value={climbing} onChange={(e) => setClimbing(e.target.value)} maxLength={60}
            placeholder="e.g. projecting V5" className={field} {...SENSITIVE} />
        </div>
      </div>

      <fieldset className="min-w-0">
        <legend className={label}>Days you can train</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.has(d)}
              onClick={() =>
                setDays((s) => {
                  const next = new Set(s);
                  if (next.has(d)) next.delete(d);
                  else next.add(d);
                  return next;
                })
              }
              className={chip}
            >
              {DAY_SHORT[d]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div>
          <label htmlFor="pf-longest" className={label}>
            Longest recent run (km)
          </label>
          <input id="pf-longest" inputMode="decimal" value={longest} onChange={(e) => setLongest(e.target.value)}
            className={field} {...SENSITIVE} />
        </div>
        <div>
          <label htmlFor="pf-weekly" className={label}>
            Typical week (km)
          </label>
          <input id="pf-weekly" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value)}
            className={field} {...SENSITIVE} />
        </div>
      </div>

      <fieldset className="min-w-0">
        <legend className={label}>Injuries or pain</legend>
        <p className="mb-2 text-xs text-ink-muted">
          The coach never diagnoses; it plans more gently around these. If pain persists, see a physiotherapist.
        </p>
        <ul className="space-y-2">
          {injuries.map((inj, i) => (
            <li key={i} className="rounded-md border border-line p-2.5">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`pf-part-${i}`} className="mb-1 block text-xs font-medium">
                    Body part
                  </label>
                  <input id={`pf-part-${i}`} value={inj.body_part} maxLength={40}
                    onChange={(e) => setInjury(i, { body_part: e.target.value })} className={field} {...SENSITIVE} />
                </div>
                <div className="w-24 shrink-0">
                  <label htmlFor={`pf-pain-${i}`} className="mb-1 block text-xs font-medium">
                    Pain 0–10
                  </label>
                  <select id={`pf-pain-${i}`} value={inj.pain ?? ""} className={field} {...SENSITIVE}
                    onChange={(e) => setInjury(i, { pain: e.target.value === "" ? null : Number(e.target.value) })}>
                    <option value="">–</option>
                    {Array.from({ length: 11 }, (_, n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setInjuries((list) => list.filter((_, j) => j !== i))}
                  aria-label={`Remove ${inj.body_part || "injury"}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sunken"
                >
                  <CloseIcon size={16} />
                </button>
              </div>
              <label htmlFor={`pf-note-${i}`} className="mt-2 mb-1 block text-xs font-medium">
                Note (optional)
              </label>
              <input id={`pf-note-${i}`} value={inj.note ?? ""} maxLength={200}
                onChange={(e) => setInjury(i, { note: e.target.value })} className={field} {...SENSITIVE} />
            </li>
          ))}
        </ul>
        {injuries.length < 10 && (
          <Button
            variant="ghost"
            className="mt-1 -ml-3 text-accent"
            onClick={() => setInjuries((list) => [...list, { body_part: "", pain: null, note: null }])}
          >
            <PlusIcon size={16} /> Add injury or pain
          </Button>
        )}
      </fieldset>

      <div>
        <label htmlFor="pf-other" className={label}>
          Other sports
        </label>
        <input id="pf-other" value={other} onChange={(e) => setOther(e.target.value)} maxLength={200}
          placeholder="e.g. yoga, cycling to work" className={field} {...SENSITIVE} />
      </div>
      <div>
        <label htmlFor="pf-goals" className={label}>
          Goals, in your words
        </label>
        <textarea id="pf-goals" value={goals} onChange={(e) => setGoals(e.target.value)} maxLength={500} rows={2}
          placeholder="e.g. a half marathon in spring, send a red" className={`${field} py-2.5`} {...SENSITIVE} />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || bad} className="flex-1">
          {busy ? "Saving…" : saveLabel}
        </Button>
        {extra}
      </div>
    </form>
  );
}
