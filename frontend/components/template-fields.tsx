"use client";

import { useState, type ReactNode } from "react";
import type { SetRow, Template, TemplateField, TemplateValue } from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { CloseIcon, PlusIcon } from "./icons";

// A template's own fields in the Log form (#101, docs/custom-log-forms.md 6.3,
// mockup 3). Every control is at least 44 px; values blur in discreet mode,
// labels stay (Q6). Sets are grouped rows with steppers (T3 variant A).

export type FormValues = Record<string, TemplateValue | null>;

const field = "block min-h-11 w-full min-w-0 rounded-md border border-control bg-surface px-3 text-base text-ink tabular-nums";
const label = "mb-1 block text-sm font-medium";
const chip =
  "inline-flex min-h-11 items-center rounded-full border border-control bg-surface px-3.5 text-sm font-medium text-ink aria-checked:border-accent aria-checked:bg-accent-soft aria-checked:text-accent aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent";

function Optional({ f }: { f: TemplateField }) {
  return f.required ? null : <span className="font-normal text-ink-muted">(optional)</span>;
}

function Help({ f }: { f: TemplateField }) {
  return f.help ? <p className="mt-1 text-xs text-ink-muted">{f.help}</p> : null;
}

/** "71.5" -> 71.5, "" -> null; anything else keeps the text for the check to report. */
function parseNumber(text: string): number | null | string {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : text;
}

function NumberField({ f, value, onChange }: { f: TemplateField; value: TemplateValue | null; onChange: (v: TemplateValue | null) => void }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const id = `tf-${f.key}`;
  return (
    <div>
      <label htmlFor={id} className={label}>
        {f.label}
        {f.unit && ` (${f.unit})`} <Optional f={f} />
      </label>
      <input
        id={id}
        inputMode={f.decimals ? "decimal" : "numeric"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNumber(e.target.value);
          onChange(typeof n === "string" ? (n as unknown as TemplateValue) : n);
        }}
        className={field}
        {...SENSITIVE}
      />
      <Help f={f} />
    </div>
  );
}

