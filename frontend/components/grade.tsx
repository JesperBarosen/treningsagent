import type { Climb, Grade } from "@/lib/api";
import { climbOutcome } from "@/lib/format";
import { BoltIcon, CheckIcon } from "./icons";

// Full class names so Tailwind finds them. Every dot has a ring so white and
// black holds stay visible in both themes.
const DOT: Record<Grade, string> = {
  yellow: "bg-grade-yellow",
  green: "bg-grade-green",
  blue: "bg-grade-blue",
  purple: "bg-grade-purple",
  red: "bg-grade-red",
  black: "bg-grade-black",
  white: "bg-grade-white",
};

export function GradeDot({ grade, size = 10 }: { grade: Grade; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`${DOT[grade]} inline-block shrink-0 rounded-full ring-1 ring-grade-ring`}
      style={{ width: size, height: size }}
    />
  );
}

const OUTCOME_LABEL = { flash: "flashed", sent: "sent", tried: "not sent" } as const;

export function climbLabel(c: Pick<Climb, "grade" | "style" | "sent" | "attempts">): string {
  const attempts = c.attempts && c.attempts > 1 ? `, ${c.attempts} attempts` : "";
  return `${c.grade} ${c.style}, ${OUTCOME_LABEL[climbOutcome(c)]}${attempts}`;
}

/** Grade dot + name + outcome: bolt for a flash, check for a send, dashed when not sent. */
export function ClimbChip({ climb }: { climb: Climb }) {
  const outcome = climbOutcome(climb);
  const tried = outcome === "tried";
  return (
    <span
      role="img"
      aria-label={climbLabel(climb)}
      title={climbLabel(climb)}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border pr-2 pl-2 text-xs font-medium capitalize ${
        tried
          ? "border-dashed border-grade-ring text-ink-muted"
          : "border-line bg-sunken text-ink"
      }`}
    >
      <GradeDot grade={climb.grade} />
      {climb.grade}
      {outcome === "flash" && <BoltIcon size={12} className="text-accent" />}
      {outcome === "sent" && <CheckIcon size={12} className="text-accent" />}
    </span>
  );
}

/** Climbs as a wrapping row of chips, hardest first, with a "+n" overflow chip. */
export function ClimbChips({ climbs, max }: { climbs: Climb[]; max?: number }) {
  const sorted = [...climbs].sort(
    (a, b) => b.grade_ordinal - a.grade_ordinal || Number(b.sent) - Number(a.sent),
  );
  const shown = max ? sorted.slice(0, max) : sorted;
  const hidden = sorted.length - shown.length;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Climbs">
      {shown.map((c, i) => (
        <li key={i}>
          <ClimbChip climb={c} />
        </li>
      ))}
      {hidden > 0 && (
        <li className="inline-flex h-7 items-center rounded-full px-2 text-xs font-medium text-ink-muted">
          +{hidden} more
        </li>
      )}
    </ul>
  );
}

/** A small key explaining the chip markers. */
export function ClimbLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      <span className="inline-flex items-center gap-1">
        <BoltIcon size={12} className="text-accent" /> flash
      </span>
      <span className="inline-flex items-center gap-1">
        <CheckIcon size={12} className="text-accent" /> sent
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-5 rounded-full border border-dashed border-grade-ring" />
        not sent
      </span>
    </p>
  );
}
