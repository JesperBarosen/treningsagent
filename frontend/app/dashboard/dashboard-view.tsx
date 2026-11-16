"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { GradeDot } from "@/components/grade";
import { ChartIcon, ChevronIcon } from "@/components/icons";
import { GoalsSection } from "@/components/goals-panel";
import { PauseBanner } from "@/components/pause-panel";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import {
  ApiError,
  DISTANCE_BANDS,
  type Grade,
  type Progression,
  type Sport,
  type TrainingLoad,
  type Trend,
  type TrendWord,
} from "@/lib/api";
import { fetchDashboard, fetchSportLoad, missingSports, shownFilter, type DashboardData } from "@/lib/dashboard-data";
import {
  BAND_LABELS,
  mainPaceBand,
  RATIO_MIN_HISTORY_DAYS,
  RATIO_MODERATE,
  RATIO_SPIKE,
  ratioView,
  sessionsPerWeek,
  summarySentence,
  ZONE_WORD,
} from "@/lib/dashboard";
import {
  saveSportFilter,
  SPORT_FILTER_LABELS,
  SPORT_FILTERS,
  useSportFilter,
  type SportFilter,
} from "@/lib/sport-filter";
import { readDensity, subscribeChartPrefs } from "@/lib/chart-prefs";
import { SENSITIVE } from "@/lib/discreet";
import { formatPace, formatRate, nf, shortDate } from "@/lib/format";
import { gradeSwatch } from "@/lib/grades";
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

const asApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(String(e), 0));

/** All / Running / Climbing at the top of the Dashboard (#46); remembered on this
 *  device. The tapped one shows as chosen at once, before any numbers change. */
export function SportFilterControl({ value }: { value: SportFilter }) {
  return (
    <div
      role="radiogroup"
      aria-label="Show sport"
      className="inline-flex rounded-full border border-control bg-surface p-0.5"
    >
      {SPORT_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={value === f}
          onClick={() => saveSportFilter(f)}
          className="min-h-11 rounded-full px-4 text-sm font-medium text-ink-muted aria-checked:bg-accent-soft aria-checked:text-accent"
        >
          {SPORT_FILTER_LABELS[f]}
        </button>
      ))}
    </div>
  );
}

/** Next to the filter while numbers load: a spinner, or with reduced motion a
 *  still "Loading…". Screen readers hear "Loading…" either way. */
export function LoadingIndicator() {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        data-testid="spinner"
        className="size-4 animate-spin motion-reduce:hidden"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
      <span className="sr-only motion-reduce:not-sr-only">Loading…</span>
    </span>
  );
}