function SelectField({ f, value, onChange }: { f: TemplateField; value: TemplateValue | null; onChange: (v: TemplateValue | null) => void }) {
  // Archived options only show when the session already has them.
  const picked = Array.isArray(value) ? (value as string[]) : value ? [value as string] : [];
  const options = (f.options ?? []).filter((o) => !o.archived || picked.includes(o.value));
  return (
    <fieldset className="min-w-0">
      <legend className={label}>
        {f.label} {f.multiple && <span className="font-normal text-ink-muted">(one or more)</span>} <Optional f={f} />
      </legend>
      <div className="flex flex-wrap gap-2" role={f.multiple ? "group" : "radiogroup"} aria-label={f.label} {...SENSITIVE}>
        {options.map((o) => {
          const on = picked.includes(o.value);
          return f.multiple ? (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                const next = on ? picked.filter((v) => v !== o.value) : [...picked, o.value];
                onChange(next.length ? next : null);
              }}
              className={chip}
            >
              {o.label}
            </button>
          ) : (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              // Tapping the chosen one again clears an optional answer.
              onClick={() => onChange(on && !f.required ? null : o.value)}
              className={chip}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <Help f={f} />
    </fieldset>
  );
}

function BooleanField({ f, value, onChange }: { f: TemplateField; value: TemplateValue | null; onChange: (v: TemplateValue | null) => void }) {
  return (
    <fieldset className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-2">
      <legend className="float-left text-sm font-medium">
        {f.label} <Optional f={f} />
      </legend>
      <div role="radiogroup" aria-label={f.label} className="inline-flex rounded-full border border-control bg-surface p-1" {...SENSITIVE}>
        {([true, false] as const).map((b) => (
          <button
            key={String(b)}
            type="button"
            role="radio"
            aria-checked={value === b}
            onClick={() => onChange(value === b && !f.required ? null : b)}
            className="min-h-9 rounded-full px-4 text-sm font-medium text-ink-muted aria-checked:bg-accent-soft aria-checked:text-accent"
          >
            {b ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function TextField({ f, value, onChange }: { f: TemplateField; value: TemplateValue | null; onChange: (v: TemplateValue | null) => void }) {
  const id = `tf-${f.key}`;
  return (
    <div>
      <label htmlFor={id} className={label}>
        {f.label} <Optional f={f} />
      </label>
      <input
        id={id}
        value={(value as string) ?? ""}
        maxLength={f.max_length ?? 200}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className={field}
        {...SENSITIVE}
      />
      <Help f={f} />
    </div>
  );
}

/** A number with − and + (44 px each) around a typed value. */
export function Stepper({
  label: text,
  unit,
  value,
  step = 1,
  min,
  max,
  signed = false,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number | undefined;
  step?: number;
  min?: number;
  max?: number;
  signed?: boolean;
  onChange: (v: number | undefined) => void;
}) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? (signed ? -Infinity : 0), v));
  const shown = value === undefined ? "" : signed && value > 0 ? `+${value}` : String(value);
  return (
    <div>
      <span className="mb-0.5 block text-xs text-ink-muted">{text}</span>
      <div className="flex min-h-11 items-center rounded-md border border-control bg-surface">
        <button type="button" aria-label={`Less ${text.toLowerCase()}`} onClick={() => onChange(clamp((value ?? 0) - step))} className="grid h-11 w-10 shrink-0 place-items-center text-lg text-ink-muted">
          −
        </button>
        <input
          aria-label={text}
          inputMode="decimal"
          value={shown}
          onChange={(e) => {
            const n = parseNumber(e.target.value.replace("+", ""));
            onChange(typeof n === "number" ? n : undefined);
          }}
          className="w-full min-w-0 bg-transparent text-center font-semibold tabular-nums"
          {...SENSITIVE}
        />
        {unit && <span className="pr-1 text-xs text-ink-muted">{unit}</span>}
        <button type="button" aria-label={`More ${text.toLowerCase()}`} onClick={() => onChange(clamp((value ?? 0) + step))} className="grid h-11 w-10 shrink-0 place-items-center text-lg text-ink-muted">
          +
        </button>
      </div>
    </div>
  );
}

function SetsField({ f, value, onChange }: { f: TemplateField; value: TemplateValue | null; onChange: (v: TemplateValue | null) => void }) {
  const rows = (Array.isArray(value) ? value : []) as SetRow[];
  const blank: SetRow = { sets: 3, reps: f.reps_unit === "s" ? 10 : 8 };
  const set = (i: number, patch: Partial<SetRow>) =>
    onChange(rows.map((r, j) => (j === i ? (Object.fromEntries(Object.entries({ ...r, ...patch }).filter(([, v]) => v !== undefined)) as SetRow) : r)));
  const repsLabel = f.reps_unit === "s" ? "Seconds each" : "Reps";
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className={label}>
        {f.label} <Optional f={f} />
      </legend>
      {rows.map((r, i) => (
        <div key={i} role="group" aria-label={`${f.label}, group ${i + 1}`} className="rounded-lg border border-line bg-surface p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Group {i + 1}</span>
            <button
              type="button"
              aria-label={`Remove group ${i + 1}`}
              onClick={() => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : null)}
              className="grid size-11 place-items-center rounded-full text-ink-muted hover:bg-sunken"
            >
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <Stepper label="Sets" value={r.sets} min={1} max={20} onChange={(v) => set(i, { sets: v ?? 1 })} />
            <Stepper label={repsLabel} unit={f.reps_unit === "s" ? "s" : undefined} value={r.reps} min={1} max={600} onChange={(v) => set(i, { reps: v ?? 1 })} />
            {(f.extras ?? []).map((c) => (
              <Stepper key={c.key} label={c.label} unit={c.unit} value={r[c.key]} min={c.min} max={c.max} onChange={(v) => set(i, { [c.key]: v })} />
            ))}
            {f.load_unit && (
              <Stepper
                label={f.load_signed ? "Added load" : "Load"}
                unit={f.load_unit}
                value={r.load}
                step={f.load_unit === "kg" ? 2.5 : 5}
                signed={f.load_signed}
                onChange={(v) => set(i, { load: v })}
              />
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, rows.length ? { ...rows[rows.length - 1] } : blank])}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-dashed border-control text-sm font-semibold text-accent"
      >
        <PlusIcon size={16} /> {rows.length ? "Add group" : `Add ${f.label.toLowerCase()}`}
      </button>
      {rows.length > 0 && (
        <p {...SENSITIVE} className="text-xs text-ink-muted tabular-nums">
          {setsTotal(rows, f)}
        </p>
      )}
      <Help f={f} />
    </fieldset>
  );
}

/** "9 hangs · 81 s under load" or "24 reps". */
export function setsTotal(rows: SetRow[], f: Pick<TemplateField, "reps_unit">): string {
  const sets = rows.reduce((n, r) => n + (r.sets ?? 0), 0);
  const reps = rows.reduce((n, r) => n + (r.sets ?? 0) * (r.reps ?? 0), 0);
  return f.reps_unit === "s" ? `${sets} sets · ${reps} s in total` : `${sets} sets · ${reps} reps`;
}

/** The template's fields in order. The climbs field (if any) is drawn by the
 *  Log form's own climbs section, passed as `climbs`. Archived fields show
 *  only when the session already has a value for them. */
export function TemplateFields({
  template,
  values,
  onChange,
  climbs,
}: {
  template: Pick<Template, "fields">;
  values: FormValues;
  onChange: (key: string, value: TemplateValue | null) => void;
  climbs?: ReactNode;
}) {
  return (
    <>
      {template.fields
        .filter((f) => !f.archived || values[f.key] != null)
        .map((f) => {
          const props = { f, value: values[f.key] ?? null, onChange: (v: TemplateValue | null) => onChange(f.key, v) };
          switch (f.type) {
            case "number":
              return <NumberField key={f.key} {...props} />;
            case "select":
              return <SelectField key={f.key} {...props} />;
            case "boolean":
              return <BooleanField key={f.key} {...props} />;
            case "text":
              return <TextField key={f.key} {...props} />;
            case "sets":
              return <SetsField key={f.key} {...props} />;
            case "climbs":
              return <div key={f.key}>{climbs}</div>;
          }
        })}
    </>
  );
}
