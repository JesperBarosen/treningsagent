import type { Climb, Session } from "./api";

const SPORT_NAMES = { running: "Run", climbing: "Climbing" } as const;

export function sportName(session: Pick<Session, "sport">): string {
  return SPORT_NAMES[session.sport];
}

/** 5.25 min/km -> "5:15". */
export function formatPace(minPerKm: number): string {
  let minutes = Math.floor(minPerKm);
  let seconds = Math.round((minPerKm - minutes) * 60);
  if (seconds === 60) {
    minutes += 1;
    seconds = 0;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** 95 -> "1 h 35 min", 50 -> "50 min". */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatKm(km: number): string {
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/** The one-line summary used on logged-session cards: "Run · 10 km · 50 min · effort 6". */
export function sessionSummary(s: Session): string {
  const parts = [sportName(s)];
  if (s.distance_km) parts.push(formatKm(s.distance_km));
  parts.push(formatDuration(s.duration_min), `effort ${s.effort}`);
  return parts.join(" · ");
}

export type ClimbOutcome = "flash" | "sent" | "tried";

export function climbOutcome(c: Pick<Climb, "sent" | "attempts">): ClimbOutcome {
  if (!c.sent) return "tried";
  return c.attempts === 1 ? "flash" : "sent";
}

/** Parse a YYYY-MM-DD date as a local calendar day (not UTC midnight). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday of the calendar week containing `iso`, as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toIso(d);
}

export type WeekGroup = { weekStart: string; sessions: Session[] };

/** Sessions grouped by calendar week (Monday start), newest week and session first. */
export function groupByWeek(sessions: Session[]): WeekGroup[] {
  const groups = new Map<string, Session[]>();
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  for (const s of sorted) {
    const key = weekStart(s.date);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups].map(([weekStart, sessions]) => ({ weekStart, sessions }));
}

/** "This week", "Last week" or "Week of 12 Oct", relative to `today`. */
export function weekLabel(start: string, today: Date = new Date()): string {
  const thisWeek = weekStart(toIso(today));
  if (start === thisWeek) return "This week";
  const last = parseDay(thisWeek);
  last.setDate(last.getDate() - 7);
  if (start === toIso(last)) return "Last week";
  return `Week of ${parseDay(start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/** "Mon 9 Nov", or "Today" / "Yesterday". */
export function dayLabel(iso: string, today: Date = new Date()): string {
  const t = toIso(today);
  if (iso === t) return "Today";
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (iso === toIso(y)) return "Yesterday";
  return parseDay(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function fullDate(iso: string): string {
  return parseDay(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export const nf = new Intl.NumberFormat("en-GB");
