"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, type PlanProposal } from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { dateRange, KIND_WORD, weekChip } from "@/lib/plans";
import { CheckIcon, PlanIcon } from "./icons";
import { Button } from "./states";

const SPORT_WORD = { running: "run", climbing: "climb", strength: "strength", other: "other" } as const;

/** A plan the coach proposed (#119, mockup 1): shown like a session draft (N4).
 *  Nothing is stored until Accept, whatever "Save without asking" says (Q5);
 *  Dismiss leaves nothing behind. Planned load per week is drawn as outlined
 *  bars with the lighter weeks marked; the numbers blur in discreet mode. */
export function PlanProposalCard({
  proposal,
  status,
  onAccept,
  onDismiss,
}: {
  proposal: PlanProposal;
  status: "open" | "accepted" | "dismissed";
  /** Store the plan. Resolves when saved; throws to show an error. */
  onAccept: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { plan } = proposal;
  const perWeek = Math.round((plan.sessions.length / plan.weeks) * 10) / 10;
  const bySport = Object.entries(
    plan.sessions.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.sport]: (acc[s.sport] ?? 0) + 1 }), {}),
  )
    .map(([sport, n]) => `${Math.round((n / plan.weeks) * 10) / 10} ${SPORT_WORD[sport as keyof typeof SPORT_WORD]}`)
    .join(" · ");
  const top = Math.max(1, ...plan.weekly.map((w) => w.planned_load));

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await onAccept();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the plan. Try again.");
      setBusy(false);
    }
  }

  if (status === "dismissed") return null;

  return (
    <section
      aria-label={`Proposed plan: ${plan.name}`}
      className={`animate-rise rounded-lg border bg-surface p-3 ${status === "open" ? "border-dashed border-control" : "border-line"}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <PlanIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-meta font-medium text-ink-muted">
            {status === "accepted" ? "Plan saved" : "Proposed plan · not saved yet"}
          </p>
          <p className="font-semibold text-balance">{plan.name}</p>
          <p className="text-meta text-ink-muted">
            {plan.weeks} weeks · {dateRange(plan.start_date, plan.end_date)}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 pl-11">
        <span className="inline-flex h-6 items-center rounded-full bg-sunken px-2.5 text-xs font-semibold text-ink-muted">
          {perWeek} sessions a week
        </span>
        {bySport && (
          <span className="inline-flex h-6 items-center rounded-full bg-sunken px-2.5 text-xs font-semibold text-ink-muted">
            {bySport}
          </span>
        )}
      </div>

      {/* Planned load per week: outlined bars, a lighter week dashed in accent. */}
      <div className="mt-3 pl-11">
        <div {...SENSITIVE} className="flex h-14 items-end gap-1.5" aria-hidden="true">
          {plan.weekly.map((w) => (
            <span
              key={w.index}
              className={`flex-1 rounded-t-sm border-[1.5px] border-b-0 border-dashed ${
                w.kind === "build" ? "border-control" : "border-accent"
              }`}
              style={{ height: `${Math.max(8, (w.planned_load / top) * 100)}%` }}
            />
          ))}
        </div>
        <ol className="mt-1 flex gap-1.5 text-[11px] text-ink-muted" aria-label="Weeks">
          {plan.weekly.map((w) => (
            <li
              key={w.index}
              className={`min-w-0 flex-1 truncate text-center ${KIND_WORD[w.kind] ? "text-accent" : ""}`}
              title={weekChip(w)}
            >
              <span className="sr-only">
                {weekChip(w)}, planned load {w.planned_load}, {w.sessions} sessions
              </span>
              <span aria-hidden="true">{KIND_WORD[w.kind] ? weekChip(w).replace(" · ", " ") : `W${w.index}`}</span>
            </li>
          ))}
        </ol>
      </div>

      {plan.rationale && <p className="mt-3 pl-11 text-sm">{plan.rationale}</p>}

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {status === "accepted" ? (
        <Link
          href="/plan"
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-control px-5 text-sm font-semibold text-ink transition hover:bg-sunken"
        >
          <CheckIcon size={16} /> Open the plan
        </Link>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button onClick={accept} disabled={busy} className="flex-1">
            {busy ? "Saving…" : "Accept"}
          </Button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-control px-5 text-sm font-semibold text-ink transition hover:bg-sunken disabled:opacity-40"
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}
