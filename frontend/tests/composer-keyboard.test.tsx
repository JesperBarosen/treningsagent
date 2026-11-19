// Coach on a phone with the on-screen keyboard (#138, #144): a fixed-height
// column whose messages area is the only scroll container and whose last child
// is the composer. While typing, the tab bar steps aside and the column ends at
// the keyboard (lib/keyboard.ts). jsdom has no keyboard, so
// window.visualViewport, matchMedia and requestAnimationFrame are stubbed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: {} }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  sendChat: vi.fn(),
  getTrainingLoad: () => Promise.reject(new Error("not under test")),
  getGoals: () => Promise.reject(new Error("not under test")),
  getProfile: () => Promise.reject(new Error("not under test")),
}));

const { Chat } = await import("@/app/chat");
const { BLUR_GRACE_MS, KEYBOARD_ATTR, resetDocumentScroll, visibleHeight } = await import("@/lib/keyboard");

/** A visualViewport stand-in: a layout viewport of 800 px with `height` visible. */
class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  /** The keyboard opens (or closes, with 0) and iOS fires resize. */
  keyboard(px: number) {
    this.height = 800 - px;
    this.dispatchEvent(new Event("resize"));
  }
}

let viewport: FakeViewport;
let frames: number;
function phone(isPhone: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: isPhone }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  viewport = new FakeViewport();
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  frames = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames += 1;
    return setTimeout(() => cb(0), 0) as unknown as number;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  phone(true);
});

