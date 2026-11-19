"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { asSession } from "@/components/draft-card";
import { RefreshIcon } from "@/components/icons";
import { takeRepeatIntent } from "@/components/log-shortcuts";
import { PlanLinkNotice } from "@/components/plan-link-notice";
import { SessionForm } from "@/components/session-form";
import { Button } from "@/components/states";
import { createSession, getSessions, type Session } from "@/lib/api";
import {
  clearDraftForForm,
  parseHandedDraft,
  peekDraftForForm,
  reportDraftSaved,
  subscribeChatDrafts,
} from "@/lib/chat-drafts";
import { sessionSummary, todayIso } from "@/lib/format";
import { clearPlannedForForm, parseHandedPlanned, peekPlannedForForm, subscribeLogPlanned } from "@/lib/log-planned";
import { plannedAsSession, plannedName } from "@/lib/plans";

/** The Log tab: the form, plus "Repeat last session" once history has loaded.
 *  Opened from a chat draft's Review button, it starts prefilled with the
 *  draft, date included, and tells the chat when it is saved (N4). Opened from
 *  "Log this" in the Plan view (#132), it starts from the planned session's
 *  target and links the two on save (#117). After any save it says whether the
 *  session counted for a planned one, with Undo, or asks which one it was. */
export function LogView() {
  const [last, setLast] = useState<Session | null>(null);
  const [template, setTemplate] = useState<Session | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [logged, setLogged] = useState<Session | null>(null);

  // Hand-offs from the chat's Review button and the Plan view's "Log this"
  // (browser storage, so read after hydration; the server render has none).
  const raw = useSyncExternalStore(subscribeChatDrafts, peekDraftForForm, () => null);
  const handed = useMemo(() => parseHandedDraft(raw), [raw]);
  const rawPlanned = useSyncExternalStore(subscribeLogPlanned, peekPlannedForForm, () => null);
  const planned = useMemo(() => (handed ? null : parseHandedPlanned(rawPlanned)), [handed, rawPlanned]);
  // Only with a hand-off, which exists only in the browser: prerendering reads no clock.
  const today = planned ? todayIso() : "";

  useEffect(() => {
    const controller = new AbortController();
    getSessions(56, controller.signal)
      .then((sessions) => {
        const latest = sessions.at(-1) ?? null; // oldest first
        setLast(latest);
        // The Coach's "Repeat" shortcut (N3) opens the form prefilled with it.
        if (takeRepeatIntent() && latest) restart(latest);
      })
      .catch(() => {}); // the button just stays hidden
    return () => controller.abort();
  }, []);

  function restart(next?: Session) {
    clearDraftForForm(); // starting over drops a reviewed draft
    clearPlannedForForm(); // and a planned session's hand-off
    setTemplate(next);
    setFormKey((k) => k + 1);
  }

  const prefill = handed ? asSession(handed.draft) : planned ? plannedAsSession(planned, today) : template;
  const key = handed ? `draft-${handed.ref.key}` : planned ? `planned-${planned.id}` : `form-${formKey}`;

  return (
    <div className="pt-4 pb-12">
      <div className="flex items-end justify-between gap-4">
        <h1 className="font-display text-xl font-semibold">Log a session</h1>
        {last && (
          <Button
            variant="ghost"
            onClick={() => {
              setLogged(null);
              restart(last);
            }}
            className="-mr-3"
          >
            <RefreshIcon size={16} />
            Repeat last session
          </Button>
        )}
      </div>

      {handed && (
        <p role="status" className="mt-4 rounded-md bg-sunken px-4 py-3 text-sm">
          Filled in from the coach. Check the details, then save.
        </p>
      )}

      {planned && (
        <div role="status" className="mt-4 flex items-center gap-3 rounded-md bg-sunken px-4 py-2 text-sm">
          <p className="min-w-0 flex-1">
            Planned: {plannedName(planned, today)}. Filled in from its target; change anything you did differently.
          </p>
          <Button variant="ghost" className="-mr-2 shrink-0" onClick={() => restart()}>
            Clear
          </Button>
        </div>
      )}

      {logged && (
        <div className="mt-4 space-y-2">
          <p role="status" className="rounded-md bg-accent-soft px-4 py-3 text-sm">
            Logged: {sessionSummary(logged)}.{" "}
            <Link href="/sessions" className="font-medium text-accent underline">
              See sessions
            </Link>
          </p>
          <PlanLinkNotice key={logged.id} sessionId={logged.id} link={logged.plan_link} />
        </div>
      )}

      <div className="mt-4 rounded-lg border border-line bg-surface p-4">
        <SessionForm
          key={key}
          session={prefill}
          keepDate={handed !== null || planned !== null}
          onSubmit={async (input) => {
            const saved = await createSession(planned?.id != null ? { ...input, planned_id: planned.id } : input);
            if (handed) reportDraftSaved(handed.ref, saved);
            setLogged(saved);
            setLast(saved);
            restart();
          }}
        />
      </div>
    </div>
  );
}
