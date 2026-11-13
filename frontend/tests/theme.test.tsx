import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";
import { applyTheme, readTheme, THEME_COLORS, THEME_KEY, THEME_SCRIPT } from "@/lib/theme";

const html = document.documentElement;
const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];

beforeEach(() => {
  localStorage.clear();
  html.removeAttribute("data-theme");
  // The two metas Next renders from the root layout's viewport.themeColor.
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}">
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}">`;
});
afterEach(() => vi.restoreAllMocks());

describe("applyTheme", () => {
  it("forces Dark or Light on <html> and on both theme-color metas", () => {
    applyTheme("dark");
    expect(html.dataset.theme).toBe("dark");
    expect(metas().map((m) => m.content)).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);

    applyTheme("light");
    expect(html.dataset.theme).toBe("light");
    expect(metas().map((m) => m.content)).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
  });

  it("hands System back to the OS: no attribute, each meta for its own scheme", () => {
    applyTheme("dark");
    applyTheme("system");
    expect(html.hasAttribute("data-theme")).toBe(false);
    expect(metas().map((m) => m.content)).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
  });
});

describe("readTheme", () => {
  it("falls back to System for nothing, junk, or blocked storage", () => {
    expect(readTheme()).toBe("system");
    localStorage.setItem(THEME_KEY, "purple");
    expect(readTheme()).toBe("system");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readTheme()).toBe("system");
  });
});

describe("THEME_SCRIPT (inline in <head>)", () => {
  const run = () => new Function(THEME_SCRIPT)();

  it("applies a saved choice before React loads", () => {
    localStorage.setItem(THEME_KEY, "dark");
    run();
    expect(html.dataset.theme).toBe("dark");
    expect(metas().map((m) => m.content)).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
  });

  it("leaves System to the OS", () => {
    run();
    expect(html.hasAttribute("data-theme")).toBe(false);
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(run).not.toThrow();
  });
});

describe("ThemeToggle", () => {
  it("cycles System -> Light -> Dark -> System and remembers the choice", async () => {
    render(<ThemeToggle />);
    const button = () => screen.getByRole("button", { name: /^Theme:/ });
    expect(button()).toHaveAccessibleName("Theme: System. Switch to Light");

    await userEvent.click(button());
    expect(button()).toHaveAccessibleName("Theme: Light. Switch to Dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(html.dataset.theme).toBe("light");

    await userEvent.click(button());
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(html.dataset.theme).toBe("dark");

    await userEvent.click(button());
    expect(button()).toHaveAccessibleName("Theme: System. Switch to Light");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(html.hasAttribute("data-theme")).toBe(false);
  });

  it("still switches when storage is blocked, just without remembering", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    expect(html.dataset.theme).toBe("light");
  });

  it("follows a change made in another tab", () => {
    render(<ThemeToggle />);
    localStorage.setItem(THEME_KEY, "dark");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue: "dark" }));
    });
    expect(screen.getByRole("button", { name: /^Theme:/ })).toHaveAccessibleName("Theme: Dark. Switch to System");
    expect(html.dataset.theme).toBe("dark");
  });
});

describe("globals.css", () => {
  // Vitest runs from frontend/; under jsdom import.meta.url isn't a file: URL.
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} not found`).toBeGreaterThan(-1);
    const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
    return body.split("\n").map((l) => l.trim()).filter(Boolean);
  };

  it("has the same dark tokens for an explicit Dark choice and for a dark OS", () => {
    const explicit = block(':root[data-theme="dark"]');
    expect(explicit).toContain("--canvas: #0e1214;");
    expect(block(':root:not([data-theme="light"])')).toEqual(explicit);
  });

  it("only lets the OS turn things dark when Light wasn't chosen", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
  });
});
