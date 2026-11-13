// The app's colour theme: System (follow the OS), Light or Dark. An explicit
// choice is stored in localStorage and set as data-theme on <html>, which
// globals.css uses to pick the light or dark tokens. System stores nothing
// and sets no attribute, so the prefers-color-scheme media query decides.

export type Theme = "system" | "light" | "dark";

export const THEMES: Theme[] = ["system", "light", "dark"];
export const THEME_KEY = "treningsagent.theme";
const CHANGE_EVENT = "treningsagent:theme";

/** The --canvas colour of each theme, used for the browser's theme-color. */
export const THEME_COLORS = { light: "#f5f4ef", dark: "#0e1214" } as const;

const isExplicit = (t: unknown): t is "light" | "dark" => t === "light" || t === "dark";

/** The saved choice, or "system" when nothing (or nothing valid) is saved or
 *  storage is unavailable (private mode, blocked site data). */
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (isExplicit(saved)) return saved;
  } catch {}
  return "system";
}

/** Sets data-theme on <html> and keeps the theme-color metas in step: an
 *  explicit theme gives every meta that theme's colour; System restores each
 *  meta to the colour for its own (prefers-color-scheme) media query. */
export function applyTheme(theme: Theme, doc: Document = document): void {
  const root = doc.documentElement;
  if (isExplicit(theme)) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");

  doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const forDark = (meta.getAttribute("media") ?? "").includes("dark");
    meta.content = isExplicit(theme) ? THEME_COLORS[theme] : THEME_COLORS[forDark ? "dark" : "light"];
  });
}

/** Saves and applies a choice, and tells the switch (and other tabs) about it. */
export function saveTheme(theme: Theme): void {
  try {
    if (isExplicit(theme)) localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {}
  applyTheme(theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore: a change here, or in another tab. */
export function subscribeTheme(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    applyTheme(readTheme());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Runs in <head> before the page paints, so a saved Light or Dark choice
 *  never flashes the other theme first. Plain ES5, no imports. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t!=="light"&&t!=="dark")return;document.documentElement.setAttribute("data-theme",t);var c=${JSON.stringify(THEME_COLORS)}[t];document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=c})}catch(e){}})()`;
