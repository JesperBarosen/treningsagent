"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GradeDot } from "@/components/grade";
import { ArrowDownIcon, ArrowUpIcon, ChevronIcon, CloseIcon, PinIcon, PlusIcon } from "@/components/icons";
import { Button, EmptyState, ErrorState, Skeleton } from "@/components/states";
import {
  ApiError,
  createGym,
  FONT_GRADES,
  getGyms,
  PALETTE,
  updateGym,
  V_GRADES,
  type Gym,
  type GymColour,
  type GymInput,
} from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { activeColours } from "@/lib/grades";

// Gyms and their colour circuits (#99, docs/custom-log-forms.md 6.5, mockup 5).
// Colours easiest first, moved with up and down buttons; each has a swatch from
// the screen-safe palette and an approximate range as two selects (G2 variant A).
// A used colour or gym is archived, never deleted, so old climbs keep their name.

type Draft = GymInput & { id: number | null; archived: boolean };

const field = "block min-h-11 w-full min-w-0 rounded-md border border-control bg-surface px-3 text-base text-ink";
const iconButton = "grid size-11 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-sunken disabled:opacity-30";

function emptyDraft(): Draft {
  return {
    id: null,
    archived: false,
    name: "",
    range_system: "v",
    colours: [{ id: null, name: "", colour: PALETTE[1].hex, range: null, archived: false }],
  };
}

function toDraft(g: Gym): Draft {
  return {
    id: g.id,
    archived: g.archived,
    name: g.name,
    range_system: g.range_system,
    colours: g.colours.map(({ id, name, colour, range, archived }) => ({ id, name, colour, range, archived })),
  };
}

