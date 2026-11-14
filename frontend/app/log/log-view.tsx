"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { asSession } from "@/components/draft-card";
import { RefreshIcon } from "@/components/icons";
import { takeRepeatIntent } from "@/components/log-shortcuts";
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
import { sessionSummary } from "@/lib/format";

/** The Log tab: the form, plus "Repeat last session" once history has loaded.
 *  Opened from a chat draft's Review button, it starts prefilled with the
 *  draft, date included, and tells the chat when it is saved (N4). */
export function LogView() {
  const [last, setLast] = useState<Session | null>(null);
  const [template, setTemplate] = useState<Session | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [logged, setLogged] = useState<Session | null>(null);

  // A draft handed over by the chat's Review button (browser storage, so read
  // after hydration; the server render has none).
  const raw = useSyncExternalStore(subscribeChatDrafts, peekDraftForForm, () => null);
  const handed = useMemo(() => parseHandedDraft(raw), [raw]);

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
    setTemplate(next);
    setFormKey((k) => k + 1);
  }

  return (
    <div className="pt-4 pb-24 md:pb-12">
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

      {logged && (
        <p role="status" className="mt-4 rounded-md bg-accent-soft px-4 py-3 text-sm">
          Logged: {sessionSummary(logged)}.{" "}
          <Link href="/sessions" className="font-medium text-accent underline">
            See sessions
          </Link>
        </p>
      )}

      <div className="mt-4 rounded-lg border border-line bg-surface p-4">
        <SessionForm
          key={handed ? `draft-${handed.ref.key}` : `form-${formKey}`}
          session={handed ? asSession(handed.draft) : template}
          keepDate={handed !== null}
          onSubmit={async (input) => {
            const saved = await createSession(input);
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
