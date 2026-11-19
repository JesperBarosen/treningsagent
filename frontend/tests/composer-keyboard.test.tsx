// The Coach composer on a phone with the on-screen keyboard open: the tab bar
// steps aside and the composer sits on the keyboard (lib/keyboard.ts). jsdom has
// no keyboard, so window.visualViewport and matchMedia are stubbed.
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
}));

const { Chat } = await import("@/app/chat");
const { BLUR_GRACE_MS, KEYBOARD_ATTR, keyboardInset, keyboardTop } = await import("@/lib/keyboard");

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
function phone(isPhone: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: isPhone }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  viewport = new FakeViewport();
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  phone(true);
});

afterEach(() => {
  document.documentElement.removeAttribute(KEYBOARD_ATTR);
});

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("keyboardInset", () => {
  it("is what the visual viewport leaves uncovered at the bottom", () => {
    expect(keyboardInset()).toBe(0);
    viewport.height = 500;
    expect(keyboardInset()).toBe(300);
    viewport.offsetTop = 40; // iOS scrolled the visible part down
    expect(keyboardInset()).toBe(260);
    viewport.height = 900; // never negative
    expect(keyboardInset()).toBe(0);
  });

  it("is 0 without visualViewport", () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
    expect(keyboardInset()).toBe(0);
  });
});

describe("the composer on a phone", () => {
  async function focusedComposer() {
    render(<Chat />);
    const input = await screen.findByLabelText("Message");
    const composer = screen.getByTestId("composer");
    act(() => input.focus());
    return { input, composer };
  }

  it("sits on the tab bar until it has focus", async () => {
    render(<Chat />);
    const composer = screen.getByTestId("composer");
    await screen.findByLabelText("Message");
    expect(composer).toHaveClass("bottom-tab-bar", "md:bottom-0");
    expect(composer.style.bottom).toBe("");
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(false);
  });

  /** Pinned with its bottom edge at `px` from the top of the layout viewport. */
  const pinnedAt = (composer: HTMLElement, px: number) => {
    expect(composer.style.top).toBe(`${px}px`);
    expect(composer.style.bottom).toBe("auto");
    expect(composer.style.transform).toBe("translateY(-100%)");
  };

  it("hides the tab bar on focus and sits right on the keyboard as it opens and closes (#138)", async () => {
    const { composer } = await focusedComposer();
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(true);
    pinnedAt(composer, 800);

    act(() => viewport.keyboard(320));
    pinnedAt(composer, 480); // its bottom edge on the keyboard's top: no gap
    expect(composer.firstElementChild).toHaveClass("pb-3");

    act(() => viewport.keyboard(0)); // keyboard down, still focused (e.g. a hardware keyboard)
    pinnedAt(composer, 800);
    expect(composer.firstElementChild).toHaveClass("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
  });

  it("follows the visible part when iOS scrolls it, without reading innerHeight", async () => {
    const { composer } = await focusedComposer();
    // The home-screen app: innerHeight doesn't match the fixed-position box.
    Object.defineProperty(window, "innerHeight", { value: 860, configurable: true });
    viewport.offsetTop = 40;
    act(() => viewport.keyboard(320));
    pinnedAt(composer, 40 + 480);
    expect(keyboardTop()).toBe(520);
  });

  it("keeps its place while focus moves inside it, e.g. to Send", async () => {
    const { input, composer } = await focusedComposer();
    act(() => viewport.keyboard(300));
    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.blur(input, { relatedTarget: send });
    await wait(BLUR_GRACE_MS + 50);
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(true);
    pinnedAt(composer, 500);
  });

  it("brings the tab bar back shortly after focus leaves, so a tap lands first", async () => {
    const { input, composer } = await focusedComposer();
    act(() => viewport.keyboard(300));
    act(() => input.blur());
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(true); // not yet
    await wait(BLUR_GRACE_MS + 50);
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(false);
    expect(composer.style.top).toBe("");
    expect(composer.style.transform).toBe("");
    // A later resize no longer moves it.
    act(() => viewport.keyboard(200));
    expect(composer.style.top).toBe("");
  });

  it("does nothing on a larger screen, where there is no tab bar", async () => {
    phone(false);
    const { composer } = await focusedComposer();
    act(() => viewport.keyboard(300));
    expect(document.documentElement.hasAttribute(KEYBOARD_ATTR)).toBe(false);
    expect(composer.style.top).toBe("");
  });

  it("is opaque: nothing of the conversation or the tab bar shows through (#138)", async () => {
    render(<Chat />);
    await screen.findByLabelText("Message");
    const composer = screen.getByTestId("composer");
    expect(composer).toHaveClass("bg-elevated");
    expect(composer.className).not.toMatch(/bg-elevated\/|backdrop-blur|opacity-/);
  });

  it("keeps the last message right above the composer while typing, and resets after", async () => {
    const { input } = await focusedComposer();
    const end = screen.getByTestId("conversation-end");
    const box = end.parentElement!;
    const scroll = vi.mocked(window.HTMLElement.prototype.scrollIntoView);
    scroll.mockClear();
    act(() => viewport.keyboard(320));
    // jsdom has no layout, so the composer measures 0 px tall here.
    expect(box.style.paddingBottom).toBe(`${320 + 0 + 16}px`);
    expect(end.style.scrollMarginBottom).toBe("8px");
    expect(scroll.mock.contexts).toContain(end);
    expect(scroll).toHaveBeenLastCalledWith({ block: "end" });

    act(() => input.blur());
    await wait(BLUR_GRACE_MS + 50);
    expect(box.style.paddingBottom).toBe(""); // back to the class's padding, as before
    expect(box).toHaveClass("pb-52");
  });
});

describe("the CSS", () => {
  it("hides the tab bar below 768 px while the composer has focus", async () => {
    const root = join(__dirname, "..");
    const from = join(root, "app", "globals.css");
    const css = (await postcss([tailwindcss({ base: root })]).process(readFileSync(from, "utf8"), { from })).css;
    const at = css.indexOf(":root[data-composer-focus] [data-tab-bar] {");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/display:\s*none/);
    const media = [...css.slice(0, at).matchAll(/@media ([^{]+)\{/g)].at(-1)?.[1].trim();
    expect(media).toMatch(/max-width:\s*47\.99rem|width\s*<\s*48rem|width\s*<=\s*47\.99rem/);
  });

  it("marks the tab bar so the rule can find it", () => {
    expect(readFileSync(join(__dirname, "..", "components", "nav.tsx"), "utf8")).toContain("data-tab-bar");
  });
});
