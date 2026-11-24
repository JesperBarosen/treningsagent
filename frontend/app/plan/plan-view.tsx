"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PlanIcon, SportBadge } from "@/components/icons";
import { Button, EmptyState, ErrorState, Skeleton } from "@/components/states";
import {
  ApiError,
  changePlan,
  getGoals,
  getPlans,
  leavePlan,
  type Goal,
  type Plan,
  type PlannedSession,
  type WeekMeta,
} from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { handPlannedToForm } from "@/lib/log-planned";
import {
  dateRange,
  goalLine,
  LOGGABLE,
  STATE_LABEL,
  targetText,
  weekChip,
  weekCount,
  weekDays,
  weeksLeft,
} from "@/lib/plans";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string; offline: boolean }
  | { kind: "ready"; plan: Plan | null; goal: Goal | null };

type Action = "pause" | "resume" | "finish" | "leave";

/** What each action asks before it runs. Leaving or finishing deletes nothing (P23). */
const CONFIRM: Record<Action, { question: string; yes: string }> = {
  pause: { question: "Pause this plan? Its sessions stay, and you can resume it any time.", yes: "Pause plan" },
  resume: { question: "Resume this plan?", yes: "Resume plan" },
  finish: {
    question: "Finish this plan? It's kept as a record, and you can ask the coach for a new one.",
    yes: "Finish plan",
  },
  leave: {
    question: "Leave this plan? Nothing is deleted: its sessions stay as a record. Ending a plan early can be the right call.",
    yes: "Leave plan",
  },
};

const DAY_FMT = { weekday: "short", timeZone: "UTC" } as const;

/** The current plan and the goal it serves (goals are optional extras: a failed goals call doesn't block the plan). */
async function loadPlan(signal?: AbortSignal): Promise<Load> {
  const [{ current }, goals] = await Promise.all([getPlans(signal), getGoals(signal).catch(() => [] as Goal[])]);
  const goal = current?.goal_id != null ? (goals.find((g) => g.id === current.goal_id) ?? null) : null;
  return { kind: "ready", plan: current, goal };
}

function failed(e: unknown): Load {
  const err = e instanceof ApiError ? e : new ApiError(String(e), 0);
  return { kind: "error", message: err.message, offline: err.status === null };
}

/** The Plan view (#118, mockup 2): one week at a time, day rows instead of a
 *  table, week chips scrolling inside their own row. Today is highlighted;
 *  done sessions show the logged session that did them; "not done" is grey,
 *  never red, and never counted against the user (P17, P24, Q7). */
