// Instant checks for a template's values in the Log form (#101). The backend
// (backend/forms.py validate_values) decides; these mirror its rules so the
// form can say what is wrong before saving. backend/tests/fixtures/forms.json
// is run by both test suites so the two can't drift.

import type { SetRow, Template, TemplateField, TemplateValue, TemplateValues } from "./api";

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function decimalsOk(v: number, decimals = 0): boolean {
  return Math.abs(Math.round(v * 10 ** decimals) / 10 ** decimals - v) < 1e-9;
}

function numberError(v: unknown, f: { label: string; unit?: string; min?: number; max?: number; decimals?: number }): string | null {
  if (!isNumber(v)) return `${f.label} must be a number`;
  if ((f.min != null && v < f.min) || (f.max != null && v > f.max)) {
    const unit = f.unit ? ` ${f.unit}` : "";
    if (f.min != null && f.max != null) return `${f.label} must be between ${f.min} and ${f.max}${unit}`;
    return f.min != null ? `${f.label} must be at least ${f.min}${unit}` : `${f.label} must be at most ${f.max}${unit}`;
  }
  if (!decimalsOk(v, f.decimals ?? 0)) {
    return (f.decimals ?? 0) === 0 ? `${f.label} takes whole numbers` : `${f.label} takes up to ${f.decimals} decimals`;
  }
  return null;
}

function rowsError(value: unknown, f: TemplateField): string | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return `${f.label} needs 1 to 30 rows`;
  const extras = new Map((f.extras ?? []).map((c) => [c.key, c]));
  const allowed = new Set(["sets", "reps", ...(f.load_unit ? ["load"] : []), ...extras.keys()]);
  for (const [i, row] of (value as SetRow[]).entries()) {
    const what = `${f.label}, row ${i + 1}`;
    if (typeof row !== "object" || row === null) return `${what} must be an object`;
    const unknown = Object.keys(row).filter((k) => !allowed.has(k));
    if (unknown.length) return `${what}: unknown columns ${unknown.join(", ")}`;
    for (const [key, lo, hi] of [["sets", 1, 20], ["reps", 1, 600]] as const) {
      if (!(key in row)) return `${what}: ${key} is missing`;
      const v = row[key];
      if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) {
        const noun = key === "reps" && f.reps_unit === "s" ? "seconds" : key;
        return `${what}: ${noun} must be a whole number from ${lo} to ${hi}`;
      }
    }
    if (row.load != null) {
      if (!isNumber(row.load)) return `${what}: load must be a number`;
      if (!f.load_signed && row.load < 0) return `${what}: load can't be negative here`;
      if (Math.abs(row.load) > 1000 || !decimalsOk(row.load, 2)) return `${what}: load must be at most 1000 with up to 2 decimals`;
    }
    for (const [key, col] of extras) {
      if (row[key] != null) {
        const e = numberError(row[key], { ...col, label: `${what}: ${col.label.toLowerCase()}` });
        if (e) return e;
      }
    }
  }
  return null;
}

function valueError(v: TemplateValue, f: TemplateField, previous?: TemplateValue): string | null {
  switch (f.type) {
    case "number":
      return numberError(v, f);
    case "boolean":
      return typeof v === "boolean" ? null : `${f.label} must be yes or no`;
    case "text":
      if (typeof v !== "string" || !v.trim()) return `${f.label} must be text`;
      return v.trim().length > (f.max_length ?? 200) ? `${f.label} is longer than ${f.max_length ?? 200} characters` : null;
    case "select": {
      const live = new Set((f.options ?? []).filter((o) => !o.archived).map((o) => o.value));
      const kept = new Set<unknown>(Array.isArray(previous) ? previous : previous ? [previous] : []);
      if (f.multiple) {
        if (!Array.isArray(v) || !v.length || new Set<unknown>(v).size !== v.length || !v.every((x) => typeof x === "string")) {
          return `${f.label}: pick one or more options`;
        }
        const bad = (v as string[]).find((x) => !live.has(x) && !kept.has(x));
        return bad ? `${f.label}: ${bad} is not an option` : null;
      }
      if (typeof v !== "string") return `${f.label}: ${String(v)} is not an option`;
      return live.has(v) || kept.has(v) ? null : `${f.label}: ${v} is not an option`;
    }
    case "sets":
      return rowsError(v, f);
    default:
      return `${f.label} takes no value here`;
  }
}

/** The first problem with `values` for `template`, or null. `previous` is the
 *  session's stored values on an edit (archived fields and options may stay). */
export function checkValues(template: Pick<Template, "name" | "fields">, values: Record<string, unknown>, previous: TemplateValues = {}): string | null {
  const fields = new Map(template.fields.filter((f) => f.type !== "climbs").map((f) => [f.key, f]));
  const unknown = Object.keys(values).filter((k) => !fields.has(k));
  if (unknown.length) return `no such fields in ${template.name}: ${unknown.join(", ")}`;
  for (const [key, v] of Object.entries(values)) {
    if (v == null) continue;
    const f = fields.get(key)!;
    if (f.archived && JSON.stringify(previous[key]) !== JSON.stringify(v)) return `${f.label} is archived and can't get new values`;
    const e = valueError(v as TemplateValue, f, previous[key]);
    if (e) return e;
  }
  for (const f of fields.values()) {
    if (f.required && !f.archived && values[f.key] == null) return `${f.label} is required`;
  }
  return null;
}

/** The values with empty answers left out, as the backend expects them. */
export function cleanValues(values: Record<string, TemplateValue | null | undefined>): TemplateValues {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0),
    ),
  ) as TemplateValues;
}
