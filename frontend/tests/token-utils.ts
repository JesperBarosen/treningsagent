// Helpers for the colour tests: read token values from globals.css (or an
// in-memory copy of it, never by editing the file) and measure WCAG contrast.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

export const THEMES = {
  light: ":root",
  dark: ':root[data-theme="dark"]',
  "dark (OS)": ':root:not([data-theme="light"])',
};

/** Hex custom properties set in the first block that starts with `selector {`. */
export function tokens(selector: string, source = css): Record<string, string> {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} not found`);
  const body = source.slice(source.indexOf("{", start) + 1, source.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio. */
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
