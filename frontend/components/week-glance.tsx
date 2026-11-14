"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getTrainingLoad, type TrainingLoad } from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { recordEvent } from "@/lib/events";
import { nf } from "@/lib/format";
import { getWeekReview, lastWeekStart, saveWeekReview, weekRange } from "@/lib/week-review";
import { ChevronIcon } from "./icons";
import { Button } from "./states";

type Glance = { load: TrainingLoad; reviewed: boolean };

/** A glance at the week on Coach (design-research.md, item 5) and, until last
 *  week is reviewed or skipped, a "Your week" card (design-proposals-2.md, N1).
 *  It's extra, so on any error it simply doesn't show. */
export function WeekGlance() {
  const [glance, setGlance] = useState<Glance | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const lastWeek = lastWeekStart();

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getTrainingLoad(2, controller.signal),
      // Unreadable counts as not reviewed: the card offers the review again.
      getWeekReview(lastWeek).catch(() => null),
    ])
      .then(([load, stored]) => setGlance({ load, reviewed: stored !== null }))
      .catch(() => {});
    return () => controller.abort();
  }, [lastWeek]);

  if (!glance) return null;
  const [prev, now] = glance.load.weekly;
  if (!prev || !now || glance.load.history_days === 0) return null;

  function skip() {
    setDismissed(true); // quiet after one dismissal, even if saving fails
    recordEvent("weekly_review_skipped");
    saveWeekReview(lastWeek, { status: "skipped", note: null }).catch(() => {});
  }

  const showCard = prev.sessions > 0 && !glance.reviewed && !dismissed;
  return (
    <div className="mb-4 space-y-2">
      {showCard && (
        <section
          aria-labelledby="your-week-title"
          className="animate-rise rounded-lg border border-line bg-accent-soft p-3"
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="your-week-title" className="font-semibold">
                Your week, {weekRange(lastWeek)}
              </h2>
              <p {...SENSITIVE} className="text-sm text-ink-muted tabular-nums">
                {prev.sessions} {prev.sessions === 1 ? "session" : "sessions"} · load{" "}
                {nf.format(prev.load)}
              </p>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <Link
              href="/review"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-full bg-accent px-5 text-sm font-semibold text-on-accent"
            >
              Look back <ChevronIcon size={16} />
            </Link>
            <Button variant="ghost" onClick={skip}>
              Skip
            </Button>
          </div>
        </section>
      )}
      <p className="flex flex-wrap gap-x-3 text-sm text-ink-muted tabular-nums" aria-label="This week so far">
        <span className="font-medium text-ink">This week so far</span>
        <span {...SENSITIVE}>
          {now.sessions} {now.sessions === 1 ? "session" : "sessions"} · load {nf.format(now.load)}
        </span>
        <span {...SENSITIVE}>last week {nf.format(prev.load)}</span>
      </p>
    </div>
  );
}