export function PlanView() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);

  const fetchPlan = useCallback(async () => {
    try {
      setLoad(await loadPlan());
    } catch (e) {
      setLoad(failed(e));
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    loadPlan(ctrl.signal)
      .then(setLoad)
      .catch((e) => {
        if (!ctrl.signal.aborted) setLoad(failed(e));
      });
    return () => ctrl.abort();
  }, []);

  async function act(plan: Plan, action: Action) {
    setBusy(true);
    setActionError(null);
    try {
      if (action === "leave") await leavePlan(plan.id);
      else await changePlan(plan.id, { status: action === "pause" ? "paused" : action === "resume" ? "active" : "finished" });
      setConfirming(null);
      if (action === "leave" || action === "finish") setEnded(action === "leave" ? "You left the plan." : "Plan finished.");
      await fetchPlan();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (load.kind === "loading") {
    return (
      <div className="space-y-3 pt-4" aria-label="Loading the plan">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (load.kind === "error") {
    return <ErrorState offline={load.offline} message={load.message} onRetry={() => void fetchPlan()} />;
  }
  const { plan, goal } = load;
  if (!plan) {
    return (
      <div className="pt-4">
        <h1 className="font-display text-xl font-semibold">Plan</h1>
        <EmptyState
          icon={<PlanIcon size={26} />}
          title={ended ?? "No plan yet"}
          action={
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent"
            >
              Ask the coach
            </Link>
          }
        >
          Ask the coach for one, e.g. &ldquo;Make me a 6-week plan to send a red&rdquo;. Nothing is saved until you
          accept it.
        </EmptyState>
      </div>
    );
  }

  const today = plan.today ?? new Date().toISOString().slice(0, 10);
  const current = plan.current_week ?? null;
  const count = current ? weekCount(plan.sessions, current) : null;

  return (
    <div className="min-w-0 pt-4 pb-12">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-balance">{plan.name}</h1>
          <p className="text-meta text-ink-muted">
            {plan.weeks} weeks · {dateRange(plan.start_date, plan.end_date)}
            {plan.status === "paused" && " · paused"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5">
        <p className="min-w-0 text-sm">
          {goal ? <>Goal: {goalLine(goal)} · </> : null}
          <span className="text-ink-muted">
            {weeksLeft(plan.end_date, today) === 1 ? "1 week left" : `${weeksLeft(plan.end_date, today)} weeks left`}
          </span>
        </p>
        {count && count.of > 0 && (
          // Counts up only: what's done this week, never what's missing.
          <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-accent-soft px-2.5 text-xs font-semibold text-accent">
            {count.done} of {count.of} this week
          </span>
        )}
      </div>

      <PlanCalendar
        startDate={plan.start_date}
        weeks={plan.weeks}
        weekMeta={plan.week_meta}
        sessions={plan.sessions}
        today={today}
        current={current}
        onLog={(s) => {
          // "Log this" (#132): the Log form opens prefilled and links the two on save.
          handPlannedToForm(s);
          router.push("/log");
        }}
      />

      {actionError && (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      {confirming ? (
        <div role="alertdialog" aria-label={CONFIRM[confirming].yes} className="mt-4 rounded-lg border border-line bg-surface p-3.5">
          <p className="text-sm">{CONFIRM[confirming].question}</p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => act(plan, confirming)} disabled={busy} className="flex-1">
              {busy ? "One moment…" : CONFIRM[confirming].yes}
            </Button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={busy}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-control px-5 text-sm font-semibold text-ink hover:bg-sunken disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ghost" className="text-accent" onClick={() => setConfirming(plan.status === "paused" ? "resume" : "pause")}>
            {plan.status === "paused" ? "Resume plan" : "Pause plan"}
          </Button>
          <Button variant="ghost" className="text-accent" onClick={() => setConfirming("finish")}>
            Finish plan
          </Button>
          <Button variant="ghost" className="text-accent" onClick={() => setConfirming("leave")}>
            Leave plan
          </Button>
        </div>
      )}
    </div>
  );
}

/** Week chips and the week's day rows (#118); also the proposal preview (#135).
 *  Opens on `current` (this week), else on `opensOn` when given, else on the
 *  first week before the plan starts and the last one after it. */
export function PlanCalendar({
  startDate,
  weeks,
  weekMeta,
  sessions,
  today,
  current,
  opensOn,
  onLog,
}: {
  startDate: string;
  weeks: number;
  weekMeta: WeekMeta[];
  sessions: PlannedSession[];
  today: string;
  current: number | null;
  /** The week to open on when no week is the current one. */
  opensOn?: number;
  /** "Log this" on a planned session; left out in the proposal preview, where nothing is stored yet. */
  onLog?: (s: PlannedSession) => void;
}) {
  const [week, setWeek] = useState<number | null>(null);
  const shown = week ?? current ?? opensOn ?? (today < startDate ? 1 : weeks);
  const days = weekDays(startDate, shown);
  return (
    <>
      {/* min-w-0 parents so the chips scroll inside their row at 375 px (#110). */}
      <div
        role="radiogroup"
        aria-label="Week"
        className="scrollbar-none -mx-4 mt-3 flex min-w-0 gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6"
      >
        {weekMeta.map((w) => (
          <button
            key={w.index}
            type="button"
            role="radio"
            aria-checked={w.index === shown}
            onClick={() => setWeek(w.index)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-control bg-surface px-3.5 text-sm font-medium whitespace-nowrap aria-checked:border-accent aria-checked:bg-accent-soft aria-checked:text-accent"
          >
            {weekChip(w)}
            {w.index === current && <span className="sr-only"> (this week)</span>}
          </button>
        ))}
      </div>

      <ol aria-label={`Week ${shown}`} className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface px-3">
        {days.map((d) => (
          <DayRow key={d} day={d} today={d === today} sessions={sessions.filter((s) => s.date === d)} onLog={onLog} />
        ))}
      </ol>
    </>
  );
}

function DayRow({
  day,
  today,
  sessions,
  onLog,
}: {
  day: string;
  today: boolean;
  sessions: PlannedSession[];
  onLog?: (s: PlannedSession) => void;
}) {
  const date = new Date(`${day}T00:00:00Z`);
  return (
    <li
      aria-current={today ? "date" : undefined}
      className={`-mx-3 flex min-h-14 gap-3 px-3 py-2.5 ${today ? "bg-accent-soft/60" : ""}`}
    >
      <div className="w-10 shrink-0 pt-1 text-xs text-ink-muted">
        {date.toLocaleDateString("en-GB", DAY_FMT)}
        <span className={`block font-display text-base font-semibold ${today ? "text-accent" : "text-ink"}`}>
          {date.getUTCDate()}
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {sessions.length === 0 ? (
          <p className="pt-2 text-sm text-ink-muted">{today ? "Today · rest" : "Rest"}</p>
        ) : (
          sessions.map((s) => <PlannedRow key={s.id ?? `${s.date}-${s.slot}`} s={s} onLog={onLog} />)
        )}
      </div>
    </li>
  );
}

function PlannedRow({ s, onLog }: { s: PlannedSession; onLog?: (s: PlannedSession) => void }) {
  const state = s.state ?? "upcoming";
  const loggable = onLog && s.id != null && LOGGABLE.includes(state);
  const label = STATE_LABEL[state];
  const target = targetText(s.target);
  // Not done and skipped are grey, like everything neutral; only done and today use the accent.
  const look =
    state === "done"
      ? "bg-accent-soft text-accent"
      : state === "today"
        ? "bg-sunken text-accent"
        : "bg-sunken text-ink-muted";
  return (
    <div className="flex min-h-11 items-center gap-2.5">
      <SportBadge sport={s.sport} size="sm" />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${state === "not_done" || state === "skipped" ? "text-ink-muted" : ""}`}>
          {s.title}
        </p>
        {target && (
          <p {...SENSITIVE} className="text-xs text-ink-muted tabular-nums">
            {target}
          </p>
        )}
        {s.done && (
          <Link {...SENSITIVE} href="/sessions" className="text-xs text-accent tabular-nums underline-offset-2 hover:underline">
            Logged: {s.done.duration_min} min · effort {s.done.effort}
            {s.done.distance_km ? ` · ${s.done.distance_km} km` : ""}
          </Link>
        )}
      </div>
      {label && (
        <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ${look}`}>
          {label}
        </span>
      )}
      {loggable && (
        <button
          type="button"
          onClick={() => onLog(s)}
          aria-label={`Log this: ${s.title}`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-control px-3 text-xs font-semibold whitespace-nowrap text-accent hover:bg-sunken"
        >
          Log this
        </button>
      )}
    </div>
  );
}
