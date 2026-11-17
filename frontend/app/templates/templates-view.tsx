"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon, CloseIcon, PinIcon, PlusIcon, SportBadge } from "@/components/icons";
import { Button, ErrorState, Skeleton } from "@/components/states";
import {
  addStarters,
  ApiError,
  createTemplate,
  SPORTS,
  updateTemplate,
  getTemplates,
  type FieldType,
  type Sport,
  type Template,
  type TemplateField,
  type TemplateInput,
} from "@/lib/api";
import { sportName } from "@/lib/format";

// Log forms (#101, docs/custom-log-forms.md 6.1-6.2, mockups 1 and 2): the
// built-in forms with the user's templates by sport (T1 variant A), starters
// on first use (Q3), and the editor with up and down buttons (T2 variant A).
// Keys, types and units are fixed once saved (the backend enforces it); used
// fields and templates are archived, never deleted.

const SPORT_LABEL: Record<Sport, string> = { running: "Running", climbing: "Climbing", strength: "Strength", other: "Other" };
const BUILT_IN: Record<Sport, string> = {
  running: "Distance · Elevation",
  climbing: "Climbs",
  strength: "Core fields only",
  other: "Core fields only",
};
const TYPE_INFO: Record<FieldType, { icon: string; name: string; about: string }> = {
  number: { icon: "12", name: "Number", about: "One value with a unit: kg, mm, s, km, %" },
  select: { icon: "☰", name: "Select", about: "Pick one or several from your options" },
  boolean: { icon: "✓", name: "Yes or no", about: "A switch, e.g. “Any finger pain?”" },
  text: { icon: "Aa", name: "Text", about: "A short note in its own field" },
  sets: { icon: "×", name: "Sets × reps × load", about: "Rows of sets, reps or seconds, load and up to 2 extra columns" },
  climbs: { icon: "▲", name: "Climbs", about: "Grade chips with your gyms. Climb templates only" },
};

type FieldDraft = TemplateField & { uid: string; saved: boolean };
type Draft = { id: number | null; name: string; sport: Sport; core_fields: Template["core_fields"]; fields: FieldDraft[]; archived: boolean };

let uidCount = 0;
const uid = () => `f${++uidCount}`;

const input = "block min-h-11 w-full min-w-0 rounded-md border border-control bg-surface px-3 text-base text-ink";
const small = "mb-1 block text-sm font-medium";
const iconButton = "grid size-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sunken disabled:opacity-30";

function summary(fields: TemplateField[]): string {
  const live = fields.filter((f) => !f.archived);
  return live.length ? live.map((f) => f.label).join(" · ") : "Core fields only";
}

function toDraft(t: Template, copy = false): Draft {
  return {
    id: copy ? null : t.id,
    name: copy ? `${t.name} copy` : t.name,
    sport: t.sport,
    core_fields: t.core_fields,
    archived: copy ? false : t.archived,
    fields: t.fields.map((f) => ({ ...f, uid: uid(), saved: !copy, ...(copy ? { key: "" } : {}) })),
  };
}

function builtInDraft(sport: Sport): Draft {
  return {
    id: null,
    name: "",
    sport,
    core_fields: sport === "running" ? ["distance_km", "elevation_m"] : [],
    archived: false,
    fields: sport === "climbing" ? [{ uid: uid(), saved: false, key: "", label: "Climbs", type: "climbs", default_style: "boulder" }] : [],
  };
}

