"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClimbLegend } from "@/components/grade";
import { ListIcon } from "@/components/icons";
import { SessionRow } from "@/components/session-card";
import { ErrorState, EmptyState, Skeleton } from "@/components/states";
import { ApiError, getSessions, type Session, type Sport } from "@/lib/api";
import { groupByWeek, nf, weekLabel } from "@/lib/format";
import { SessionSheet } from "./session-sheet";

const DAYS = 56; // 8 weeks

type State =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; sessions: Session[] };

const FILTERS: { value: Sport | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "climbing", label: "Climbing" },
];

export function SessionsView() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [filter, setFilter] = useState<Sport | "all">("all");
  const [open, setOpen] = useState<Session | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    getSessions(DAYS, signal)
      .then((sessions) => setState({ status: "ready", sessions }))
      .catch((e) => {
        if (signal?.aborted) return;
        setState({ status: "error", error: e instanceof ApiError ? e : new ApiError(String(e), 0) });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function retry() {
    setState({ status: "loading" });
    load();
  }

  return (
    <div className="pt-4 pb-24 md:pb-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold">Sessions</h1>
          <p className="text-sm text-ink-muted">The last 8 weeks</p>
        </div>
      </div>

      {state.status === "ready" && state.sessions.length > 0 && (
        <div
          role="radiogroup"
          aria-label="Show"
          className="mt-4 inline-flex rounded-full border border-line bg-surface p-1"
        >
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              onClick={() => setFilter(f.value)}
              className="min-h-9 rounded-full px-4 text-sm font-medium text-ink-muted transition aria-checked:bg-accent-soft aria-checked:text-accent"
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        {state.status === "loading" && <LoadingList />}
        {state.status === "error" && (
          <ErrorState
            offline={state.error.status === null}
            message={state.error.message}
            onRetry={retry}
          />
        )}
        {state.status === "ready" && (
          <WeekList
            sessions={state.sessions.filter((s) => filter === "all" || s.sport === filter)}
            anyAtAll={state.sessions.length > 0}
            onOpen={setOpen}
          />
        )}
      </div>

      <SessionSheet session={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function WeekList({
  sessions,
  anyAtAll,
  onOpen,
}: {
  sessions: Session[];
  anyAtAll: boolean;
  onOpen: (s: Session) => void;
}) {
  if (!anyAtAll) {
    return (
      <EmptyState
        icon={<ListIcon size={26} />}
        title="No sessions yet"
        action={
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent"
          >
            Log your first session
          </Link>
        }
      >
        Tell the coach about a run or a climbing session and it shows up here.
      </EmptyState>
    );
  }
  if (sessions.length === 0) {
    return (
      <EmptyState icon={<ListIcon size={26} />} title="Nothing of this sport">
        No sessions of this kind in the last 8 weeks.
      </EmptyState>
    );
  }
  const hasClimbs = sessions.some((s) => s.climbs?.length);
  return (
    <div className="space-y-6">
      {hasClimbs && <ClimbLegend />}
      {groupByWeek(sessions).map((week) => {
        const load = week.sessions.reduce((sum, s) => sum + (s.load ?? 0), 0);
        const n = week.sessions.length;
        return (
          <section key={week.weekStart} aria-labelledby={`week-${week.weekStart}`}>
            <div className="mb-1 flex items-baseline justify-between px-3">
              <h2
                id={`week-${week.weekStart}`}
                className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase"
              >
                {weekLabel(week.weekStart)}
              </h2>
              <p className="text-xs text-ink-muted tabular-nums">
                {n} {n === 1 ? "session" : "sessions"} · load {nf.format(load)}
              </p>
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {week.sessions.map((s) => (
                <li key={s.id}>
                  <SessionRow session={s} onOpen={() => onOpen(s)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LoadingList() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading sessions">
      {[3, 2].map((rows, w) => (
        <div key={w}>
          <Skeleton className="mb-2 ml-3 h-3 w-24" />
          <div className="divide-y divide-line rounded-lg border border-line bg-surface">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex gap-3 p-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
