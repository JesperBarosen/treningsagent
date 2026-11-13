"use client";

import { useEffect, useSyncExternalStore } from "react";
import { applyTheme, readTheme, saveTheme, subscribeTheme, THEMES, type Theme } from "@/lib/theme";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };
const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

/** One button in the top bar that cycles System -> Light -> Dark. The server
 *  render shows System; the saved choice appears right after hydration (the
 *  colours themselves are already right, set by THEME_SCRIPT in <head>). */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as const);
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const Icon = ICONS[theme];

  // Re-sync <html> and the theme-color metas once mounted, in case the head
  // script ran before Next inserted the metas.
  useEffect(() => applyTheme(readTheme()), []);

  const label = `Theme: ${LABELS[theme]}. Switch to ${LABELS[next]}`;
  return (
    <button
      type="button"
      onClick={() => saveTheme(next)}
      aria-label={label}
      title={label}
      className="grid size-11 place-items-center rounded-full text-ink-muted transition hover:bg-sunken hover:text-ink"
    >
      <Icon size={20} />
    </button>
  );
}
