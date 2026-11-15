"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { DateInput } from "@/components/date-input";
import {
  addGoal,
  ApiError,
  changeGoal,
  deleteGoal,
  DISTANCE_BANDS,
  getGoals,
  GRADES,
  type DistanceBand,
  type Goal,
  type GoalInput,
  type Grade,
  type GradeGoal,
  type PaceGoal,
} from "@/lib/api";
import { BAND_LABELS } from "@/lib/dashboard";
import { SENSITIVE } from "@/lib/discreet";
import { formatPace, shortDate } from "@/lib/format";
import { GradeDot } from "./grade";
import { CheckIcon, ChevronIcon, PlusIcon } from "./icons";
import { Button } from "./states";

// Outcome goals (N2, docs/design-proposals-2.md). Progress is shown abstractly
// (grade steps, a pace bar) with the numbers underneath. A goal is never red
// and never "failed": a passed date only asks keep, move or let go.

/** "Send a red by 1 Mar" / "7–15 km at 5:00 /km by 30 Apr". */
export function goalTitle(g: Goal): string {
  const what = goalWhat(g);
  return g.target_date ? `${what} by ${shortDate(g.target_date)}` : what;
}

/** The goal Coach shows (#83): an active goal not yet reached, the one with the
 *  nearest date first, then the oldest. Null when there is none. */
export function coachGoal(goals: Goal[]): Goal | null {
  const open = goals.filter((g) => g.status === "active" && !g.progress.reached_on);
  const key = (g: Goal) => g.target_date ?? "9999-12-31";
  return open.sort((a, b) => key(a).localeCompare(key(b)) || a.id - b.id)[0] ?? null;
}

/** "3 weeks left", "5 days left", "due today", "date passed", or null without a date. */
export function timeLeft(target: string | null, today: Date = new Date()): string | null {
  if (!target) return null;
  const [y, m, d] = target.split("-").map(Number);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((Date.UTC(y, m - 1, d) - start) / 86_400_000);
  if (days < 0) return "date passed";
  if (days === 0) return "due today";
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} left`;
  return `${Math.floor(days / 7)} weeks left`;
}

/** What the goal is, without the date: "Send a red", "7–15 km at 5:00 /km". */
function goalWhat(g: Goal): string {
  return g.kind === "climb_grade"
    ? `${g.climb_mode === "flash" ? "Flash" : "Send"} a ${g.grade}`
    : `${BAND_LABELS[g.band]} at ${formatPace(g.target_pace)} /km`;
}

/** One line on Coach, in the "This week" glance (#83): the goal and the time
 *  left, linking to the goal on the Dashboard. Nothing (no height) without one. */
export function GoalLine({ goal, today }: { goal: Goal | null; today?: Date }) {
  if (!goal) return null;
  const left = timeLeft(goal.target_date, today);
  return (
    <Link
      href={`/dashboard#goal-${goal.id}`}
      className="flex min-h-11 items-center gap-1 text-sm text-ink-muted hover:text-ink"
    >
      <span className="font-medium text-ink">Goal</span>
      <span {...SENSITIVE} className="min-w-0 truncate tabular-nums">
        {goalWhat(goal)}
        {left && ` · ${left}`}
      </span>
      <ChevronIcon size={14} className="shrink-0" />
    </Link>
  );
}

/** Pace typed as "5:00" or "5.0" -> 5.0 min/km; null if it can't be read. */
export function parsePace(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?$|^(\d{1,2}[.,]\d+)$/);
  if (!m) return null;
  if (m[3]) return Number(m[3].replace(",", "."));
  const seconds = m[2] ? Number(m[2]) : 0;
  return seconds < 60 ? Number(m[1]) + seconds / 60 : null;
}