export function TemplatesView() {
  const [data, setData] = useState<{ templates: Template[]; starters: { name: string; sport: Sport }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    getTemplates(signal)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => {
        if (!signal?.aborted) setError(e instanceof ApiError ? e.message : "Couldn't load your log forms.");
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  if (draft) {
    return (
      <TemplateEditor
        start={draft}
        onCancel={() => setDraft(null)}
        onSaved={() => {
          setDraft(null);
          load();
        }}
      />
    );
  }

  const live = data?.templates.filter((t) => !t.archived) ?? [];
  const archived = data?.templates.filter((t) => t.archived) ?? [];
  return (
    <div className="pt-4 pb-12">
      <Link href="/you" className="inline-flex min-h-11 items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ChevronIcon size={14} className="rotate-180" /> You
      </Link>
      <h1 className="font-display text-xl font-semibold">Log forms</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Your own fields for a kind of session. Date, duration, effort, notes and tags are always there, so load stays minutes × effort.
      </p>
      <Button className="mt-4 w-full" onClick={() => setDraft(builtInDraft("other"))}>
        <PlusIcon size={18} /> New template
      </Button>
      {error && <ErrorState offline={false} message={error} onRetry={() => load()} />}
      {!data && !error && <Skeleton className="mt-4 h-40" />}
      {data && live.length === 0 && archived.length === 0 && <Starters starters={data.starters} onAdded={() => load()} />}
      {data &&
        SPORTS.map((sport) => (
          <section key={sport} className="mt-5" aria-labelledby={`sport-${sport}`}>
            <h2 id={`sport-${sport}`} className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {SPORT_LABEL[sport]}
            </h2>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              <li className="flex min-h-16 items-center gap-3 px-4 py-2">
                <SportBadge sport={sport} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {sportName({ sport })} <span className="ml-1 text-xs font-normal text-ink-muted">Built-in</span>
                  </span>
                  <span className="block truncate text-xs text-ink-muted">{BUILT_IN[sport]}</span>
                </span>
                <button type="button" onClick={() => setDraft({ ...builtInDraft(sport), name: `${sportName({ sport })} copy` })} className="min-h-11 px-2 text-sm font-medium text-accent">
                  Duplicate
                </button>
              </li>
              {live
                .filter((t) => t.sport === sport)
                .map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setDraft(toDraft(t))} className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left hover:bg-sunken">
                      <SportBadge sport={sport} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{t.name}</span>
                        <span className="block truncate text-xs text-ink-muted">{summary(t.fields)}</span>
                      </span>
                      <ChevronIcon size={18} className="text-ink-muted" />
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      <section className="mt-5">
        <Link href="/gyms" className="flex min-h-14 items-center gap-3 rounded-lg border border-line bg-surface px-4 hover:bg-sunken">
          <PinIcon size={20} className="text-climb" />
          <span className="flex-1 font-medium">Gyms</span>
          <ChevronIcon size={18} className="text-ink-muted" />
        </Link>
      </section>
      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-muted">Archived ({archived.length})</summary>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {archived.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setDraft(toDraft(t))} className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-sunken">
                  <SportBadge sport={t.sport} size="sm" />
                  <span className="flex-1 font-medium">{t.name}</span>
                  <ChevronIcon size={18} className="text-ink-muted" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** First use (Q3): pick starters to add, each a template the user then owns. */
function Starters({ starters, onAdded }: { starters: { name: string; sport: Sport }[]; onAdded: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-4" aria-labelledby="starters-title">
      <h2 id="starters-title" className="font-semibold">
        Start from a template
      </h2>
      <p className="mt-1 text-sm text-ink-muted">Add any of these and change them as you like.</p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Starters">
        {starters.map((s) => (
          <button
            key={s.name}
            type="button"
            aria-pressed={picked.includes(s.name)}
            onClick={() => setPicked((p) => (p.includes(s.name) ? p.filter((x) => x !== s.name) : [...p, s.name]))}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-control bg-surface px-3.5 text-sm font-medium aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
          >
            {s.name}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button
        className="mt-3"
        disabled={!picked.length || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await addStarters(picked);
            onAdded();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Couldn't add the templates.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Adding…" : picked.length ? `Add ${picked.length}` : "Add"}
      </Button>
    </section>
  );
}

function newField(type: FieldType): FieldDraft {
  const base = { uid: uid(), saved: false, key: "", label: "", type, required: false };
  switch (type) {
    case "number":
      return { ...base, unit: "", decimals: 0 };
    case "select":
      return { ...base, options: [{ value: "", label: "" }, { value: "", label: "" }], multiple: false };
    case "text":
      return { ...base, max_length: 200 };
    case "sets":
      return { ...base, reps_unit: "reps", load_unit: "kg", load_signed: false, extras: [] };
    case "climbs":
      return { ...base, label: "Climbs", default_style: "boulder" };
    default:
      return base;
  }
}

/** What the API gets: no ui ids, no empty optional properties. */
function toInput(d: Draft): TemplateInput {
  return {
    name: d.name.trim(),
    sport: d.sport,
    core_fields: d.sport === "running" ? d.core_fields : [],
    fields: d.fields
      .filter((f) => f.saved || !f.archived)
      .map((f) => {
        const out: Record<string, unknown> = { ...f, label: f.label.trim() };
        delete out.uid;
        delete out.saved;
        if (!f.key) delete out.key;
        if (f.unit === "") delete out.unit;
        if (f.options) out.options = f.options.map((o) => (o.value ? o : { label: o.label, archived: o.archived }));
        for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
        return out as TemplateInput["fields"][number];
      }),
  };
}

function TemplateEditor({ start, onCancel, onSaved }: { start: Draft; onCancel: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(start);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const live = draft.fields.filter((f) => !f.archived);
  const valid = draft.name.trim() !== "" && live.every((f) => f.label.trim() !== "");

  const change = (u: string, patch: Partial<FieldDraft>) =>
    setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.uid === u ? { ...f, ...patch } : f)) }));
  const move = (u: string, by: number) =>
    setDraft((d) => {
      const fs = [...d.fields];
      const i = fs.findIndex((f) => f.uid === u);
      // Step over archived fields, which are hidden.
      let j = i + by;
      while (fs[j]?.archived) j += by;
      if (j < 0 || j >= fs.length) return d;
      [fs[i], fs[j]] = [fs[j], fs[i]];
      return { ...d, fields: fs };
    });
  // A saved field may hold logged values: archive it. A new one just goes.
  const remove = (f: FieldDraft) =>
    setDraft((d) => ({ ...d, fields: f.saved ? d.fields.map((x) => (x.uid === f.uid ? { ...x, archived: true } : x)) : d.fields.filter((x) => x.uid !== f.uid) }));

  async function save(extra?: { archived: boolean }) {
    setBusy(true);
    setError(null);
    try {
      if (draft.id === null) await createTemplate(toInput(draft));
      else await updateTemplate(draft.id, { ...toInput(draft), ...extra });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the template.");
      setBusy(false);
    }
  }

  const canClimbs = draft.sport === "climbing" && !live.some((f) => f.type === "climbs");
  return (
    <form
      className="flex flex-col gap-4 pt-4 pb-12"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save();
      }}
    >
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold">{draft.id === null ? "New template" : "Edit template"}</h1>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div>
        <label htmlFor="template-name" className={small}>
          Name
        </label>
        <input id="template-name" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={input} />
      </div>
      <fieldset className="min-w-0">
        <legend className={small}>Sport</legend>
        <div role="radiogroup" aria-label="Sport" className="grid grid-cols-2 gap-2">
          {SPORTS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={draft.sport === s}
              // A template's sport decides its Dashboard series; the backend keeps it once used.
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  sport: s,
                  fields: s === "climbing" ? d.fields : d.fields.filter((f) => f.type !== "climbs" || f.saved),
                }))
              }
              className="flex min-h-12 items-center gap-2 rounded-md border border-control bg-surface px-3 font-medium aria-checked:border-accent aria-checked:bg-accent-soft"
            >
              <SportBadge sport={s} size="sm" />
              {sportName({ sport: s })}
            </button>
          ))}
        </div>
      </fieldset>
      {draft.sport === "running" && (
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className={small}>Running fields to show</legend>
          {(
            [
              ["distance_km", "Distance and pace"],
              ["elevation_m", "Elevation gain"],
            ] as const
          ).map(([k, text]) => (
            <label key={k} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={draft.core_fields.includes(k)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, core_fields: e.target.checked ? [...d.core_fields, k] : d.core_fields.filter((x) => x !== k) }))
                }
                className="size-5 accent-accent"
              />
              {text}
            </label>
          ))}
        </fieldset>
      )}
      <p className="rounded-md border border-line bg-surface px-3 py-2.5 text-sm">
        <span className="block text-xs text-ink-muted">Always included</span>
        Date · Duration · Effort · Notes · Tags
      </p>

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Fields</h2>
        {live.map((f, i) => (
          <FieldCard
            key={f.uid}
            field={f}
            open={open === f.uid}
            first={i === 0}
            last={i === live.length - 1}
            onToggle={() => setOpen((o) => (o === f.uid ? null : f.uid))}
            onChange={(patch) => change(f.uid, patch)}
            onMove={(by) => move(f.uid, by)}
            onRemove={() => remove(f)}
          />
        ))}
        <button
          type="button"
          onClick={() => sheet.current?.showModal()}
          disabled={live.length >= 20}
          className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full border border-dashed border-control text-sm font-semibold text-accent disabled:opacity-40"
        >
          <PlusIcon size={16} /> Add field
        </button>
        {draft.fields.some((f) => f.archived && f.saved) && (
          <p className="text-xs text-ink-muted">
            Archived fields keep the values you logged:{" "}
            {draft.fields
              .filter((f) => f.archived)
              .map((f) => f.label)
              .join(", ")}
            .
          </p>
        )}
      </div>

      <dialog
        ref={sheet}
        aria-labelledby="add-field-title"
        onClick={(e) => e.target === sheet.current && sheet.current?.close()}
        className="m-0 mt-auto w-full max-w-none rounded-t-lg bg-elevated px-4 pt-3 pb-6 text-ink shadow-sheet backdrop:bg-ink/40 sm:m-auto sm:max-w-md sm:rounded-lg"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 id="add-field-title" className="font-display text-lg font-semibold">
            Add a field
          </h2>
          <button type="button" onClick={() => sheet.current?.close()} aria-label="Close" className={iconButton}>
            <CloseIcon size={16} />
          </button>
        </div>
        <ul className="divide-y divide-line">
          {(Object.keys(TYPE_INFO) as FieldType[]).map((t) => (
            <li key={t}>
              <button
                type="button"
                disabled={t === "climbs" && !canClimbs}
                onClick={() => {
                  const f = newField(t);
                  setDraft((d) => ({ ...d, fields: [...d.fields, f] }));
                  setOpen(f.uid);
                  sheet.current?.close();
                }}
                className="flex min-h-14 w-full items-center gap-3 text-left disabled:opacity-50"
              >
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-sunken font-display text-sm text-ink-muted">
                  {TYPE_INFO[t].icon}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{TYPE_INFO[t].name}</span>
                  <span className="block text-xs text-ink-muted">{TYPE_INFO[t].about}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </dialog>

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!valid || busy}>
        {busy ? "Saving…" : "Save template"}
      </Button>
      {draft.id !== null && (
        <Button variant="ghost" disabled={busy} onClick={() => save({ archived: !start.archived })}>
          {start.archived ? "Restore template" : "Archive template"}
        </Button>
      )}
    </form>
  );
}

