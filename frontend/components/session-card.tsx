import Link from "next/link";
import type { Session } from "@/lib/api";
import {
  dayLabel,
  formatDuration,
  formatKm,
  formatPace,
  sessionSummary,
  sportName,
} from "@/lib/format";
import { ClimbChips } from "./grade";
import { CheckIcon, ChevronIcon, SportBadge } from "./icons";

/** In-chat confirmation that the agent stored a session. */
export function LoggedSessionCard({ session }: { session: Session }) {
  return (
    <div className="animate-rise rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-3">
        <SportBadge sport={session.sport} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-xs font-medium text-accent">
            <CheckIcon size={12} /> Logged · {dayLabel(session.date)}
          </p>
          <p className="truncate text-sm font-semibold tabular-nums">{sessionSummary(session)}</p>
        </div>
        <Link
          href="/sessions"
          className="grid size-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sunken"
          aria-label="Open sessions"
        >
          <ChevronIcon size={18} />
        </Link>
      </div>
      {session.climbs && session.climbs.length > 0 && (
        <div className="mt-2.5 pl-11">
          <ClimbChips climbs={session.climbs} max={6} />
        </div>
      )}
    </div>
  );
}

function stats(s: Session): string[] {
  const out: string[] = [];
  if (s.distance_km) out.push(formatKm(s.distance_km));
  out.push(formatDuration(s.duration_min));
  if (s.pace_min_per_km) out.push(`${formatPace(s.pace_min_per_km)} /km`);
  if (s.climbs?.length) out.push(`${s.climbs_sent ?? 0}/${s.climbs.length} sent`);
  out.push(`effort ${s.effort}`);
  return out;
}

/** A row in the sessions list. The whole row opens the details. */
export function SessionRow({ session, onOpen }: { session: Session; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-sunken"
      aria-label={`${sportName(session)} on ${dayLabel(session.date)}: ${stats(session).join(", ")}. Show details`}
    >
      <SportBadge sport={session.sport} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-semibold">{sportName(session)}</p>
          <p className="shrink-0 text-xs text-ink-muted">{dayLabel(session.date)}</p>
        </div>
        <p className="mt-0.5 text-sm text-ink-muted tabular-nums">{stats(session).join(" · ")}</p>
        {session.climbs && session.climbs.length > 0 && (
          <div className="mt-2">
            <ClimbChips climbs={session.climbs} max={5} />
          </div>
        )}
      </div>
    </button>
  );
}