function GradeSteps({ goal }: { goal: GradeGoal }) {
  const p = goal.progress;
  const scale = GRADES.slice(0, p.of);
  return (
    <>
      <div className="mt-3 flex items-center gap-1.5" aria-hidden="true">
        {scale.map((g, i) => (
          <span key={g} className={i < p.steps ? "" : "opacity-30"}>
            <GradeDot grade={g} size={14} />
          </span>
        ))}
      </div>
      <p {...SENSITIVE} className="mt-2 text-sm text-ink-muted">
        {p.steps} of {p.of} steps
        {p.best_grade && p.best_count_28d > 0
          ? ` · ${p.best_grade} ${goal.climb_mode === "flash" ? "flashed" : "sent"} ${p.best_count_28d} ${p.best_count_28d === 1 ? "time" : "times"} this month`
          : ""}
      </p>
    </>
  );
}

function PaceBar({ goal }: { goal: PaceGoal }) {
  const p = goal.progress;
  return (
    <>
      <div className="relative mt-3 h-2 rounded-full bg-sunken" aria-hidden="true">
        {p.fraction !== null && (
          <div className="h-2 rounded-full bg-chart-run" style={{ width: `${Math.max(p.fraction * 100, 4)}%` }} />
        )}
      </div>
      <dl {...SENSITIVE} className="mt-2 flex justify-between text-sm text-ink-muted tabular-nums">
        <div>
          <dt className="sr-only">At start</dt>
          <dd>{p.start_pace !== null ? `${formatPace(p.start_pace)} at start` : "No start yet"}</dd>
        </div>
        <div>
          <dt className="sr-only">Now</dt>
          <dd className="text-ink">{p.now_pace !== null ? `${formatPace(p.now_pace)} now` : "No runs yet"}</dd>
        </div>
        <div>
          <dt className="sr-only">Goal</dt>
          <dd>{formatPace(p.target_pace)} goal</dd>
        </div>
      </dl>
    </>
  );
}