function FieldCard({
  field: f,
  open,
  first,
  last,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: {
  field: FieldDraft;
  open: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<FieldDraft>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const info = TYPE_INFO[f.type];
  const name = f.label || info.name;
  return (
    <div className={`rounded-lg border bg-surface ${open ? "border-accent" : "border-line"}`}>
      <div className="flex items-center gap-1 pl-2">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-14 min-w-0 flex-1 items-center gap-2 text-left">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-sunken font-display text-sm text-ink-muted">
            {info.icon}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className="block truncate text-xs text-ink-muted">
              {info.name}
              {f.unit ? ` · ${f.unit}` : ""}
              {f.required ? " · required" : ""}
            </span>
          </span>
        </button>
        <button type="button" onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${name} up`} className={iconButton}>
          <ArrowUpIcon size={18} />
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={last} aria-label={`Move ${name} down`} className={iconButton}>
          <ArrowDownIcon size={18} />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line p-3">
          <div>
            <label htmlFor={`label-${f.uid}`} className={small}>
              Label
            </label>
            <input id={`label-${f.uid}`} value={f.label} maxLength={40} onChange={(e) => onChange({ label: e.target.value })} className={input} />
          </div>
          <FieldSettings f={f} onChange={onChange} />
          {f.type !== "climbs" && (
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              Required
              <input type="checkbox" checked={Boolean(f.required)} onChange={(e) => onChange({ required: e.target.checked })} className="size-5 accent-accent" />
            </label>
          )}
          <Button variant="ghost" onClick={onRemove} className="self-start text-danger">
            {f.saved ? "Archive field" : "Remove field"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The type's own settings. Units and the kind of reps are fixed once saved. */
function FieldSettings({ f, onChange }: { f: FieldDraft; onChange: (patch: Partial<FieldDraft>) => void }) {
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(",", ".")));
  const seg = "min-h-9 flex-1 rounded-full px-3 text-sm font-medium text-ink-muted aria-checked:bg-accent-soft aria-checked:text-accent disabled:opacity-50";
  switch (f.type) {
    case "number":
      return (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-medium">
            Unit
            <input value={f.unit ?? ""} maxLength={8} disabled={f.saved} placeholder="kg, mm, s…" onChange={(e) => onChange({ unit: e.target.value })} className={`${input} mt-1`} />
          </label>
          <label className="text-sm font-medium">
            Decimals
            <select value={f.decimals ?? 0} onChange={(e) => onChange({ decimals: Number(e.target.value) })} className={`${input} mt-1`}>
              {[0, 1, 2].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Lowest
            <input inputMode="decimal" defaultValue={f.min ?? ""} onChange={(e) => onChange({ min: num(e.target.value) })} className={`${input} mt-1`} />
          </label>
          <label className="text-sm font-medium">
            Highest
            <input inputMode="decimal" defaultValue={f.max ?? ""} onChange={(e) => onChange({ max: num(e.target.value) })} className={`${input} mt-1`} />
          </label>
        </div>
      );
    case "select":
      return (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className={small}>Options</legend>
          {(f.options ?? []).map((o, i) =>
            o.archived ? null : (
              <div key={i} className="flex items-center gap-1">
                <input
                  aria-label={`Option ${i + 1}`}
                  value={o.label}
                  maxLength={40}
                  onChange={(e) => onChange({ options: f.options!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                  className={input}
                />
                <button
                  type="button"
                  aria-label={`Remove option ${o.label || i + 1}`}
                  disabled={(f.options ?? []).filter((x) => !x.archived).length <= 2}
                  // A saved option may be in logged values: archive it.
                  onClick={() =>
                    onChange({ options: o.value ? f.options!.map((x, j) => (j === i ? { ...x, archived: true } : x)) : f.options!.filter((_, j) => j !== i) })
                  }
                  className={iconButton}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            ),
          )}
          <button
            type="button"
            disabled={(f.options ?? []).filter((x) => !x.archived).length >= 12}
            onClick={() => onChange({ options: [...(f.options ?? []), { value: "", label: "" }] })}
            className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-accent disabled:opacity-40"
          >
            <PlusIcon size={16} /> Add option
          </button>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            Pick more than one
            <input type="checkbox" checked={Boolean(f.multiple)} disabled={f.saved} onChange={(e) => onChange({ multiple: e.target.checked })} className="size-5 accent-accent" />
          </label>
        </fieldset>
      );
    case "text":
      return (
        <label className="text-sm font-medium">
          Longest answer (characters)
          <input inputMode="numeric" defaultValue={f.max_length ?? 200} onChange={(e) => onChange({ max_length: num(e.target.value) })} className={`${input} mt-1`} />
        </label>
      );
    case "sets":
      return (
        <div className="flex flex-col gap-3">
          <div>
            <span className={small}>Each rep is</span>
            <div role="radiogroup" aria-label="Each rep is" className="flex rounded-full border border-control bg-surface p-1">
              {(["reps", "s"] as const).map((u) => (
                <button key={u} type="button" role="radio" aria-checked={f.reps_unit === u} disabled={f.saved} onClick={() => onChange({ reps_unit: u })} className={seg}>
                  {u === "reps" ? "Reps" : "Seconds"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className={small}>Load</span>
            <div role="radiogroup" aria-label="Load" className="flex rounded-full border border-control bg-surface p-1">
              {(["kg", "lb", null] as const).map((u) => (
                <button key={String(u)} type="button" role="radio" aria-checked={f.load_unit === u} disabled={f.saved} onClick={() => onChange({ load_unit: u })} className={seg}>
                  {u ?? "None"}
                </button>
              ))}
            </div>
          </div>
          {f.load_unit && (
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              Allow negative load (assisted)
              <input type="checkbox" checked={Boolean(f.load_signed)} onChange={(e) => onChange({ load_signed: e.target.checked })} className="size-5 accent-accent" />
            </label>
          )}
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className={small}>Extra columns (up to 2)</legend>
            {(f.extras ?? []).map((c, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-1">
                <input aria-label={`Column ${i + 1} name`} value={c.label} placeholder="Edge" onChange={(e) => onChange({ extras: f.extras!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className={input} />
                <input
                  aria-label={`Column ${i + 1} unit`}
                  value={c.unit ?? ""}
                  placeholder="mm"
                  disabled={Boolean(c.key)}
                  maxLength={8}
                  onChange={(e) => onChange({ extras: f.extras!.map((x, j) => (j === i ? { ...x, unit: e.target.value || undefined } : x)) })}
                  className={input}
                />
                <button
                  type="button"
                  aria-label={`Remove column ${c.label || i + 1}`}
                  disabled={Boolean(c.key) && f.saved}
                  onClick={() => onChange({ extras: f.extras!.filter((_, j) => j !== i) })}
                  className={iconButton}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            ))}
            {(f.extras ?? []).length < 2 && (
              <button
                type="button"
                onClick={() => onChange({ extras: [...(f.extras ?? []), { key: "", label: "" }] })}
                className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-accent"
              >
                <PlusIcon size={16} /> Add column
              </button>
            )}
          </fieldset>
        </div>
      );
    case "climbs":
      return <p className="text-sm text-ink-muted">Grade chips with your gyms, as in the built-in Climb form.</p>;
    default:
      return null;
  }
}
