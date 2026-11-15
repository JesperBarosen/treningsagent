// Keeping the Coach composer above the on-screen keyboard on phones.
//
// iOS Safari (and the home-screen app) doesn't shrink the layout viewport when
// the keyboard opens, so a `position: fixed; bottom: …` composer stays where it
// was: behind the keyboard, or floating with the tab bar's height (plus the
// home-indicator inset) of empty space under it. While the composer has focus
// on a phone we therefore hide the tab bar (globals.css, via KEYBOARD_ATTR on
// <html>) and lift the composer by the keyboard's height, read from
// window.visualViewport.

import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";

/** Set on <html> while the composer has focus on a phone; globals.css hides the tab bar. */
export const KEYBOARD_ATTR = "data-composer-focus";

/** Phone widths: below md (768 px), where the tab bar shows. */
export const PHONE_QUERY = "(max-width: 47.99rem)";

/** Pixels the keyboard (or anything else) covers at the bottom of the layout
 *  viewport: its height minus the visible part and how far that part is scrolled. */
export function keyboardInset(win: Window = window): number {
  const vv = win.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop));
}

function isPhone(win: Window = window): boolean {
  return win.matchMedia?.(PHONE_QUERY).matches ?? false;
}

/** How long a blur waits before the tab bar comes back, so a tap on Send or a
 *  quick reply lands before the layout moves. */
export const BLUR_GRACE_MS = 150;

/** Focus handlers for the composer's container, and how to place it: `active`
 *  while it has focus on a phone, with `inset` the keyboard height in px. */
export function useComposerKeyboard() {
  const [active, setActive] = useState(false);
  const [inset, setInset] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onFocus = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!isPhone()) return;
    setInset(keyboardInset());
    setActive(true);
  }, []);

  const onBlur = useCallback((e: FocusEvent<HTMLElement>) => {
    const box = e.currentTarget;
    if (box.contains(e.relatedTarget as Node | null)) return; // focus moved within the composer
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!box.contains(document.activeElement)) setActive(false);
    }, BLUR_GRACE_MS);
  }, []);

  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.setAttribute(KEYBOARD_ATTR, "");
    const vv = window.visualViewport;
    const update = () => setInset(keyboardInset());
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      root.removeAttribute(KEYBOARD_ATTR);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, [active]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { active, inset: active ? inset : 0, onFocus, onBlur };
}