export function DashboardView() {
  const sport = useSportFilter();
  // Every filter's load, from one request (lib/dashboard-data.ts): kept for the
  // visit, so switching back and forth draws at once without a request.
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // Per sport, only with a backend that can't send them all at once.
  const [sportErrors, setSportErrors] = useState<Partial<Record<Sport, ApiError>>>({});
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    fetchDashboard(WEEKS, signal)
      .then((d) => {
        setData(d);
        setError(null);
        setSportErrors({});
        setRefreshing(false);
        // An older backend sent no per-sport numbers: prefetch them now, in the
        // background, so a switch is usually instant anyway.
        for (const s of missingSports(d.loads)) {
          fetchSportLoad(WEEKS, s, signal)
            .then((l) => setData((prev) => prev && { ...prev, loads: { ...prev.loads, [s]: l } }))
            .catch((e) => {
              if (!signal.aborted) setSportErrors((prev) => ({ ...prev, [s]: asApiError(e) }));
            });
        }
      })
      .catch((e) => {
        if (signal.aborted) return;
        setError(asApiError(e));
        setRefreshing(false);
      });
    return () => controller.abort();
  }, [reload]);

  /** Fetch again (Try again, or after a break ends), keeping what is shown meanwhile. */
  function refetch() {
    setRefreshing(true);
    setError(null);
    setReload((n) => n + 1);
  }

  const shown = data ? shownFilter(data.loads, sport) : null;
  const sportError = sport === "all" ? undefined : sportErrors[sport];
  // The chosen filter's numbers aren't here yet: keep the last ones, dimmed.
  const pending = refreshing || (data !== null && shown !== sport && !sportError);
  const firstLoad = data === null && error === null;
  const failed = error ?? sportError;

  return (
    <div className="mx-auto max-w-5xl pt-4 pb-12">
      <h1 className="font-display text-xl font-semibold">Dashboard</h1>
      <p className="text-sm text-ink-muted">The last {WEEKS} weeks · the current week is partial</p>
      <div className="mt-3 flex min-h-11 items-center gap-3">
        <SportFilterControl value={sport} />
        {(pending || firstLoad) && <LoadingIndicator />}
      </div>

      <div className="mt-4">
        {failed ? (
          <ErrorState offline={failed.status === null} message={failed.message} onRetry={refetch} />
        ) : data === null || shown === null ? (
          <LoadingDashboard />
        ) : (
          <>
            {/* N2: what the user is aiming for comes first. Goals follow the
                filter at once; they are already loaded. */}
            <GoalsSection sport={sport} />
            <div
              data-testid="dashboard-content"
              aria-busy={pending}
              className={`transition-opacity motion-reduce:transition-none ${pending ? "opacity-60" : ""}`}
            >
              <Dashboard
                load={data.loads[shown]!}
                progression={data.progression}
                sport={shown}
                onPauseEnded={refetch}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Dashboard({
  load,
  progression,
  sport = "all",
  onPauseEnded,
}: {
  /** For `sport` only when one is chosen (the backend filters it). */
  load: TrainingLoad;
  progression: Progression;
  /** The Dashboard filter (#46): All shows the combined picture, a sport only its own. */
  sport?: SportFilter;
  /** After End break: reload, since trends change. */
  onPauseEnded?: () => void;
}) {
  const { running, climbing } = progression;
  const noLoad = load.weekly.every((w) => w.sessions === 0);
  const nothing = running.sessions === 0 && climbing.sessions === 0 && noLoad;
  const noneOfSport = sport !== "all" && noLoad && progression[sport].sessions === 0;
  if (noneOfSport) {
    return (
      <EmptyState
        icon={<ChartIcon size={26} />}
        title={sport === "running" ? "No runs yet" : "No climbing yet"}
        action={
          <Link
            href="/log"
            className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent"
          >
            Log a session
          </Link>
        }
      >
        {`Nothing logged for ${sport} in the last ${WEEKS} weeks. Choose All to see everything.`}
      </EmptyState>
    );
  }
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

  const pausedDays = progression.paused_days ?? 0;
  return (
    <>
      {load.pause ? (
        // An edit reloads too: the planned end and reason feed the load numbers' context.
        <PauseBanner pause={load.pause} onEnded={() => onPauseEnded?.()} onEdited={() => onPauseEnded?.()} />
      ) : (
        pausedDays > 0 && (
          <p className="mb-4 rounded-md bg-sunken px-4 py-3 text-sm text-ink-muted">
            Trends leave out {pausedDays} {pausedDays === 1 ? "day" : "days"} from a break.
          </p>
        )
      )}
      <Summary load={load} progression={progression} sport={sport} />
      <DashboardGrid load={load} progression={progression} sport={sport} />
    </>
  );
}

type SummaryProps = { load: TrainingLoad; progression: Progression; sport: SportFilter };

/** Phones only (#59, design-visual V-M3): three headline numbers and one
 *  sentence first; the charts below start as rows. From `md` the grid shows all. */
function Summary(props: SummaryProps) {
  const density = useDensity();
  if (density === "full") return null; // "Everything open" (#61): the charts say it all
  return <SummaryTiles {...props} />;
}

/** The Dashboard density from the Account page (#61); "summary" on the server. */
function useDensity() {
  return useSyncExternalStore(subscribeChartPrefs, readDensity, () => "summary" as const);
}

const oneDecimal = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/** "3.1/wk avg" or "4/wk avg", or null without a complete week. */
function perWeek(load: TrainingLoad): string | null {
  const avg = sessionsPerWeek(load);
  return avg === null ? null : `${oneDecimal.format(avg)}/wk avg`;
}

function SummaryTiles({ load, progression, sport }: SummaryProps) {
  const thisWeek = load.weekly[load.weekly.length - 1];
  const lastWeek = load.weekly[load.weekly.length - 2];
  const view = ratioView(load);
  const tiles = [
    { label: "Sessions", value: String(thisWeek?.sessions ?? 0), sub: perWeek(load) ?? "this week" },
    {
      label: "Load",
      value: nf.format(thisWeek?.load ?? 0),
      sub: lastWeek ? `${nf.format(lastWeek.load)} last wk` : "this week",
    },
    {
      label: "Ratio",
      value: view.kind === "ok" ? view.ratio.toFixed(2) : "–",
      sub: view.kind === "ok" ? ZONE_WORD[view.zone] : view.kind === "paused" ? "paused" : "not enough data",
    },
  ];
  return (
    <section aria-labelledby="summary-title" className="mb-4 md:hidden">
      <h2 id="summary-title" className="sr-only">
        Summary
      </h2>
      <dl {...SENSITIVE} className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0 rounded-md border border-line bg-surface p-2.5">
            <dt className="text-meta text-ink-muted">{t.label}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{t.value}</dd>
            <dd className="truncate text-meta text-ink-muted">{t.sub}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm">{summarySentence(load, progression, sport)}</p>
    </section>
  );
}

/** From `md`, where the summary tiles are hidden: the same assessment as one
 *  line above the cards, with sessions per week (#46). */
function Assessment({ load, progression, sport }: SummaryProps) {
  const avg = perWeek(load);
  return (
    <p className="mb-4 hidden text-sm md:block" aria-label="Assessment">
      {summarySentence(load, progression, sport)}
      {avg && (
        <span {...SENSITIVE} className="ml-1 text-ink-muted tabular-nums">
          {`Sessions: ${avg.replace("/wk avg", " a week on average")}.`}
        </span>
      )}
    </p>
  );
}

/** The cards for the chosen sport (#46): All shows the combined load and ratio
 *  and both sports' cards; a single sport shows its own load, ratio and charts. */
function DashboardGrid({ load, progression, sport }: SummaryProps) {
  const { running, climbing } = progression;
  return (
    <>
      <Assessment load={load} progression={progression} sport={sport} />
      <div className="grid gap-4 md:grid-cols-3">
        <LoadCard load={load} sport={sport} className="md:col-span-2" />
        <RatioCard load={load} sport={sport} />
        {sport !== "climbing" && <PaceCard running={running} className="md:col-span-3" />}
        {sport !== "running" && (
          <>
            <GradeCard climbing={climbing} className="md:col-span-2" />
            <SendRateCard climbing={climbing} />
          </>
        )}
      </div>
    </>
  );
}

// --- Building blocks -----------------------------------------------------------

/** A chart card. Below 768 px it starts as a row (title, trend chip, chevron)
 *  that expands in place (#59, design-visual V-M3); from `md` it is always open. */
function Card({
  title,
  subtitle,
  aside,
  rowAside,
  className = "",
  children,
  labelledBy,
}: {
  title: string;
  subtitle?: ReactNode;
  aside?: ReactNode;
  /** Shown only on the collapsible phone row, e.g. the trend chip. */
  rowAside?: ReactNode;
  className?: string;
  children: ReactNode;
  labelledBy: string;
}) {
  // "Everything open" on the Account page (#61) starts each card open; a tap
  // still folds it. null = not tapped yet, so the setting decides.
  const density = useDensity();
  const [tapped, setOpen] = useState<boolean | null>(null);
  const open = tapped ?? density === "full";
  const bodyId = `${labelledBy}-body`;
  const shut = open ? "" : "max-md:hidden";
  return (
    <section
      aria-labelledby={labelledBy}
      className={`relative min-w-0 animate-rise rounded-lg border border-line bg-surface p-4 ${className}`}
    >
      <div className={`flex items-start justify-between gap-3 md:mb-3 ${open ? "mb-3" : ""}`}>
        <div className="min-w-0">
          <h2 id={labelledBy} className="font-display text-lg font-semibold">
            {title}
          </h2>
          {subtitle && <p className={`text-sm text-ink-muted ${shut}`}>{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rowAside && <span className="flex items-center gap-2 md:hidden">{rowAside}</span>}
          {aside}
          <ChevronIcon
            size={18}
            className={`text-ink-muted transition-transform md:hidden ${open ? "rotate-90" : ""}`}
          />
        </div>
      </div>
      {/* The whole row is the tap target on phones; the heading names the button. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-labelledby={labelledBy}
        onClick={() => setOpen(!open)}
        className="absolute inset-x-0 top-0 h-15 rounded-lg md:hidden"
      />
      <div id={bodyId} className={shut}>
        {children}
      </div>
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
      <div {...SENSITIVE} className="overflow-x-auto">
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

const SPORT_SERIES = {
  running: { label: "Running", colour: SERIES.RUN },
  climbing: { label: "Climbing", colour: SERIES.CLIMB },
} as const;

function LoadCard({ load, sport, className }: { load: TrainingLoad; sport: SportFilter; className?: string }) {
  const rows = loadRows(load);
  const thisWeek = load.weekly[load.weekly.length - 1];
  const lastWeek = load.weekly[load.weekly.length - 2];
  const sports = sport === "all" ? (["running", "climbing"] as const) : ([sport] as const);
  return (
    <Card
      labelledBy="load-title"
      title={sport === "all" ? "Weekly load" : `Weekly ${sport} load`}
      subtitle={`Minutes × effort (session RPE), ${sport === "all" ? "by sport" : `${sport} only`}`}
      className={className}
    >
      <dl {...SENSITIVE} className="mb-3 flex gap-6">
        <div>
          <dt className="text-meta text-ink-muted">This week so far</dt>
          <dd className="font-display text-2xl font-semibold">{nf.format(thisWeek?.load ?? 0)}</dd>
        </div>
        {lastWeek && (
          <div>
            <dt className="text-meta text-ink-muted">Last week</dt>
            <dd className="font-display text-2xl font-semibold text-ink-muted">{nf.format(lastWeek.load)}</dd>
          </div>
        )}
      </dl>
      <Legend
        items={sports.map((s) => ({
          swatch: <LegendSwatch kind="bar" colour={SPORT_SERIES[s].colour} />,
          label: SPORT_SERIES[s].label,
        }))}
      />
      <WeeklyLoadChart load={load} sports={sports} />
      <NumbersTable
        caption={sport === "all" ? "Weekly load by sport" : `Weekly ${sport} load`}
        head={["Week of", ...sports.map((s) => SPORT_SERIES[s].label), ...(sport === "all" ? ["Total"] : []), "Sessions"]}
        rows={rows.map((r, i) => [
          r.label,
          ...sports.map((s) => nf.format(r[s])),
          ...(sport === "all" ? [nf.format(r.total)] : []),
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

function RatioCard({ load, sport = "all" }: { load: TrainingLoad; sport?: SportFilter }) {
  const view = ratioView(load);
  const pct = (v: number) => `${(Math.min(v, SCALE_MAX) / SCALE_MAX) * 100}%`;
  return (
    <Card
      labelledBy="ratio-title"
      title="Acute:chronic ratio"
      subtitle={sport === "all" ? "Last 7 days vs last 28 days, all sports" : `Last 7 days vs last 28 days, ${sport} only`}
      aside={
        <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-line px-2.5 text-xs font-medium whitespace-nowrap text-ink-muted">
          Rough guide
        </span>
      }
    >
      {view.kind === "paused" ? (
        <div>
          <p className="font-display text-2xl font-semibold text-ink-muted">Paused</p>
          <p className="mt-1 text-sm text-ink-muted">Not counted while you&apos;re on a break.</p>
        </div>
      ) : view.kind === "not enough data" ? (
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
          <p {...SENSITIVE} className="font-display text-[3rem] leading-none font-semibold">
            {view.ratio.toFixed(2)}
          </p>
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
      <dl {...SENSITIVE} className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
        <div>
          <dt className="text-meta text-ink-muted">7-day daily average</dt>
          <dd className="font-medium tabular-nums">{nf.format(load.acute_7d_avg)}</dd>
        </div>
        <div>
          <dt className="text-meta text-ink-muted">28-day daily average</dt>
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
  const band = mainPaceBand(running);
  return (
    <Card
      labelledBy="pace-title"
      title="Running pace"
      subtitle="Per distance band, so long runs are compared with long runs. Higher is faster."
      rowAside={
        band && (
          <>
            <span className="text-meta text-ink-muted">{BAND_LABELS[band]}</span>
            <TrendChip trend={running.trends.pace_by_distance[band].trend} />
          </>
        )
      }
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
    return <p className="mb-1 text-meta text-ink-muted">No runs in the last 6 weeks</p>;
  }
  const part = (v: number | null, n: number, when: string) =>
    v === null ? `– ${when}` : `${formatPace(v)} ${when} (${n} ${n === 1 ? "run" : "runs"})`;
  return (
    <p {...SENSITIVE} className="mb-1 text-meta text-ink-muted tabular-nums">
      {part(trend.recent, trend.recent_sessions, "last 2 wks")} · {part(trend.baseline, trend.baseline_sessions, "4 wks before")}
    </p>
  );
}

// --- Climbing ------------------------------------------------------------------

/** The swatch of a grade on the main gym's scale (#98); null for V/Font. */
function scaleColour(climbing: Progression["climbing"], grade: Grade | null): string | null {
  return climbing.grade_scale_detail?.find((d) => d.name === grade)?.colour ?? null;
}

function GradeName({ grade, colour }: { grade: Grade | null; colour?: string | null }) {
  if (!grade) return <span className="text-ink-muted">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5 capitalize">
      <GradeDot grade={grade} colour={colour} />
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
      rowAside={anySend && <TrendChip trend={send.trend} />}
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
                <dt className="text-meta text-ink-muted">{label}</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <GradeName grade={t.recent_grade} colour={scaleColour(climbing, t.recent_grade)} />
                  <span className="text-meta text-ink-muted">last 2 wks, was</span>
                  <GradeName grade={t.baseline_grade} colour={scaleColour(climbing, t.baseline_grade)} />
                  <TrendChip trend={t.trend} />
                </dd>
              </div>
            ))}
          </dl>
          <NumbersTable
            caption="Hardest send and flash per week"
            head={["Week of", "Hardest send", "Hardest flash"]}
            rows={rows.map((r, i) => [
              r.label,
              <GradeName key="s" grade={r.sendGrade} colour={climbing.weekly[i].hardest_sent_colour ?? scaleColour(climbing, r.sendGrade)} />,
              <GradeName key="f" grade={r.flashGrade} colour={climbing.weekly[i].flash_colour ?? scaleColour(climbing, r.flashGrade)} />,
            ])}
          />
        </>
      )}
    </Card>
  );
}

function RateBar({
  grade,
  colour,
  rate,
  label,
}: {
  grade: Grade;
  colour: string | null;
  rate: number | null;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-ink-muted">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-sunken">
        {rate !== null && rate > 0 && (
          <div
            className="h-2 rounded-full ring-1 ring-grade-ring"
            style={{ width: `${rate * 100}%`, background: gradeSwatch(grade, colour) ?? "var(--chart-climb)" }}
          />
        )}
      </div>
      <span {...SENSITIVE} className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">
        {rate === null ? "–" : formatRate(rate)}
      </span>
    </div>
  );
}

function SendRateCard({ climbing }: { climbing: Progression["climbing"] }) {
  // The main gym's grades in order, then grades from elsewhere ("V4", "blue (Klatreverket)")
  // in the backend's order, easiest first.
  const rates = climbing.trends.send_rate_by_grade;
  const grades = [
    ...climbing.grade_scale.filter((g) => rates[g]),
    ...Object.keys(rates).filter((g) => !climbing.grade_scale.includes(g)),
  ];
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
                    <GradeName grade={g} colour={scaleColour(climbing, g)} />
                  </span>
                  <TrendChip trend={t.trend} />
                </div>
                <RateBar grade={g} colour={scaleColour(climbing, g)} rate={t.recent} label="Last 2 wks" />
                <RateBar grade={g} colour={scaleColour(climbing, g)} rate={t.baseline} label="4 wks before" />
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
