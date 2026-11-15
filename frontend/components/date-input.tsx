"use client";

import { useRef } from "react";

/** The date field's own classes. iOS Safari draws a native date value at the
 *  top of the box. Plain appearance plus a line-height of the inner height
 *  (44 px minus the 2 px border) centres it. The line-height must be a utility:
 *  text-base sets its own, which beats any @layer base rule (#88, #89).
 *  globals.css keeps -webkit-appearance and the value's left alignment. */
export const DATE_FIELD = "h-11 appearance-none text-left leading-[calc(2.75rem-2px)]";

const input =
  `block min-h-11 w-full min-w-0 rounded-md border border-control bg-surface px-3 text-base text-ink tabular-nums ${DATE_FIELD}`;

/** Every date field in the app. Give it an `id` and point a <label htmlFor> at
 *  it (a wrapping <label> would also take the Clear button's text).
 *  With `optional`, a 44 px Clear button empties a set date. iOS has no clear
 *  control once appearance is none. `className` styles the wrapper (margins, width). */
export function DateInput({
  id,
  value,
  onChange,
  optional = false,
  min,
  max,
  className = "",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  min?: string;
  max?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const clearable = optional && value !== "";
  return (
    <div className={`flex min-w-0 items-center gap-1 ${className}`}>
      <input
        ref={ref}
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={input}
      />
      {clearable && (
        <button
          type="button"
          aria-label="Clear date"
          onClick={() => {
            onChange("");
            ref.current?.focus(); // the button disappears; keep focus in the field
          }}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium text-ink-muted transition hover:bg-sunken hover:text-ink"
        >
          Clear
        </button>
      )}
    </div>
  );
}
