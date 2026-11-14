"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSessions, type Session } from "@/lib/api";
import { formatKm, sportName } from "@/lib/format";
import { PlusIcon, RefreshIcon } from "./icons";

const REPEAT_KEY = "treningsagent.repeatLast";

/** The Log page repeats the last session once, if a shortcut asked for it. */
export function takeRepeatIntent(): boolean {
  try {
    const asked = sessionStorage.getItem(REPEAT_KEY) === "1";
    sessionStorage.removeItem(REPEAT_KEY);
    return asked;
  } catch {
    return false;
  }
}

function askToRepeat() {
  try {
    sessionStorage.setItem(REPEAT_KEY, "1");
  } catch {}
}

/** "Run 5 km" or "Climbing 90 min": short enough for a chip. */
export function shortLabel(s: Session): string {
  return s.sport === "running" && s.distance_km
    ? `${sportName(s)} ${formatKm(s.distance_km)}`
    : `${sportName(s)} ${s.duration_min} min`;
}

/** Two thumb-sized shortcuts just above the chat composer (N3): the most common
 *  entries, one tap from the bottom of the screen. Repeat shows only when there
 *  is a last session to repeat. */
export function LogShortcuts() {
  const [last, setLast] = useState<Session | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getSessions(56, controller.signal)
      .then((sessions) => setLast(sessions.at(-1) ?? null))
      .catch(() => {}); // no Repeat, just Log
    return () => controller.abort();
  }, []);

  const chip =
    "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold whitespace-nowrap";
  return (
    <div className="mb-2 flex gap-2" role="group" aria-label="Log shortcuts">
      {last && (
        <Link
          href="/log"
          onClick={askToRepeat}
          className={`${chip} border border-control bg-surface text-ink hover:border-accent hover:text-accent`}
        >
          <RefreshIcon size={16} />
          Repeat: {shortLabel(last)}
        </Link>
      )}
      <Link href="/log" className={`${chip} bg-accent-soft text-accent`}>
        <PlusIcon size={16} />
        Log a session
      </Link>
    </div>
  );
}
