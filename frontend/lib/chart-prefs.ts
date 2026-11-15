// Chart and Dashboard preferences (#61, design-visual V-L1): an alternative,
// colour-blind friendly chart palette and how much the Dashboard shows at once
// on a phone. Taste varies with age and education (Reinecke 2013), so the calm
// defaults can be changed. Like the theme and discreet mode, both are saved
// per device in localStorage. The palette is set as data-chart-palette on
// <html> before the first paint (globals.css swaps the chart tokens).

export type ChartPalette = "standard" | "cvd";
export type DashboardDensity = "summary" | "full";

export const PALETTE_KEY = "treningsagent.chartPalette";
export const DENSITY_KEY = "treningsagent.dashboardDensity";
const CHANGE_EVENT = "treningsagent:chart-prefs";
const ATTR = "data-chart-palette";

export const PALETTE_LABELS: Record<ChartPalette, { title: string; hint: string }> = {
  standard: { title: "Standard", hint: "Spruce for running, ochre for climbing." },
  cvd: {
    title: "Colour-blind friendly",
    hint: "Blue for running, orange for climbing. Easier to tell apart with any type of colour blindness.",
  },
};

/** Running and climbing colours of each palette, for the preview swatches on the
 *  Account page (the live tokens follow the active palette, so they can't show
 *  the other one). tests/chart-prefs.test.ts keeps these equal to globals.css. */
export const PALETTE_PREVIEW: Record<ChartPalette, { light: [string, string]; dark: [string, string] }> = {
  standard: { light: ["#008571", "#a85f12"], dark: ["#21a589", "#c98030"] },
  cvd: { light: ["#0046ee", "#e5753c"], dark: ["#6446ff", "#f25a00"] },
};

export const DENSITY_LABELS: Record<DashboardDensity, { title: string; hint: string }> = {
  summary: { title: "Summary first", hint: "Three numbers and a sentence, with each chart one tap away." },
  full: { title: "Everything open", hint: "Every chart open, as on a larger screen." },
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

/** The saved palette, or "standard" when nothing valid is saved. */
export function readPalette(): ChartPalette {
  return read(PALETTE_KEY) === "cvd" ? "cvd" : "standard";
}

/** The saved density, or "summary" (the calm default) when nothing valid is saved. */
export function readDensity(): DashboardDensity {
  return read(DENSITY_KEY) === "full" ? "full" : "summary";
}

export function applyPalette(palette: ChartPalette, doc: Document = document): void {
  if (palette === "cvd") doc.documentElement.setAttribute(ATTR, "cvd");
  else doc.documentElement.removeAttribute(ATTR);
}

/** Defaults store nothing, so a later change of default reaches everyone who never chose. */
export function savePalette(palette: ChartPalette): void {
  write(PALETTE_KEY, palette === "standard" ? null : palette);
  applyPalette(palette);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function saveDensity(density: DashboardDensity): void {
  write(DENSITY_KEY, density === "summary" ? null : density);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore: a change here, or in another tab. */
export function subscribeChartPrefs(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PALETTE_KEY && e.key !== DENSITY_KEY && e.key !== null) return;
    applyPalette(readPalette());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Runs in <head> before the page paints, so charts never flash in the other palette. Plain ES5. */
export const CHART_PREFS_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(PALETTE_KEY)})==="cvd")document.documentElement.setAttribute("${ATTR}","cvd")}catch(e){}})()`;
