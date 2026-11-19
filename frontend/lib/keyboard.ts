// Coach with the on-screen keyboard on phones (#138, #144).
//
// iOS Safari (and the home-screen app) doesn't shrink the layout viewport when
// the keyboard opens; it shrinks the visual viewport and scrolls the document
// under it. #139 chased that by moving a fixed composer on every visualViewport
// event, which jittered while iOS scrolled the document (#144). Instead, Coach
// is a fixed-height column whose own messages area is the only thing that
// scrolls, and the composer is its last child (app/chat.tsx). While the
// composer has focus on a phone this hook:
// - hides the tab bar (globals.css, via KEYBOARD_ATTR on <html>);
// - reports the visible height (window.visualViewport.height) so the column
//   ends exactly at the keyboard, updated on resize only (not scroll), at most
//   once a frame;
// - puts the document back at the top (window.scrollTo(0, 0)) when iOS scrolls
//   it to show the input, so nothing slides behind the composer.

import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";

/** Set on <html> while the composer has focus on a phone; globals.css hides the tab bar. */
export const KEYBOARD_ATTR = "data-composer-focus";

/** Phone widths: below md (768 px), where the tab bar shows. */
export const PHONE_QUERY = "(max-width: 47.99rem)";

/** The height of what's visible above the keyboard, in px; the window's height
 *  without visualViewport. */
export function visibleHeight(win: Window = window): number {
  return Math.round(win.visualViewport?.height ?? win.innerHeight);
}

/** Undo iOS scrolling the document to show a focused input: on Coach the
 *  document never scrolls, only the messages area does. */
export function resetDocumentScroll(win: Window = window): void {
  if (win.scrollY !== 0 || win.scrollX !== 0) win.scrollTo(0, 0);
}

function isPhone(win: Window = window): boolean {
  return win.matchMedia?.(PHONE_QUERY).matches ?? false;
}

/** How long a blur waits before the tab bar comes back, so a tap on Send or a
 *  quick reply lands before the layout moves. */
export const BLUR_GRACE_MS = 150;

/** Less than this many px covered is not an on-screen keyboard (a toolbar, a hardware keyboard's bar). */
export const KEYBOARD_MIN_PX = 80;

/** Focus handlers for the composer's container, and the column's height:
 *  `active` while it has focus on a phone, with `height` the visible height in
 *  px (null when not active: the column uses 100dvh). */
export function useComposerKeyboard() {
  const [active, setActive] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onFocus = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!isPhone()) return;
    setHeight(visibleHeight());
    setActive(true);
    resetDocumentScroll();
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
    let frame = 0;
    // Resize only: the keyboard opening, closing or changing height. Scroll
    // events are iOS panning the document, which resetDocumentScroll undoes.
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setHeight(visibleHeight());
        resetDocumentScroll();
      });
    };
    vv?.addEventListener("resize", onResize);
    // iOS scrolls the document right after focus, once the keyboard is up.
    const settle = requestAnimationFrame(() => resetDocumentScroll());
    return () => {
      root.removeAttribute(KEYBOARD_ATTR);
      vv?.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settle);
    };
  }, [active]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // The on-screen keyboard is up when it covers a real part of the window (not
  // with a hardware keyboard, where focus leaves the full height visible).
  const keyboardUp = active && height !== null && typeof window !== "undefined" && window.innerHeight - height > KEYBOARD_MIN_PX;
  return { active, height: active ? height : null, keyboardUp, onFocus, onBlur };
}
