"use client";

import { useEffect, useSyncExternalStore } from "react";
import { applyDiscreet, readDiscreet, revealOnTap, saveDiscreet, subscribeDiscreet } from "@/lib/discreet";
import { recordEvent } from "@/lib/events";
import { EyeIcon, EyeOffIcon } from "./icons";

/** Top-bar switch for discreet mode. While on it becomes a "Discreet" pill
 *  (the word shows from `sm`; at 375 px the bar has room for the icon only,
 *  shown on the accent tint). It also installs tap-to-reveal. */
export function DiscreetToggle() {
  const on = useSyncExternalStore(subscribeDiscreet, readDiscreet, () => false);

  useEffect(() => {
    applyDiscreet(readDiscreet());
    const onClick = (e: MouseEvent) => revealOnTap(e);
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  function toggle() {
    saveDiscreet(!on);
    // The success signal for N7: who turns it on, and whether they keep it on.
    recordEvent(on ? "discreet_mode_off" : "discreet_mode_on");
  }

  const label = on
    ? "Discreet mode is on: numbers and notes are blurred until tapped. Turn off"
    : "Turn on discreet mode: blurs numbers and notes on screen (screen readers still read them)";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full text-ink-muted transition hover:bg-sunken hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-accent ${
        on ? "sm:px-3" : ""
      }`}
    >
      {on ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
      {on && <span className="hidden text-xs font-semibold sm:inline">Discreet</span>}
    </button>
  );
}
