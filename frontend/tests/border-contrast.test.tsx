import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionForm } from "@/components/session-form";

// WCAG 2.2 SC 1.4.11 Non-text Contrast (#53): the edge that identifies a field,
// chip or outlined button needs 3:1 against what is next to it.

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/** The custom properties set in the first block that starts with `selector {`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("control edges at 3:1 (WCAG 1.4.11)", () => {
  const themes = {
    light: tokens(":root"),
    dark: tokens(':root[data-theme="dark"]'),
    "dark (OS)": tokens(':root:not([data-theme="light"])'),
  };

  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: --control is at least 3:1 on surface, canvas and sunken`, () => {
      expect(t.control, "--control missing").toBeDefined();
      for (const bg of ["surface", "canvas", "sunken"]) {
        expect(ratio(t.control, t[bg]), `${name} control on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("keeps --line as a lighter, decorative hairline (it alone would fail)", () => {
    expect(ratio(themes.light.line, themes.light.surface)).toBeLessThan(3);
  });

  it("the Log form's fields and chips use the control edge, not the hairline", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    render(<SessionForm onSubmit={async () => {}} />);
    const controls = [
      ...screen.getAllByRole("radio"),
      ...screen.queryAllByRole("textbox"),
      ...screen.queryAllByRole("spinbutton"),
    ].filter((el) => /\bborder\b/.test(el.className));
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) {
      expect(el.className, el.outerHTML.slice(0, 80)).toContain("border-control");
      expect(el.className).not.toContain("border-line");
    }
    vi.useRealTimers();
  });
});

describe("no control is left on the hairline", () => {
  // A source-level guard over the files that render controls: an <input>,
  // <textarea> or outlined Button must not use border-line.
  const files = [
    "app/chat.tsx",
    "app/review/review-view.tsx",
    "app/sessions/session-sheet.tsx",
    "app/sign-in/sign-in-form.tsx",
    "app/account/set-password-form.tsx",
    "components/session-card.tsx",
    "components/session-form.tsx",
  ];
  it.each(files)("%s", (file) => {
    const src = readFileSync(join(__dirname, "..", file), "utf8");
    // Outlined buttons: <Button ... className="... border border-line ...">
    expect(src).not.toMatch(/<Button[^>]*border border-line/); // [^>] already spans lines
    // Text fields: any class string that styles a field (resize-none / text-base inputs).
    for (const m of src.matchAll(/"[^"]*\b(resize-none|text-base)\b[^"]*"/g)) {
      if (/\bborder\b/.test(m[0])) expect(m[0]).not.toContain("border-line");
    }
  });
});
