"use client";

import { PauseControl } from "@/components/pause-panel";

/** Start or end a break (N5). Lives on the You tab (phones) and on the Account
 *  page, which the top bar's key icon opens at every width, so a break can be
 *  started and ended on desktop too. */
export function BreakSection({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="break-title" className={className}>
      <h2 id="break-title" className="font-semibold">
        A break from training
      </h2>
      <p className="mt-1 mb-3 text-sm text-ink-muted">
        Injured, ill or away? Pause tracking so trends and the load ratio don&apos;t read the gap as a drop.
      </p>
      <PauseControl />
    </section>
  );
}
