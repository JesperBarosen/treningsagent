"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { PlanIcon } from "@/components/icons";
import { Button, EmptyState } from "@/components/states";
import { ApiError, createPlan, type PlannedSession } from "@/lib/api";
import { dateRange, goalLine, weekContaining } from "@/lib/plans";
import { parsePreview, peekPreview, reportProposalSettled, subscribePreview } from "@/lib/plan-preview";
import { PlanCalendar } from "../plan-view";

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local

/** The whole proposed plan, week by week with every target (#135), before
 *  anything is saved. Accept stores it (POST /plans) and Dismiss leaves nothing
 *  behind; either way the chat card is told when the chat next opens. */
export function ProposalPreview() {
  const raw = useSyncExternalStore(subscribePreview, peekPreview, () => null);
  const handed = useMemo(() => parsePreview(raw), [raw]);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!handed) {
    return (
      <div className="pt-4">
        <EmptyState
          icon={<PlanIcon size={26} />}
          title="No proposal to show"
          action={
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent"
            >
              Back to the coach
            </Link>
          }
        >
          Ask the coach for a plan, then tap View plan on its card.
        </EmptyState>
      </div>
    );
  }

  const { ref, proposal } = handed;
  const { plan } = proposal;
  const said = proposal.context?.user_said ?? [];
  const now = today();

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const stored = await createPlan(proposal.accept);
      reportProposalSettled(ref, { accepted: stored });
      router.push("/plan");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the plan. Try again.");
      setBusy(false);
    }
  }

  function dismiss() {
    reportProposalSettled(ref, { dismissed: proposal });
    router.push("/");
  }

  return (
    <div className="min-w-0 pt-4 pb-12">
      <p
        role="status"
        className="inline-flex h-7 items-center rounded-full border border-dashed border-control px-3 text-xs font-semibold text-ink-muted"
      >
        Proposal, not saved
      </p>
      <h1 className="mt-2 font-display text-xl font-semibold text-balance">{plan.name}</h1>
      <p className="text-meta text-ink-muted">
        {plan.weeks} weeks · {dateRange(plan.start_date, plan.end_date)}
        {proposal.goal ? ` · goal: ${goalLine(proposal.goal)}` : ""}
      </p>

      {(plan.rationale || said.length > 0) && (
        <div className="mt-3 space-y-1.5 rounded-lg border border-dashed border-control bg-surface px-3.5 py-2.5 text-sm">
          {plan.rationale && <p>{plan.rationale}</p>}
          {said.length > 0 && (
            <p className="text-ink-muted">
              Based on what you said: {said.map((s) => `“${s}”`).join(", ")}
            </p>
          )}
        </div>
      )}

      <PlanCalendar
        startDate={plan.start_date}
        weeks={plan.weeks}
        weekMeta={plan.week_meta}
        sessions={plan.sessions as PlannedSession[]}
        today={now}
        // The week containing today once the plan has started, otherwise week 1;
        // never the last week just because the start date has passed.
        current={weekContaining(plan.start_date, plan.weeks, now)}
        opensOn={1}
      />

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button onClick={accept} disabled={busy} className="flex-1">
          {busy ? "Saving…" : "Accept"}
        </Button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-control px-5 text-sm font-semibold text-ink transition hover:bg-sunken disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-ink-muted">Nothing is saved until you tap Accept.</p>
    </div>
  );
}
