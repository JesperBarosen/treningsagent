"use client";

import { useEffect, useSyncExternalStore } from "react";
import { applyTheme, currentAppearance, readTheme, subscribeTheme, toggleTheme } from "@/lib/theme";
import { MoonIcon, SunIcon } from "./icons";

/** One button in the top bar: a sun in dark mode (tap for light), a moon in
 *  light mode (tap for dark). Until it is tapped the OS setting decides.
 *
 *  Which icon shows is decided by CSS (`theme-icon-*` in globals.css) from the
 *  same data-theme attribute and media query as the colours, so it is right on
 *  the first paint. The label needs JavaScript; before hydration it names the
 *  action without a direction. */
export function ThemeToggle() {
  const appearance = useSyncExternalStore(subscribeTheme, currentAppearance, () => null);

  // Re-sync <html> and the theme-color metas once mounted, in case the head
  // script ran before Next inserted the metas.
  useEffect(() => applyTheme(readTheme()), []);

  const label =
    appearance === "dark"
      ? "Switch to light mode"
      : appearance === "light"
        ? "Switch to dark mode"
        : "Switch between light and dark mode";
  return (
    <button
      type="button"
      onClick={() => toggleTheme()}
      aria-label={label}
      title={label}
      className="grid size-11 place-items-center rounded-full text-ink-muted transition hover:bg-sunken hover:text-ink"
    >
      <span className="theme-icon-dark">
        <SunIcon size={20} />
      </span>
      <span className="theme-icon-light">
        <MoonIcon size={20} />
      </span>
    </button>
  );
}
