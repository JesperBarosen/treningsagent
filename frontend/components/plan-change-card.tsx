"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, type PlanChangeProposal } from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { CheckIcon, PlanIcon } from "./icons";
import { Button } from "./states";

/** Changes that carry targets (minutes, km, effort) blur in discreet mode; moves,
 *  skips and shifts only name days and titles, which stay visible. */
const HAS_NUMBERS = new Set(["add", "edit", "lighter"]);

export type ChangeStatus = "open" | "accepted" | "dismissed";

/** Changes the coach proposed to the current plan (#131, mockup 4). Only what
 *  changes, each in one line, with the coach's reason and any warnings.
 *  Accept applies all of it; Review lets the user tick the ones they want;
 *  Not now leaves nothing behind. Nothing is applied before a tap (Q5). */
export function PlanChangeCard({
  proposal,
  status,
  applied,
  onAccept,
  onDismiss,
}: {
  proposal: PlanChangeProposal;
  status: ChangeStatus;
  /** After Accept: the indexes of the changes that were applied. */
  applied?: number[];
  /** Apply the changes with these indexes. Resolves when applied; throws to show an error. */
  onAccept: (indexes: number[]) => Promise<void>;
  onDismiss: () => void;
}) {
  const all = proposal.changes.map((c) => c.index);
  const [reviewing, setReviewing] = useState(false);
  const [picked, setPicked] = useState<number[]>(all);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept(indexes: number[]) {
    setBusy(true);
    setError(null);
    try {
      await onAccept(indexes);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? "Your plan has changed since this proposal. Ask the coach again."
          : e instanceof ApiError
            ? e.message
            : "Couldn't change the plan. Try again.",
      );
      setBusy(false);
    }
  }

  if (status === "dismissed") return null;
  const done = status === "accepted";
  const shown = done ? proposal.changes.filter((c) => (applied ?? all).includes(c.index)) : proposal.changes;
  const n = picked.length;

  return (
    // Opaque surface, so nothing of the conversation shows through behind it.
    <section
      aria-label={`Proposed change: ${proposal.plan.name}`}
      className={`animate-rise rounded-lg border bg-surface p-3 ${done ? "border-line" : "border-dashed border-control"}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <PlanIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-meta font-medium text-ink-muted">
            {done ? "Plan updated" : "Proposed change · not saved yet"}
          </p>
          <p className="font-semibold text-balance">{proposal.plan.name}</p>
        </div>
      </div>

      {reviewing && !done ? (
        <fieldset className="mt-2.5 min-w-0">
          <legend className="sr-only">Changes to apply</legend>
          <ul className="space-y-1">
            {proposal.changes.map((c) => (
              <li key={c.index}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-1 py-2 hover:bg-sunken">
                  <input
                    type="checkbox"
                    checked={picked.includes(c.index)}
                    disabled={busy}
                    onChange={(e) =>
                      setPicked((p) => (e.target.checked ? [...p, c.index].sort((a, b) => a - b) : p.filter((i) => i !== c.index)))
                    }
                    className="mt-0.5 size-5 shrink-0 accent-accent"
                  />
                  <ChangeLine change={c} />
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <ul className="mt-2.5 space-y-2 pl-11" aria-label="Changes">
          {shown.map((c) => (
            <li key={c.index} className="flex items-start gap-2">
              {done && <CheckIcon size={16} className="mt-0.5 shrink-0 text-accent" />}
              <ChangeLine change={c} />
            </li>
          ))}
        </ul>
      )}

      {proposal.reason && <p className="mt-3 pl-11 text-sm">{proposal.reason}</p>}
      {!done && proposal.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 pl-11 text-sm text-ink-muted" aria-label="Notes">
          {proposal.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {done ? (
        <Link
          href="/plan"
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-control px-5 text-sm font-semibold text-ink transition hover:bg-sunken"
        >
          <CheckIcon size={16} /> Open the plan
        </Link>
      ) : reviewing ? (
        <div className="mt-3 flex gap-2">
          <Button onClick={() => accept(picked)} disabled={busy || n === 0} className="flex-1 px-3">
            {busy ? "Saving…" : n === all.length ? "Accept all" : `Accept ${n} of ${all.length}`}
          </Button>
          <SecondaryButton onClick={onDismiss} disabled={busy}>
            Not now
          </SecondaryButton>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button onClick={() => accept(all)} disabled={busy} className="flex-1 px-3">
            {busy ? "Saving…" : "Accept"}
          </Button>
          {all.length > 1 && (
            <SecondaryButton onClick={() => setReviewing(true)} disabled={busy}>
              Review
            </SecondaryButton>
          )}
          <SecondaryButton onClick={onDismiss} disabled={busy}>
            Not now
          </SecondaryButton>
        </div>
      )}
    </section>
  );
}

function ChangeLine({ change }: { change: PlanChangeProposal["changes"][number] }) {
  return (
    <span className="min-w-0 flex-1 text-sm">
      <span className="mr-1.5 inline-flex h-5 items-center rounded-full bg-sunken px-2 align-[1px] text-[11px] font-semibold text-ink-muted">
        {change.label}
      </span>
      <span {...(HAS_NUMBERS.has(change.type) ? SENSITIVE : {})}>{change.description}</span>
    </span>
  );
}

function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-full border border-control px-3 text-sm font-semibold text-ink transition hover:bg-sunken disabled:opacity-40"
    />
  );
}
