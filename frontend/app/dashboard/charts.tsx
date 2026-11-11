"use client";

// Recharts charts for the dashboard. Every value plotted comes straight from
// the backend; the charts only position it. Colours are CSS variables from
// globals.css, so they follow light and dark mode.

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Grade, Progression, TrainingLoad } from "@/lib/api";
import { formatPace, nf, shortDate } from "@/lib/format";

const RUN = "var(--chart-run)";
const CLIMB = "var(--chart-climb)";
const MUTED = "var(--ink-muted)";
const LINE = "var(--line)";
const SURFACE = "var(--surface)";
const gradeFill = (g: Grade) => `var(--color-grade-${g})`;

const AXIS_TICK = { fill: MUTED, fontSize: 12 };
const BAR_SIZE = 20; // under the 24px cap; the rest of the slot is air
const GAP = 2; // surface gap between stacked segments

// --- Shared pieces -------------------------------------------------------------

/** The tooltip card: values lead, series names follow, keyed by a short line. */
function TooltipCard({ title, rows }: { title: string; rows: { key: ReactNode; name: string; value: string }[] }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sheet">
      <p className="mb-1 font-medium text-ink-muted">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            {r.key}
            <span className="font-semibold text-ink tabular-nums">{r.value}</span>
            <span className="text-ink-muted">{r.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineKey({ colour }: { colour: string }) {
  return (
    <svg width="14" height="4" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="2" x2="13" y2="2" stroke={colour} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Path for a column with a rounded top (data end) and a square bottom (baseline). */
function columnPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

type BarShapeProps = { x?: number; y?: number; width?: number; height?: number; payload?: LoadRow };

// --- Weekly load, stacked by sport ---------------------------------------------

type LoadRow = { week: string; label: string; running: number; climbing: number; total: number };

export function loadRows(load: TrainingLoad): LoadRow[] {
  return load.weekly.map((w) => ({
    week: w.week_start,
    label: shortDate(w.week_start),
    running: w.load_by_sport.running ?? 0,
    climbing: w.load_by_sport.climbing ?? 0,
    total: w.load,
  }));
}

export function WeeklyLoadChart({ load }: { load: TrainingLoad }) {
  const rows = loadRows(load);
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={4}>
          <CartesianGrid vertical={false} stroke={LINE} strokeWidth={1} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: LINE }}
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => nf.format(v)}
          />
          <Tooltip
            cursor={{ fill: "var(--sunken)", opacity: 0.6 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as LoadRow | undefined;
              if (!active || !row) return null;
              return (
                <TooltipCard
                  title={`Week of ${row.label}`}
                  rows={[
                    { key: <LineKey colour={CLIMB} />, name: "climbing", value: nf.format(row.climbing) },
                    { key: <LineKey colour={RUN} />, name: "running", value: nf.format(row.running) },
                    { key: <span className="w-3.5" />, name: "total", value: nf.format(row.total) },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="running"
            stackId="load"
            name="Running"
            fill={RUN}
            barSize={BAR_SIZE}
            isAnimationActive={false}
            shape={(p: BarShapeProps) => {
              const { x = 0, y = 0, width = 0, height = 0, payload } = p;
              if (height <= 0) return <g />;
              // Round the top only when nothing is stacked on it.
              const r = payload && payload.climbing > 0 ? 0 : 4;
              return <path d={columnPath(x, y, width, height, r)} fill={RUN} />;
            }}
          />
          <Bar
            dataKey="climbing"
            stackId="load"
            name="Climbing"
            fill={CLIMB}
            barSize={BAR_SIZE}
            isAnimationActive={false}
            shape={(p: BarShapeProps) => {
              const { x = 0, y = 0, width = 0, height = 0, payload } = p;
              const gap = payload && payload.running > 0 ? GAP : 0;
              if (height - gap <= 0) return <g />;
              return <path d={columnPath(x, y, width, height - gap, 4)} fill={CLIMB} />;
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Running pace per distance band --------------------------------------------

type PaceRow = { label: string; pace: number | null; runs: number };

export function PaceChart({ rows }: { rows: PaceRow[] }) {
  return (
    <div className="h-32">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={LINE} strokeWidth={1} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: LINE }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          {/* Reversed: faster (lower min/km) is higher up. */}
          <YAxis
            reversed
            domain={["dataMin - 0.15", "dataMax + 0.15"]}
            tickCount={3}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => formatPace(v)}
          />
          <Tooltip
            cursor={{ stroke: LINE, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as PaceRow | undefined;
              if (!active || !row) return null;
              return (
                <TooltipCard
                  title={`Week of ${row.label}`}
                  rows={[
                    row.pace === null
                      ? { key: <LineKey colour={RUN} />, name: "no runs", value: "–" }
                      : {
                          key: <LineKey colour={RUN} />,
                          name: `/km · ${row.runs} ${row.runs === 1 ? "run" : "runs"}`,
                          value: formatPace(row.pace),
                        },
                  ]}
                />
              );
            }}
          />
          <Line
            dataKey="pace"
            stroke={RUN}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls
            isAnimationActive={false}
            dot={{ r: 4, fill: RUN, stroke: SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: RUN, stroke: SURFACE, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Climbing: hardest send and flash grade per week ---------------------------

type GradeRow = {
  label: string;
  send: number | null;
  flash: number | null;
  sendGrade: Grade | null;
  flashGrade: Grade | null;
};

export function gradeRows(climbing: Progression["climbing"]): GradeRow[] {
  // Grades sit on the y axis by their place on the gym's scale.
  const place = (g: Grade | null) => (g ? climbing.grade_scale.indexOf(g) + 1 : null);
  return climbing.weekly.map((w) => ({
    label: shortDate(w.week_start),
    send: place(w.hardest_sent),
    flash: place(w.flash_grade),
    sendGrade: w.hardest_sent,
    flashGrade: w.flash_grade,
  }));
}

type DotProps = { cx?: number; cy?: number; payload?: GradeRow };

/** A grade-coloured dot with the grade ring and a surface ring. */
function SendDot({ cx, cy, payload }: DotProps) {
  if (cx == null || cy == null || !payload?.sendGrade) return <g />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={7.5} fill={SURFACE} />
      <circle cx={cx} cy={cy} r={5.5} fill={gradeFill(payload.sendGrade)} stroke="var(--grade-ring)" strokeWidth={1} />
    </g>
  );
}

/** A grade-coloured diamond: the flash marker. */
function FlashDot({ cx, cy, payload }: DotProps) {
  if (cx == null || cy == null || !payload?.flashGrade) return <g />;
  const d = (s: number) => `M${cx},${cy - s}L${cx + s},${cy}L${cx},${cy + s}L${cx - s},${cy}Z`;
  return (
    <g>
      <path d={d(7.5)} fill={SURFACE} />
      <path d={d(5)} fill={gradeFill(payload.flashGrade)} stroke="var(--grade-ring)" strokeWidth={1} />
    </g>
  );
}

function GradeTick({ x, y, value, scale }: { x: number; y: number; value: number; scale: Grade[] }) {
  const grade = scale[value - 1];
  if (!grade) return <g />;
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx={-54} cy={0} r={4} fill={gradeFill(grade)} stroke="var(--grade-ring)" strokeWidth={1} />
      <text x={-46} y={0} dy="0.35em" fill={MUTED} fontSize={12}>
        {grade[0].toUpperCase() + grade.slice(1)}
      </text>
    </g>
  );
}

export function GradeChart({ climbing }: { climbing: Progression["climbing"] }) {
  const rows = gradeRows(climbing);
  const scale = climbing.grade_scale;
  const placed = rows.flatMap((r) => [r.send, r.flash]).filter((v): v is number => v !== null);
  const lo = Math.max(1, Math.min(...placed) - 1);
  const hi = Math.min(scale.length, Math.max(...placed) + 1);
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={LINE} strokeWidth={1} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: LINE }}
            interval="preserveStartEnd"
            minTickGap={16}
            padding={{ left: 10, right: 10 }}
          />
          <YAxis
            type="number"
            domain={[lo - 0.4, hi + 0.4]}
            ticks={ticks}
            interval={0}
            tick={(p) => <GradeTick x={Number(p.x)} y={Number(p.y)} value={Number(p.payload.value)} scale={scale} />}
            tickLine={false}
            axisLine={false}
            width={76}
          />
          <Tooltip
            cursor={{ stroke: LINE, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as GradeRow | undefined;
              if (!active || !row) return null;
              return (
                <TooltipCard
                  title={`Week of ${row.label}`}
                  rows={[
                    { key: <LineKey colour={CLIMB} />, name: "hardest send", value: row.sendGrade ?? "–" },
                    { key: <LineKey colour={MUTED} />, name: "hardest flash", value: row.flashGrade ?? "–" },
                  ]}
                />
              );
            }}
          />
          <Line
            dataKey="flash"
            name="Hardest flash"
            stroke={MUTED}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls
            isAnimationActive={false}
            dot={(p) => <FlashDot key={`f-${p.index}`} cx={p.cx} cy={p.cy} payload={p.payload as GradeRow} />}
            activeDot={false}
          />
          <Line
            dataKey="send"
            name="Hardest send"
            stroke={CLIMB}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls
            isAnimationActive={false}
            dot={(p) => <SendDot key={`s-${p.index}`} cx={p.cx} cy={p.cy} payload={p.payload as GradeRow} />}
            activeDot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Legend keys that mirror the marks. */
export function LegendSwatch({ kind, colour }: { kind: "bar" | "line" | "dot" | "diamond"; colour: string }) {
  if (kind === "bar") return <span aria-hidden="true" className="inline-block size-3 rounded-[3px]" style={{ background: colour }} />;
  return (
    <svg width="22" height="12" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="6" x2="21" y2="6" stroke={colour} strokeWidth="2" strokeLinecap="round" />
      {kind === "dot" && <circle cx="11" cy="6" r="4" fill={colour} stroke={SURFACE} strokeWidth="2" />}
      {kind === "diamond" && <path d="M11,1.5L15.5,6L11,10.5L6.5,6Z" fill={colour} stroke={SURFACE} strokeWidth="1.5" />}
    </svg>
  );
}

export const SERIES = { RUN, CLIMB, MUTED };
