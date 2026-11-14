"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TrendChip } from "@/app/dashboard/dashboard-view";
import { GradeDot } from "@/components/grade";
import { Button, ErrorState, Skeleton } from "@/components/states";
import { ApiError, getProgression, getTrainingLoad } from "@/lib/api";
import { BAND_LABELS } from "@/lib/dashboard";
import { recordEvent } from "@/lib/events";
import { formatPace, nf, weekStart } from "@/lib/format";
import {
  buildWeekReview,
  getWeekReview,
  lastWeekStart,
  NOTE_MAX,
  saveWeekReview,
  weekRange,
  weeksAgo,
  type StoredWeekReview,
  type WeekReviewData,
  type WeekReviewStatus,
} from "@/lib/week-review";

/** The backend serves at most 12 weeks, and the review needs the week before too. */
const MAX_WEEKS_AGO = 10;

/** `?week=` if it is a Monday of a finished week we can show, else last week. */
export function reviewedWeek(param: string | undefined, today: Date = new Date()): string {
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param) && weekStart(param) === param) {
    const ago = weeksAgo(param, today);
    if (ago >= 1 && ago <= MAX_WEEKS_AGO) return param;
  }
  return lastWeekStart(today);
}

type State =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; review: WeekReviewData | null; stored: StoredWeekReview | null };

export function ReviewView({ week: weekParam }: { week?: string }) {
  const week = reviewedWeek(weekParam);
  const [state, setState] = useState<State>({ status: "loading" });
  const recorded = useRef(false);

  const fetchAll = useCallback(
    (signal?: AbortSignal) => {
      const weeks = Math.min(weeksAgo(week) + 2, 12);
      Promise.all([
        getTrainingLoad(weeks, signal),
        getProgression(Math.max(weeks, 8), signal),
        // A missing or unreadable review only means "not reviewed yet".
        getWeekReview(week).catch(() => null),
      ])
        .then(([load, progression, stored]) =>
          setState({ status: "ready", review: buildWeekReview(load, progression, week), stored }),
        )
        .catch((e) => {
          if (signal?.aborted) return;
          setState({ status: "error", error: e instanceof ApiError ? e : new ApiError(String(e), 0) });
        });
    },
    [week],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchAll(controller.signal);
    return () => controller.abort();
  }, [fetchAll]);

  // The success signal for N1: share of active weeks where the review is opened.
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    recordEvent("weekly_review_opened");
  }, []);

  const fresh = weeksAgo(week) === 1;

  return (
    <div className="pt-4 pb-24 md:pb-12">
      <h1 className="font-display text-xl font-semibold">Your week</h1>
      <p className="text-sm text-ink-muted">
        {weekRange(week)}
        {fresh && " · a fresh week has started"}
      </p>
      <div className="mt-4">
        {state.status === "loading" && <LoadingReview />}
        {state.status === "error" && (
          <ErrorState
            offline={state.error.status === null}
            message={state.error.message}
            onRetry={() => {
              setState({ status: "loading" });
              fetchAll();
            }}
          />
        )}
        {state.status === "ready" && (
          <Review week={week} review={state.review} stored={state.stored} />
        )}
      </div>
    </div>
  );
}

function Review({
  week,
  review,
  stored,
}: {
  week: string;
  review: WeekReviewData | null;
  stored: StoredWeekReview | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState(stored?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(status: WeekReviewStatus) {
    setBusy(true);
    setError(null);
    try {
      await saveWeekReview(week, { status, note: status === "done" ? note : stored?.note ?? null });
      recordEvent(status === "done" ? "weekly_review_done" : "weekly_review_skipped");
      router.push("/");
    } catch {
      setError("Couldn't save your review. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {review ? <WeekNumbers review={review} /> : <p className="text-ink-muted">No numbers for this week.</p>}

      <div>
        <label htmlFor="week-note" className="mb-1.5 block text-sm font-medium">
          Note for next week
        </label>
        <textarea
          id="week-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_MAX}
          rows={2}
          placeholder="e.g. one easy run, rest fingers Wednesday"
          className="w-full resize-none rounded-lg border border-line bg-surface px-4 py-3 text-base placeholder:text-ink-muted focus:border-accent focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={() => finish("done")} disabled={busy} className="flex-1">
          {stored?.status === "done" ? "Save" : "Done"}
        </Button>
        {stored?.status !== "done" && (
          <Button variant="ghost" onClick={() => finish("skipped")} disabled={busy} className="border border-line">
            Skip
          </Button>
        )}
      </div>
    </div>
  );
}

function WeekNumbers({ review: r }: { review: WeekReviewData }) {
  const before = (n: number | null, fmt: (n: number) => string) =>
    n === null ? null : `${fmt(n)} the week before`;
  return (
    <>
      <dl className="grid grid-cols-2 gap-2">
        <Tile label="Sessions" value={String(r.sessions)} sub={before(r.prevSessions, String)} />
        <Tile label="Load" value={nf.format(r.load)} sub={before(r.prevLoad, (n) => nf.format(n))} />
      </dl>

      {(r.runs > 0 || r.climbingSessions > 0) && (
        <section aria-label="Highlights" className="rounded-lg border border-line bg-surface p-4 text-sm">
          <p className="text-ink-muted">
            {[
              r.runs > 0 && `${r.runs} ${r.runs === 1 ? "run" : "runs"}`,
              r.climbingSessions > 0 &&
                `${r.climbingSessions} climbing ${r.climbingSessions === 1 ? "session" : "sessions"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {r.hardestSent && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span>Hardest send</span>
              <span className="flex items-center gap-2 capitalize">
                <GradeDot grade={r.hardestSent} />
                {r.hardestSent}
                <TrendChip trend={r.hardestSentTrend} />
              </span>
            </div>
          )}
          {r.pace && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span>Pace, {BAND_LABELS[r.pace.band].toLowerCase()}</span>
              <span className="flex items-center gap-2 tabular-nums">
                {formatPace(r.pace.minPerKm)} /km
                <TrendChip trend={r.pace.trend} />
              </span>
            </div>
          )}
        </section>
      )}

      <p className="leading-relaxed">
        <span className="sr-only">Coach: </span>
        {r.sentence}
      </p>
      <p className="text-xs text-ink-muted">Trends compare the last 2 weeks with the 4 before, like the Dashboard.</p>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd>
        <span className="block font-display text-2xl font-semibold tabular-nums">{value}</span>
        {sub && <span className="block text-xs text-ink-muted tabular-nums">{sub}</span>}
      </dd>
    </div>
  );
}

function LoadingReview() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading your week">
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-24" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