afterEach(() => {
  document.documentElement.removeAttribute(KEYBOARD_ATTR);
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const nextFrame = () => wait(5);

describe("the helpers", () => {
  it("visibleHeight is the visual viewport's height, or the window's without one", () => {
    expect(visibleHeight()).toBe(800);
    viewport.height = 480.4;
    expect(visibleHeight()).toBe(480);
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
    expect(visibleHeight()).toBe(800);
  });

  it("resetDocumentScroll puts the document back at the top only when iOS moved it", () => {
    resetDocumentScroll();
    expect(window.scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, "scrollY", { value: 140, configurable: true });
    resetDocumentScroll();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

describe("Coach as a fixed-height column", () => {
  async function coach() {
    render(<Chat />);
    const input = await screen.findByLabelText("Message");
    return { input, column: screen.getByTestId("coach"), messages: screen.getByTestId("messages"), composer: screen.getByTestId("composer") };
  }

  it("is 100dvh below the top bar, with the messages area as the only scroller and the composer last", async () => {
    const { column, messages, composer } = await coach();
    expect(column).toHaveClass("fixed", "top-(--top-bar-h)", "h-[calc(100dvh-var(--top-bar-h))]", "flex", "flex-col", "pb-tab-bar", "md:pb-0");
    expect(column.style.height).toBe("");
    expect(messages).toHaveClass("min-h-0", "flex-1", "overflow-y-auto", "overscroll-contain");
    // The composer is in the column's flow, its last child, not fixed on its own.
    expect(composer).not.toHaveClass("fixed");
    expect(composer.parentElement!.lastElementChild).toBe(composer);
    expect(composer).toHaveClass("flex-none", "bg-elevated"); // opaque (#138)
    expect(composer.className).not.toMatch(/bg-elevated\/|backdrop-blur|opacity-/);
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(false);
  });

  it("ends at the keyboard while typing, hides the tab bar and resets the document's scroll", async () => {
    const { input, column, composer } = await coach();
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true }); // iOS scrolled on focus
    act(() => input.focus());
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(true);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(column.style.height).toBe("calc(800px - var(--top-bar-h))");
    expect(column.style.paddingBottom).toBe("0px"); // no tab bar room while it's hidden

    act(() => viewport.keyboard(320));
    await nextFrame();
    expect(column.style.height).toBe("calc(480px - var(--top-bar-h))");
    expect(composer.firstElementChild).toHaveClass("pb-3"); // right on the keyboard

    act(() => viewport.keyboard(0)); // keyboard down, still focused (a hardware keyboard)
    await nextFrame();
    expect(column.style.height).toBe("calc(800px - var(--top-bar-h))");
    expect(composer.firstElementChild).toHaveClass("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
  });

  it("follows resize only, at most once a frame, never scroll", async () => {
    const { input, column } = await coach();
    act(() => input.focus());
    await nextFrame();
    const before = frames;
    act(() => {
      viewport.height = 500;
      viewport.dispatchEvent(new Event("resize"));
      viewport.height = 470;
      viewport.dispatchEvent(new Event("resize"));
      viewport.height = 460;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(frames - before).toBe(1); // three resizes, one frame
    await nextFrame();
    expect(column.style.height).toBe("calc(460px - var(--top-bar-h))");
    // iOS panning the document fires scroll, not resize: the height stays.
    act(() => {
      viewport.height = 300;
      viewport.dispatchEvent(new Event("scroll"));
    });
    await nextFrame();
    expect(column.style.height).toBe("calc(460px - var(--top-bar-h))");
  });

  it("keeps the last message right above the composer: the messages area scrolls to its end", async () => {
    const { input, messages } = await coach();
    let top = 0;
    Object.defineProperty(messages, "scrollHeight", { configurable: true, get: () => 1200 });
    Object.defineProperty(messages, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = v) });
    act(() => input.focus());
    act(() => viewport.keyboard(300));
    await nextFrame();
    expect(top).toBe(1200);
  });

  it("keeps its place while focus moves inside the composer, e.g. to Send", async () => {
    const { input, column } = await coach();
    act(() => input.focus());
    act(() => viewport.keyboard(300));
    await nextFrame();
    fireEvent.blur(input, { relatedTarget: screen.getByRole("button", { name: "Send" }) });
    await wait(BLUR_GRACE_MS + 50);
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(true);
    expect(column.style.height).toBe("calc(500px - var(--top-bar-h))");
  });

  it("looks as before once focus leaves: 100dvh, tab bar back", async () => {
    const { input, column } = await coach();
    act(() => input.focus());
    act(() => viewport.keyboard(300));
    await nextFrame();
    act(() => input.blur());
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(true); // not yet: a tap lands first
    await wait(BLUR_GRACE_MS + 50);
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(false);
    expect(column.style.height).toBe("");
    act(() => viewport.keyboard(200)); // a later resize no longer changes anything
    await nextFrame();
    expect(column.style.height).toBe("");
  });

  it("does nothing on a larger screen, where there is no tab bar", async () => {
    phone(false);
    const { input, column } = await coach();
    act(() => input.focus());
    act(() => viewport.keyboard(300));
    await nextFrame();
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(false);
    expect(column.style.height).toBe("");
  });
});

describe("the CSS", () => {
  async function css() {
    const root = join(__dirname, "..");
    const from = join(root, "app", "globals.css");
    return (await postcss([tailwindcss({ base: root })]).process(readFileSync(from, "utf8"), { from })).css;
  }

  it("hides the tab bar below 768 px while the composer has focus", async () => {
    const out = await css();
    const at = out.indexOf(":root[data-composer-focus] [data-tab-bar] {");
    expect(at).toBeGreaterThan(-1);
    expect(out.slice(at, out.indexOf("}", at))).toMatch(/display:\s*none/);
    const media = [...out.slice(0, at).matchAll(/@media ([^{]+)\{/g)].at(-1)?.[1].trim();
    expect(media).toMatch(/max-width:\s*47\.99rem|width\s*<\s*48rem|width\s*<=\s*47\.99rem/);
  });

  it("knows the top bar's height, so the column starts below it", async () => {
    expect(await css()).toMatch(/--top-bar-h:\s*calc\(3\.5rem \+ 1px\)/);
    expect(readFileSync(join(__dirname, "..", "components", "nav.tsx"), "utf8")).toMatch(/border-b[^"]*|h-14/);
  });

  it("marks the tab bar so the rule can find it", () => {
    expect(readFileSync(join(__dirname, "..", "components", "nav.tsx"), "utf8")).toContain("data-tab-bar");
  });
});
