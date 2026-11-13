"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshIcon } from "@/components/icons";
import { SessionForm } from "@/components/session-form";
import { Button } from "@/components/states";
import { createSession, getSessions, type Session } from "@/lib/api";
import { sessionSummary } from "@/lib/format";

/** The Log tab: the form, plus "Repeat last session" once history has loaded. */
export function LogView() {
  const [last, setLast] = useState<Session | null>(null);
  const [template, setTemplate] = useState<Session | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [logged, setLogged] = useState<Session | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getSessions(56, controller.signal)
      .then((sessions) => setLast(sessions.at(-1) ?? null)) // oldest first
      .catch(() => {}); // the button just stays hidden
    return () => controller.abort();
  }, []);

  function restart(next?: Session) {
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
          key={formKey}
          session={template}
          onSubmit={async (input) => {
            const saved = await createSession(input);
            setLogged(saved);
            setLast(saved);
            restart();
          }}
        />
      </div>
    </div>
  );
}
