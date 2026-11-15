import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  applyTheme,
  currentAppearance,
  readTheme,
  THEME_COLORS,
  THEME_KEY,
  THEME_SCRIPT,
  toggleTheme,
} from "@/lib/theme";

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

/** A controllable prefers-color-scheme: `os.dark = true; os.fire()` flips the OS. */
const os = { dark: false, listeners: new Set<() => void>(), fire() { this.listeners.forEach((l) => l()); } };
beforeEach(() => {
  os.dark = false;
  os.listeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return query.includes("dark") && os.dark; },
    media: query,
    addEventListener: (_: string, l: () => void) => os.listeners.add(l),
    removeEventListener: (_: string, l: () => void) => os.listeners.delete(l),
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("currentAppearance and toggleTheme", () => {
  it("follow the OS until a choice is saved, then the choice", () => {
    expect(currentAppearance()).toBe("light");
    os.dark = true;
    expect(currentAppearance()).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBeNull(); // nothing stored by looking

    expect(toggleTheme()).toBe("light"); // the opposite of what is shown
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(currentAppearance()).toBe("light"); // the OS no longer decides
  });

  it("never offers System again once a choice is made", () => {
    toggleTheme();
    toggleTheme();
    expect(["light", "dark"]).toContain(localStorage.getItem(THEME_KEY));
  });
});

describe("ThemeToggle", () => {
  const button = () => screen.getByRole("button", { name: /^Switch to/ });

  it("in light mode shows a moon and switches to dark; then a sun and back to light", async () => {
    render(<ThemeToggle />);
    expect(button()).toHaveAccessibleName("Switch to dark mode");
    expect(button()).toHaveAttribute("title", "Switch to dark mode");
    expect(button()).toHaveClass("size-11"); // 44 px target
    expect(localStorage.getItem(THEME_KEY)).toBeNull();

    await userEvent.click(button());
    expect(button()).toHaveAccessibleName("Switch to light mode");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(html.dataset.theme).toBe("dark");

    await userEvent.click(button());
    expect(button()).toHaveAccessibleName("Switch to dark mode");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(html.dataset.theme).toBe("light");
  });

  it("has a sun for dark and a moon for light, chosen by CSS", () => {
    render(<ThemeToggle />);
    expect(button().querySelector(".theme-icon-dark svg")).not.toBeNull();
    expect(button().querySelector(".theme-icon-light svg")).not.toBeNull();
    expect(button().querySelectorAll("svg")).toHaveLength(2); // no System/monitor icon
  });

  it("follows the OS until tapped, and the choice after", async () => {
    render(<ThemeToggle />);
    act(() => {
      os.dark = true;
      os.fire();
    });
    expect(button()).toHaveAccessibleName("Switch to light mode");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();

    await userEvent.click(button()); // dark shown -> light chosen
    act(() => {
      os.dark = false;
      os.fire();
    });
    expect(button()).toHaveAccessibleName("Switch to dark mode");
    act(() => {
      os.dark = true;
      os.fire();
    });
    expect(button()).toHaveAccessibleName("Switch to dark mode"); // the saved choice wins
  });

  it("still switches when storage is blocked, just without remembering", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    render(<ThemeToggle />);
    await userEvent.click(button());
    expect(html.dataset.theme).toBe("dark");
  });

  it("follows a change made in another tab", () => {
    render(<ThemeToggle />);
    localStorage.setItem(THEME_KEY, "dark");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue: "dark" }));
    });
    expect(button()).toHaveAccessibleName("Switch to light mode");
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

  it("picks the toggle's icon with the same rules as the colours", () => {
    expect(css).toContain(':root[data-theme="dark"] .theme-icon-dark');
    expect(css).toContain(':root:not([data-theme="light"]) .theme-icon-dark');
    expect(block(".theme-icon-dark")).toContain("display: none;");
  });

  it("only lets the OS turn things dark when Light wasn't chosen", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
  });
});