export function GymsView() {
  const [gyms, setGyms] = useState<Gym[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    getGyms(signal)
      .then((r) => {
        setGyms(r.gyms);
        setError(null);
      })
      .catch((e) => {
        if (!signal?.aborted) setError(e instanceof ApiError ? e.message : "Couldn't load your gyms.");
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  if (draft) {
    return (
      <GymEditor
        draft={draft}
        onCancel={() => setDraft(null)}
        onSaved={() => {
          setDraft(null);
          load();
        }}
      />
    );
  }

  const live = gyms?.filter((g) => !g.archived) ?? [];
  const archived = gyms?.filter((g) => g.archived) ?? [];
  return (
    <div className="pt-4 pb-12">
      <Link href="/you" className="inline-flex min-h-11 items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ChevronIcon size={14} className="rotate-180" /> You
      </Link>
      <h1 className="font-display text-xl font-semibold">Gyms</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Each gym&apos;s colours, easiest first, with an approximate V or Font range so climbs compare across gyms.
      </p>
      <Button className="mt-4 w-full" onClick={() => setDraft(emptyDraft())}>
        <PlusIcon size={18} /> Add gym
      </Button>
      {error && <ErrorState offline={false} message={error} onRetry={() => load()} />}
      {!gyms && !error && <Skeleton className="mt-4 h-32" />}
      {gyms && live.length === 0 && (
        <EmptyState icon={<PinIcon size={26} />} title="No gyms yet">
          Your first climbing session makes My gym. Or add the gym you climb at now.
        </EmptyState>
      )}
      {live.length > 0 && <GymList gyms={live} onOpen={(g) => setDraft(toDraft(g))} />}
      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-muted">
            Archived ({archived.length})
          </summary>
          <GymList gyms={archived} onOpen={(g) => setDraft(toDraft(g))} />
        </details>
      )}
    </div>
  );
}

function GymList({ gyms, onOpen }: { gyms: Gym[]; onOpen: (g: Gym) => void }) {
  return (
    <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
      {gyms.map((g) => (
        <li key={g.id}>
          <button type="button" onClick={() => onOpen(g)} className="flex min-h-16 w-full items-center gap-3 px-4 text-left hover:bg-sunken">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-climb-soft text-climb">
              <PinIcon size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{g.name}</span>
              <span className="flex items-center gap-1 text-xs text-ink-muted">
                {activeColours(g).map((c) => (
                  <GradeDot key={c.name} grade={c.name} colour={c.colour} size={10} />
                ))}
                <span className="ml-1">{activeColours(g).length} colours</span>
              </span>
            </span>
            <ChevronIcon size={18} className="text-ink-muted" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function GymEditor({ draft: start, onCancel, onSaved }: { draft: Draft; onCancel: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scale = draft.range_system === "v" ? V_GRADES : FONT_GRADES;
  const active = draft.colours.filter((c) => !c.archived);
  const archived = draft.colours.filter((c) => c.archived);
  const valid = draft.name.trim() !== "" && active.length > 0 && active.every((c) => c.name.trim() !== "");

  const setColours = (f: (cs: GymColour[]) => GymColour[]) =>
    setDraft((d) => ({ ...d, colours: [...f(d.colours.filter((c) => !c.archived)), ...d.colours.filter((c) => c.archived)] }));
  const change = (i: number, patch: Partial<GymColour>) => setColours((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, by: number) =>
    setColours((cs) => {
      const out = [...cs];
      [out[i], out[i + by]] = [out[i + by], out[i]];
      return out;
    });
  // A colour that was saved may be used by climbs: archive it. A new one just goes.
  const remove = (i: number) =>
    setDraft((d) => {
      const live = d.colours.filter((c) => !c.archived);
      const gone = live[i];
      const rest = live.filter((_, j) => j !== i);
      const old = d.colours.filter((c) => c.archived);
      return { ...d, colours: [...rest, ...old, ...(gone.id ? [{ ...gone, archived: true }] : [])] };
    });

  async function save(extra?: { archived: boolean }) {
    setBusy(true);
    setError(null);
    const body: GymInput = {
      name: draft.name.trim(),
      range_system: draft.range_system,
      // New colours that were removed before saving have no id and are archived: drop them.
      colours: draft.colours
        .filter((c) => c.id !== null || !c.archived)
        .map((c) => ({ ...c, name: c.name.trim().toLowerCase() })),
    };
    try {
      if (draft.id === null) await createGym(body);
      else await updateGym(draft.id, { ...body, ...extra });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save the gym.");
      setBusy(false);
    }
  }

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
        <h1 className="font-display text-xl font-semibold">{draft.id === null ? "Add gym" : "Edit gym"}</h1>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div>
        <label htmlFor="gym-name" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <input id="gym-name" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium" id="range-label">
          Ranges in
        </span>
        <div role="radiogroup" aria-labelledby="range-label" className="inline-flex rounded-full border border-control bg-surface p-1">
          {(["v", "font"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={draft.range_system === s}
              // Ranges are stored as one index, so switching only changes the labels;
              // the backend converts saved ranges. Unsaved ones are cleared.
              onClick={() => setDraft({ ...draft, range_system: s, colours: draft.colours.map((c) => (c.id ? c : { ...c, range: null })) })}
              className="min-h-9 rounded-full px-4 text-sm font-medium text-ink-muted aria-checked:bg-accent-soft aria-checked:text-accent"
            >
              {s === "v" ? "V-scale" : "Font"}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Colours, easiest first</legend>
        {active.map((c, i) => (
          <div key={c.id ?? `new-${i}`} className="rounded-lg border border-line bg-surface p-2">
            <div className="flex items-center gap-1">
              <span className="w-5 shrink-0 text-center text-xs text-ink-muted tabular-nums">{i + 1}</span>
              <label className="sr-only" htmlFor={`swatch-${i}`}>
                Swatch for colour {i + 1}
              </label>
              <span className="relative grid size-11 shrink-0 place-items-center">
                <GradeDot grade={c.name} colour={c.colour} size={20} />
                <select
                  id={`swatch-${i}`}
                  value={c.colour}
                  onChange={(e) => {
                    const p = PALETTE.find((x) => x.hex === e.target.value);
                    change(i, { colour: e.target.value, name: c.name || p?.name || "" });
                  }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                >
                  {PALETTE.map((p) => (
                    <option key={p.hex} value={p.hex}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </span>
              <label className="sr-only" htmlFor={`colour-name-${i}`}>
                Name of colour {i + 1}
              </label>
              <input
                id={`colour-name-${i}`}
                value={c.name}
                maxLength={24}
                placeholder="Name"
                onChange={(e) => change(i, { name: e.target.value })}
                className={`${field} flex-1`}
              />
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${c.name || "colour"} up`} className={iconButton}>
                <ArrowUpIcon size={18} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === active.length - 1}
                aria-label={`Move ${c.name || "colour"} down`}
                className={iconButton}
              >
                <ArrowDownIcon size={18} />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 pl-6">
              <RangeSelect label={`Easiest grade for ${c.name || "this colour"}`} value={c.range?.[0] ?? ""} scale={scale}
                onChange={(v) => change(i, { range: v ? [v, c.range?.[1] && scale.indexOf(c.range[1]) >= scale.indexOf(v) ? c.range[1] : v] : null })} />
              <span className="text-ink-muted" aria-hidden="true">
                –
              </span>
              <RangeSelect label={`Hardest grade for ${c.name || "this colour"}`} value={c.range?.[1] ?? ""} scale={scale}
                onChange={(v) => change(i, { range: v ? [c.range?.[0] && scale.indexOf(c.range[0]) <= scale.indexOf(v) ? c.range[0] : v, v] : null })} />
              <button type="button" onClick={() => remove(i)} disabled={active.length === 1} aria-label={c.id ? `Archive ${c.name}` : `Remove ${c.name || "colour"}`} className={iconButton}>
                <CloseIcon size={16} />
              </button>
            </div>
          </div>
        ))}
        <Button
          variant="ghost"
          className="border border-dashed border-control text-accent"
          onClick={() => setColours((cs) => [...cs, { id: null, name: "", colour: PALETTE[0].hex, range: null, archived: false }])}
          disabled={active.length >= 20}
        >
          <PlusIcon size={18} /> Add colour
        </Button>
      </fieldset>

      {archived.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-ink-muted">
          {archived.map((c) => (
            <li key={c.id} className="flex min-h-11 items-center gap-2">
              <GradeDot grade={c.name} colour={c.colour} size={12} />
              <span className="flex-1 capitalize">{c.name} · archived</span>
              <button
                type="button"
                className="min-h-11 px-2 font-medium text-accent"
                onClick={() => setDraft((d) => ({ ...d, colours: d.colours.map((x) => (x === c ? { ...x, archived: false } : x)) }))}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-muted">
        Ranges are approximate. They let a blue here be compared with a blue at another gym, a V4 outdoors or a 6B on the board.
      </p>
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!valid || busy}>
        {busy ? "Saving…" : "Save gym"}
      </Button>
      {draft.id !== null && (
        <Button variant="ghost" onClick={() => save({ archived: !start.archived })} disabled={busy}>
          {start.archived ? "Restore gym" : "Archive gym"}
        </Button>
      )}
    </form>
  );
}

function RangeSelect({ label, value, scale, onChange }: { label: string; value: string; scale: string[]; onChange: (v: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`${field} flex-1 tabular-nums`} {...SENSITIVE}>
      <option value="">–</option>
      {scale.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  );
}
