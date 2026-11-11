"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { GradeDot } from "@/components/grade";
import { ChartIcon } from "@/components/icons";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import {
  ApiError,
  DISTANCE_BANDS,
  getProgression,
  getTrainingLoad,
  type Grade,
  type Progression,
  type TrainingLoad,
  type Trend,
  type TrendWord,
} from "@/lib/api";
import {
  BAND_LABELS,
  RATIO_MIN_HISTORY_DAYS,
  RATIO_MODERATE,
  RATIO_SPIKE,
  ratioView,
} from "@/lib/dashboard";
import { formatPace, formatRate, nf, shortDate } from "@/lib/format";
import {
  GradeChart,
  LegendSwatch,
  loadRows,
  PaceChart,
  SERIES,
  WeeklyLoadChart,
  gradeRows,
} from "./charts";

const WEEKS = 8;

type State =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; load: TrainingLoad; progression: Progression };

export function DashboardView() {
  const [state, setState] = useState<State>({ status: "loading" });

  const fetchAll = useCallback((signal?: AbortSignal) => {
    Promise.all([getTrainingLoad(WEEKS, signal), getProgression(WEEKS, signal)])
      .then(([load, progression]) => setState({ status: "ready", load, progression }))
      .catch((e) => {
        if (signal?.aborted) return;
        setState({ status: "error", error: e instanceof ApiError ? e : new ApiError(String(e), 0) });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchAll(controller.signal);
    return () => controller.abort();
  }, [fetchAll]);

  function retry() {
    setState({ status: "loading" });
    fetchAll();
  }

  return (
    <div className="mx-auto max-w-5xl pt-4 pb-24 md:pb-12">
      <h1 className="font-display text-xl font-semibold">Dashboard</h1>
      <p className="text-sm text-ink-muted">The last {WEEKS} weeks · the current week is partial</p>

      <div className="mt-4">
        {state.status === "loading" && <LoadingDashboard />}
        {state.status === "error" && (
          <ErrorState offline={state.error.status === null} message={state.error.message} onRetry={retry} />
        )}
        {state.status === "ready" && <Dashboard load={state.load} progression={state.progression} />}
      </div>
    </div>
  );
}

export function Dashboard({ load, progression }: { load: TrainingLoad; progression: Progression }) {
  const { running, climbing } = progression;
  const nothing =
    running.sessions === 0 && climbing.sessions === 0 && load.weekly.every((w) => w.sessions === 0);
  if (nothing) {
    return (
      <EmptyState
        icon={<ChartIcon size={26} />}
        title="Nothing to chart yet"
        action={
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent"
          >
            Log your first session
          </Link>
        }
      >
        Log runs and climbing sessions with the coach, and your load and progress show up here.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <LoadCard load={load} className="md:col-span-2" />
      <RatioCard load={load} />
      <PaceCard running={running} className="md:col-span-3" />
      <GradeCard climbing={climbing} className="md:col-span-2" />
      <SendRateCard climbing={climbing} />
    </div>
  );
}

// --- Building blocks -----------------------------------------------------------

function Card({
  title,
  subtitle,
  aside,
  className = "",
  children,
  labelledBy,
}: {
  title: string;
  subtitle?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
  labelledBy: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`min-w-0 animate-rise rounded-lg border border-line bg-surface p-4 ${className}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={labelledBy} className="font-display text-lg font-semibold">
            {title}
          </h2>
          {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

const TREND_TEXT: Record<TrendWord, string> = {
  improving: "Improving",
  flat: "Flat",
  declining: "Declining",
  "not enough data": "Not enough data",
};

/** The backend's trend word, as a chip. Colour only adds to the word. */
export function TrendChip({ trend }: { trend: TrendWord }) {
  const look = trend === "improving" ? "bg-accent-soft text-accent" : "bg-sunken text-ink-muted";
  return (
    <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap ${look}`}>
      {TREND_TEXT[trend]}
    </span>
  );
}

/** A collapsed table with the chart's numbers: the chart's accessible twin. */
function NumbersTable({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="group mt-3 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm text-ink-muted hover:text-ink">
        Show the numbers
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-xs text-ink-muted">
              {head.map((h, i) => (
                <th key={h} scope="col" className={`py-1.5 font-medium ${i > 0 ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {r.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="py-1.5 font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={j} className="py-1.5 text-right">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Legend({ items }: { items: { swatch: ReactNode; label: string }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

// --- Training load -------------------------------------------------------------

function LoadCard({ load, className }: { load: TrainingLoad; className?: string }) {
  const rows = loadRows(load);
  const thisWeek = load.weekly[load.weekly.length - 1];
  const lastWeek = load.weekly[load.weekly.length - 2];
  return (
    <Card
      labelledBy="load-title"
      title="Weekly load"
      subtitle="Minutes × effort (session RPE), by sport"
      className={className}
    >
      <dl className="mb-3 flex gap-6">
        <div>
          <dt className="text-xs text-ink-muted">This week so far</dt>
          <dd className="font-display text-2xl font-semibold">{nf.format(thisWeek?.load ?? 0)}</dd>
        </div>
        {lastWeek && (
          <div>
            <dt className="text-xs text-ink-muted">Last week</dt>
            <dd className="font-display text-2xl font-semibold text-ink-muted">{nf.format(lastWeek.load)}</dd>
          </div>
        )}
      </dl>
      <Legend
        items={[
          { swatch: <LegendSwatch kind="bar" colour={SERIES.RUN} />, label: "Running" },
          { swatch: <LegendSwatch kind="bar" colour={SERIES.CLIMB} />, label: "Climbing" },
        ]}
      />
      <WeeklyLoadChart load={load} />
      <NumbersTable
        caption="Weekly load by sport"
        head={["Week of", "Running", "Climbing", "Total", "Sessions"]}
        rows={rows.map((r, i) => [
          r.label,
          nf.format(r.running),
          nf.format(r.climbing),
          nf.format(r.total),
          load.weekly[i].sessions,
        ])}
      />
    </Card>
  );
}

const ZONE_TEXT = {
  below: `Below the ${RATIO_MODERATE[0]}–${RATIO_MODERATE[1]} range: lighter than your recent usual.`,
  moderate: `Inside the ${RATIO_MODERATE[0]}–${RATIO_MODERATE[1]} range often called moderate.`,
  above: `Above ${RATIO_MODERATE[1]}: more than your recent usual.`,
  spike: `At or above ${RATIO_SPIKE}: a sharp spike compared with your recent usual.`,
} as const;

const SCALE_MAX = 2;

function RatioCard({ load }: { load: TrainingLoad }) {
  const view = ratioView(load);
  const pct = (v: number) => `${(Math.min(v, SCALE_MAX) / SCALE_MAX) * 100}%`;
  return (
    <Card
      labelledBy="ratio-title"
      title="Acute:chronic ratio"
      subtitle="Last 7 days vs last 28 days"
      aside={
        <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-line px-2.5 text-xs font-medium whitespace-nowrap text-ink-muted">
          Rough guide
        </span>
      }
    >
      {view.kind === "not enough data" ? (
        <div>
          <p className="font-display text-2xl font-semibold text-ink-muted">Not enough data</p>
          <p className="mt-1 text-sm text-ink-muted">
            The ratio needs about {RATIO_MIN_HISTORY_DAYS / 7} weeks of logged training to mean anything.
            {view.historyDays > 0 &&
              ` You have ${view.historyDays} ${view.historyDays === 1 ? "day" : "days"} so far.`}
          </p>
        </div>
      ) : (
        <div>
          <p className="font-display text-[3rem] leading-none font-semibold">{view.ratio.toFixed(2)}</p>
          <div
            role="img"
            aria-label={`Ratio ${view.ratio.toFixed(2)} on a scale from 0 to ${SCALE_MAX}, with ${RATIO_MODERATE[0]} to ${RATIO_MODERATE[1]} marked as the moderate range`}
            className="relative mt-5 mb-6 h-2 rounded-full bg-sunken"
          >
            <div
              className="absolute inset-y-0 rounded-full bg-accent-soft ring-1 ring-accent/40"
              style={{ left: pct(RATIO_MODERATE[0]), right: `calc(100% - ${pct(RATIO_MODERATE[1])})` }}
            />
            <div
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink"
              style={{ left: pct(view.ratio) }}
            />
            {[0, RATIO_MODERATE[0], RATIO_MODERATE[1], SCALE_MAX].map((t) => (
              <span
                key={t}
                aria-hidden="true"
                className="absolute top-3 -translate-x-1/2 text-xs text-ink-muted tabular-nums"
                style={{ left: pct(t) }}
              >
                {t}
              </span>
            ))}
          </div>
          <p className="text-sm">{ZONE_TEXT[view.zone]}</p>
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">7-day daily average</dt>
          <dd className="font-medium tabular-nums">{nf.format(load.acute_7d_avg)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">28-day daily average</dt>
          <dd className="font-medium tabular-nums">{nf.format(load.chronic_28d_avg)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-muted">
        Ranges from sports science (Gabbett 2016). A rough guide to how this week compares with your
        usual, not a prediction of injury.
      </p>
    </Card>
  );
}

// --- Running -------------------------------------------------------------------

function PaceCard({ running, className }: { running: Progression["running"]; className?: string }) {
  return (
    <Card
      labelledBy="pace-title"
      title="Running pace"
      subtitle="Per distance band, so long runs are compared with long runs. Higher is faster."
      className={className}
    >
      {running.sessions === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">No runs in the last {WEEKS} weeks.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {DISTANCE_BANDS.map((band) => {
            const rows = running.weekly.map((w) => ({
              label: shortDate(w.week_start),
              pace: w.pace_by_distance[band]?.pace_min_per_km ?? null,
              runs: w.pace_by_distance[band]?.runs ?? 0,
            }));
            const trend = running.trends.pace_by_distance[band];
            const any = rows.some((r) => r.pace !== null);
            return (
              <section key={band} aria-labelledby={`band-${band}`} className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 id={`band-${band}`} className="text-sm font-semibold">
                    {BAND_LABELS[band]}
                  </h3>
                  <TrendChip trend={trend.trend} />
                </div>
                <PaceTrendLine trend={trend} />
                {any ? (
                  <>
                    <PaceChart rows={rows} />
                    <NumbersTable
                      caption={`Pace per week, ${BAND_LABELS[band]}`}
                      head={["Week of", "Pace /km", "Runs"]}
                      rows={rows.map((r) => [r.label, r.pace === null ? "–" : formatPace(r.pace), r.runs])}
                    />
                  </>
                ) : (
                  <p className="py-6 text-center text-sm text-ink-muted">No runs in this band.</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function PaceTrendLine({ trend }: { trend: Trend }) {
  if (trend.recent === null && trend.baseline === null) {
    return <p className="mb-1 text-xs text-ink-muted">No runs in the last 6 weeks</p>;
  }
  const part = (v: number | null, n: number, when: string) =>
    v === null ? `– ${when}` : `${formatPace(v)} ${when} (${n} ${n === 1 ? "run" : "runs"})`;
  return (
    <p className="mb-1 text-xs text-ink-muted tabular-nums">
      {part(trend.recent, trend.recent_sessions, "last 2 wks")} · {part(trend.baseline, trend.baseline_sessions, "4 wks before")}
    </p>
  );
}

// --- Climbing ------------------------------------------------------------------

function GradeName({ grade }: { grade: Grade | null }) {
  if (!grade) return <span className="text-ink-muted">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5 capitalize">
      <GradeDot grade={grade} />
      {grade}
    </span>
  );
}

function GradeCard({ climbing, className }: { climbing: Progression["climbing"]; className?: string }) {
  const rows = gradeRows(climbing);
  const anySend = rows.some((r) => r.send !== null);
  const { avg_session_hardest_sent: send, avg_session_flash_grade: flash } = climbing.trends;
  return (
    <Card
      labelledBy="grade-title"
      title="Hardest grades"
      subtitle="Hardest send and hardest flash each week"
      className={className}
    >
      {!anySend ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          {climbing.sessions === 0 ? `No climbing in the last ${WEEKS} weeks.` : "No sends logged yet."}
        </p>
      ) : (
        <>
          <Legend
            items={[
              { swatch: <LegendSwatch kind="dot" colour={SERIES.CLIMB} />, label: "Hardest send" },
              { swatch: <LegendSwatch kind="diamond" colour={SERIES.MUTED} />, label: "Hardest flash (first try)" },
            ]}
          />
          <GradeChart climbing={climbing} />
          <dl className="mt-3 grid gap-2 border-t border-line pt-3 text-sm sm:grid-cols-2">
            {[
              { label: "Average hardest send per session", t: send },
              { label: "Average hardest flash per session", t: flash },
            ].map(({ label, t }) => (
              <div key={label}>
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <GradeName grade={t.recent_grade} />
                  <span className="text-xs text-ink-muted">last 2 wks, was</span>
                  <GradeName grade={t.baseline_grade} />
                  <TrendChip trend={t.trend} />
                </dd>
              </div>
            ))}
          </dl>
          <NumbersTable
            caption="Hardest send and flash per week"
            head={["Week of", "Hardest send", "Hardest flash"]}
            rows={rows.map((r) => [r.label, <GradeName key="s" grade={r.sendGrade} />, <GradeName key="f" grade={r.flashGrade} />])}
          />
        </>
      )}
    </Card>
  );
}

function RateBar({ grade, rate, label }: { grade: Grade; rate: number | null; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-ink-muted">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-sunken">
        {rate !== null && rate > 0 && (
          <div
            className="h-2 rounded-full ring-1 ring-grade-ring"
            style={{ width: `${rate * 100}%`, background: `var(--color-grade-${grade})` }}
          />
        )}
      </div>
      <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">
        {rate === null ? "–" : formatRate(rate)}
      </span>
    </div>
  );
}

function SendRateCard({ climbing }: { climbing: Progression["climbing"] }) {
  const grades = climbing.grade_scale.filter((g) => climbing.trends.send_rate_by_grade[g]);
  return (
    <Card labelledBy="send-title" title="Send rate per grade" subtitle="Last 2 weeks vs the 4 weeks before">
      {grades.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">No climbs in the last 6 weeks.</p>
      ) : (
        <ul className="space-y-4">
          {grades.map((g) => {
            const t = climbing.trends.send_rate_by_grade[g]!;
            return (
              <li key={g}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    <GradeName grade={g} />
                  </span>
                  <TrendChip trend={t.trend} />
                </div>
                <RateBar grade={g} rate={t.recent} label="Last 2 wks" />
                <RateBar grade={g} rate={t.baseline} label="4 wks before" />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// --- Loading -------------------------------------------------------------------

function LoadingDashboard() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="grid gap-4 md:grid-cols-3">
      {["md:col-span-2 h-80", "h-80", "md:col-span-3 h-56", "md:col-span-2 h-72", "h-72"].map((c, i) => (
        <div key={i} className={`rounded-lg border border-line bg-surface p-4 ${c}`}>
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
          <Skeleton className="mt-6 h-[calc(100%-4rem)] w-full" />
        </div>
      ))}
    </div>
  );
}
