// Discreet mode (docs/design-proposals-2.md, N7): blurs numbers and notes so
// the app can be opened in front of others. Like the theme, the choice is
// remembered per device in localStorage and set as data-discreet on <html>
// before the first paint. It is visual only: screen readers still read
// everything, and the toggle says so.
//
// Mark an element with {...SENSITIVE} to blur it. The first tap on a blurred
// element (or on the nearest [data-reveal-unit] around it, such as a whole
// session row) reveals it instead of acting; the next tap acts as usual.

export const DISCREET_KEY = "treningsagent.discreet";
const CHANGE_EVENT = "treningsagent:discreet";
const ATTR = "data-discreet";

/** Spread on an element whose content should blur in discreet mode. */
export const SENSITIVE = { "data-sensitive": "" } as const;
/** Spread on a container (a row, a card) that a tap reveals as a whole. */
export const REVEAL_UNIT = { "data-reveal-unit": "" } as const;

export function readDiscreet(): boolean {
  try {
    return localStorage.getItem(DISCREET_KEY) === "on";
  } catch {
    return false;
  }
}

export function applyDiscreet(on: boolean, doc: Document = document): void {
  const root = doc.documentElement;
  if (on) root.setAttribute(ATTR, "");
  else root.removeAttribute(ATTR);
  // Turning it on again blurs everything again.
  doc.querySelectorAll("[data-revealed]").forEach((el) => el.removeAttribute("data-revealed"));
}

export function saveDiscreet(on: boolean): void {
  try {
    if (on) localStorage.setItem(DISCREET_KEY, "on");
    else localStorage.removeItem(DISCREET_KEY);
  } catch {}
  applyDiscreet(on);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For useSyncExternalStore: a change here, or in another tab. */
export function subscribeDiscreet(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== DISCREET_KEY && e.key !== null) return;
    applyDiscreet(readDiscreet());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Click handler (capture phase) for tap-to-reveal. Returns true if the click
 *  revealed something and was stopped. */
export function revealOnTap(e: Pick<MouseEvent, "target" | "preventDefault" | "stopPropagation">): boolean {
  if (!document.documentElement.hasAttribute(ATTR)) return false;
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return false;
  const unit = target.closest("[data-reveal-unit]") ?? target.closest("[data-sensitive]");
  if (!unit || unit.closest("[data-revealed]")) return false;
  const hidesSomething = unit.hasAttribute("data-sensitive") || unit.querySelector("[data-sensitive]");
  if (!hidesSomething) return false;
  unit.setAttribute("data-revealed", "");
  e.preventDefault();
  e.stopPropagation();
  return true;
}

/** Runs in <head> before the page paints, so numbers never flash unblurred. Plain ES5. */
export const DISCREET_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(DISCREET_KEY)})==="on")document.documentElement.setAttribute("${ATTR}","")}catch(e){}})()`;