function GoalCard({ goal, onChanged }: { goal: Goal; onChanged: () => void }) {
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(goal.target_date ?? "");
  const uid = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      setMoving(false);
      setConfirmDelete(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const reached = goal.status === "achieved";
  const outline = "border border-control";
  return (
    <li
      id={`goal-${goal.id}`}
      aria-label={goalTitle(goal)}
      className="scroll-mt-20 rounded-lg border border-line bg-surface p-4 target:border-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          {goal.kind === "climb_grade" && (
            <span className="mr-2 inline-flex align-middle">
              <GradeDot grade={goal.grade} size={12} />
            </span>
          )}
          {goalTitle(goal)}
        </p>
        {goal.status === "paused" && (
          <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-sunken px-2.5 text-xs text-ink-muted">Paused</span>
        )}
      </div>

      {goal.kind === "climb_grade" ? <GradeSteps goal={goal} /> : <PaceBar goal={goal} />}

      {reached && goal.achieved_on && (
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent">
          <CheckIcon size={14} /> Reached {shortDate(goal.achieved_on)}
        </p>
      )}

      {goal.overdue && !moving && (
        <div className="mt-3 rounded-md bg-sunken p-3 text-sm">
          <p>The date has passed. Keep it, move the date, or let it go?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" className={outline} disabled={busy} onClick={() => act(() => changeGoal(goal.id, { target_date: null }))}>
              Keep it
            </Button>
            <Button variant="ghost" className={outline} disabled={busy} onClick={() => setMoving(true)}>
              Move the date
            </Button>
            <Button variant="ghost" className={outline} disabled={busy} onClick={() => act(() => changeGoal(goal.id, { status: "dropped" }))}>
              Let it go
            </Button>
          </div>
        </div>
      )}

      {moving && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 basis-56">
            <label htmlFor={`${uid}-date`} className="text-sm font-medium">
              New date
            </label>
            <DateInput id={`${uid}-date`} value={date} onChange={setDate} optional className="mt-1" />
          </div>
          {/* An empty date saves the goal without one (Clear, then Save). */}
          <Button disabled={busy} onClick={() => act(() => changeGoal(goal.id, { target_date: date || null }))}>
            Save date
          </Button>
          <Button variant="ghost" onClick={() => setMoving(false)}>
            Cancel
          </Button>
        </div>
      )}

      {!reached && !goal.overdue && !moving && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            className={outline}
            disabled={busy}
            onClick={() => act(() => changeGoal(goal.id, { status: goal.status === "paused" ? "active" : "paused" }))}
          >
            {goal.status === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button variant="ghost" className={outline} disabled={busy} onClick={() => setMoving(true)}>
            {goal.target_date ? "Move date" : "Add a date"}
          </Button>
          {confirmDelete ? (
            <Button variant="ghost" className={outline} disabled={busy} onClick={() => act(() => deleteGoal(goal.id))}>
              Remove for good
            </Button>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Remove
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

export function AddGoalForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<"climb_grade" | "run_pace">("climb_grade");
  const [grade, setGrade] = useState<Grade>("red");
  const [mode, setMode] = useState<"send" | "flash">("send");
  const [band, setBand] = useState<DistanceBand>("7_to_15km");
  const [pace, setPace] = useState("");
  const [date, setDate] = useState("");
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "mt-1 block min-h-11 w-full rounded-md border border-control bg-surface px-3 text-base";
  const target = parsePace(pace);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input: GoalInput | null =
      kind === "climb_grade"
        ? { kind, grade, climb_mode: mode, target_date: date || null }
        : target !== null
          ? { kind, band, target_pace: Math.round(target * 100) / 100, target_date: date || null }
          : null;
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      await addGoal(input);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add the goal.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4" noValidate>
      <div role="radiogroup" aria-label="Goal type" className="grid grid-cols-2 gap-2">
        {(
          [
            ["climb_grade", "Climbing grade"],
            ["run_pace", "Running pace"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className="min-h-11 rounded-md border border-control px-3 font-medium aria-checked:border-accent aria-checked:bg-accent-soft aria-checked:text-accent"
          >
            {label}
          </button>
        ))}
      </div>

      {kind === "climb_grade" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">
            Grade
            <select value={grade} onChange={(e) => setGrade(e.target.value as Grade)} className={`${field} capitalize`}>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            How
            <select value={mode} onChange={(e) => setMode(e.target.value as "send" | "flash")} className={field}>
              <option value="send">Send it</option>
              <option value="flash">Flash it</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">
            Distance
            <select value={band} onChange={(e) => setBand(e.target.value as DistanceBand)} className={field}>
              {DISTANCE_BANDS.map((b) => (
                <option key={b} value={b}>
                  {BAND_LABELS[b]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Pace (min/km)
            <input value={pace} onChange={(e) => setPace(e.target.value)} inputMode="decimal" placeholder="5:00" className={field} />
          </label>
        </div>
      )}

      <div>
        <label htmlFor={`${uid}-by`} className="text-sm font-medium">
          By <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <DateInput id={`${uid}-by`} value={date} onChange={setDate} optional className="mt-1" />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || (kind === "run_pace" && target === null)} className="flex-1">
          {busy ? "Adding…" : "Add goal"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The Goals section at the top of the Dashboard. Goals the user let go are hidden. */
export function GoalsSection() {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    getGoals(signal)
      .then(setGoals)
      .catch(() => {
        if (!signal?.aborted) setGoals(null);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Coach's goal line links to /dashboard#goal-<id> (#83). The cards render
  // after the goals load, too late for the browser's own jump, so scroll here.
  const loaded = goals !== null;
  useEffect(() => {
    if (!loaded || !window.location.hash.startsWith("#goal-")) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [loaded]);

  const shown = (goals ?? []).filter((g) => g.status !== "dropped");
  return (
    <section aria-labelledby="goals-title" className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="goals-title" className="font-display text-lg font-semibold">
          Goals
        </h2>
        {!adding && (
          <Button variant="ghost" onClick={() => setAdding(true)} className="-mr-3">
            <PlusIcon size={16} /> Add a goal
          </Button>
        )}
      </div>
      {adding && (
        <AddGoalForm
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {shown.length > 0 && (
        <ul className="mt-2 space-y-2">
          {shown.map((g) => (
            <GoalCard key={g.id} goal={g} onChanged={() => load()} />
          ))}
        </ul>
      )}
      {goals !== null && shown.length === 0 && !adding && (
        <p className="text-sm text-ink-muted">Something to aim for, like a grade or a pace. Optional, and you can change it any time.</p>
      )}
    </section>
  );
}
