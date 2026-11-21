"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DateInput } from "@/components/date-input";
import { climbLabel, GradeDot, triesWord } from "@/components/grade";
import { BoltIcon, CheckIcon, ChevronIcon, CloseIcon, PinIcon, PlusIcon, SportBadge } from "@/components/icons";
import { Button, HIT_AREA_Y } from "@/components/states";
import {
  ApiError,
  climbInput,
  FONT_GRADES,
  getGyms,
  getTemplates,
  GRADES,
  V_GRADES,
  type Template,
  type Climb,
  type Grade,
  type GradeSystem,
  type Gym,
  type Session,
  TAG_LABELS,
  TAGS,
  type SessionInput,
  type Sport,
  type Tag,
} from "@/lib/api";
import { SENSITIVE } from "@/lib/discreet";
import { climbOutcome, formatPace } from "@/lib/format";
import { checkValues, cleanValues } from "@/lib/form-values";
import { activeColours, startGym } from "@/lib/grades";
import { TemplateFields, type FormValues } from "./template-fields";

type Style = Climb["style"];
type FormClimb = {
  grade: Grade;
  style: Style;
  sent: boolean;
  attempts: number | null;
  /** Unset for a "My gym" colour picked before the gyms loaded. */
  grade_system?: GradeSystem;
  gym_id?: number | null;
  colour?: string | null;
};

const STYLES: { value: Style; label: string }[] = [
  { value: "boulder", label: "Boulder" },
  { value: "kilter", label: "Kilter" },
  { value: "rope", label: "Rope" },
];
const SPORTS: { value: Sport; label: string }[] = [
  { value: "running", label: "Run" },
  { value: "climbing", label: "Climb" },
  // Built-in forms with the core fields only; templates shape them (#100, #101).
  { value: "strength", label: "Strength" },
  { value: "other", label: "Other" },
];

export const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local

const noSubscribe = () => () => {};

/** Today's date, read only in the browser. The server and the prerender see
 *  "" so the date is never frozen into the page at build time (with
 *  cacheComponents, reading the clock during a prerender is an error). */
function useToday(): string {
  return useSyncExternalStore(noSubscribe, today, () => "");
}

/** Tapping a climb row: not sent -> sent -> flash -> not sent. A flash is a
 *  send in one attempt, the same rule the backend and the chips use. */
export function nextOutcome(c: FormClimb): FormClimb {
  switch (climbOutcome(c)) {
    case "tried":
      // A send that isn't a flash took at least 2 attempts (1 would be a flash), so
      // the count starts there instead of going blank (#111: it showed "–", and −
      // then made it a flash).
      return {
        ...c,
        sent: true,
        attempts: c.attempts && c.attempts > 1 ? c.attempts : 2,
      };
    case "sent":
      return { ...c, sent: true, attempts: 1 };
    case "flash":
      return { ...c, sent: false, attempts: 1 };
  }
}

// block + min-w-0: a field never grows past its grid cell (iOS date inputs did).
const field =
  "block min-h-11 w-full min-w-0 rounded-md border border-control bg-surface px-3 text-base text-ink tabular-nums";
const label = "mb-1 block text-sm font-medium";
const tile =
  "flex min-h-14 min-w-0 items-center gap-3 rounded-md border border-control bg-surface px-3 text-left font-medium aria-checked:border-accent aria-checked:bg-accent-soft";
/** Two equal columns that can shrink below their content's width. */
const pair = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3";

/** The Log form. Without `session` it logs a new one; with `session` and
 *  `editing` it edits that session; with `session` alone it starts as a copy
 *  of it dated today ("repeat last session"). */
export function SessionForm({
  session,
  editing = false,
  keepDate = false,
  onSubmit,
  onCancel,
}: {
  session?: Session;
  editing?: boolean;
  /** Prefill the date from `session` too (a chat draft), instead of today. */
  keepDate?: boolean;
  onSubmit: (input: SessionInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [sport, setSport] = useState<Sport | null>(session?.sport ?? null);
  const todayIso = useToday();
  // null means "today", resolved after mount; editing (and a reviewed chat draft,
  // `keepDate`) keeps the session's own date.
  const [pickedDate, setDate] = useState<string | null>((editing || keepDate) && session ? session.date : null);
  const date = pickedDate ?? todayIso;
  // A planned session's target may have no duration (#132): the field starts empty.
  const [duration, setDuration] = useState(session?.duration_min != null ? String(session.duration_min) : "");
  const [distance, setDistance] = useState(session?.distance_km ? String(session.distance_km) : "");
  const [elevation, setElevation] = useState(session?.elevation_m != null ? String(session.elevation_m) : "");
  const [effort, setEffort] = useState(session?.effort ?? 5);
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [tags, setTags] = useState<Tag[]>(session?.tags ?? []);
  const [style, setStyle] = useState<Style>(session?.climbs?.[0]?.style ?? "boulder");
  const [climbs, setClimbs] = useState<FormClimb[]>(
    (session?.climbs ?? []).map(({ grade, style, sent, attempts, grade_system, gym_id, colour }) => ({
      grade,
      style,
      sent,
      // A send with no count (a coach draft, or a repeated old session) starts at
      // 2 like a tapped one, instead of "–" (#123). An edit keeps what was saved.
      attempts: attempts ?? (sent && !editing ? 2 : null),
      grade_system,
      gym_id,
      colour,
    })),
  );
  // Templates (#101): picked as tiles next to the sports (T4 variant A). An
  // edit starts with the session's own template, archived or not.
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(session?.template_id ?? null);
  const [values, setValues] = useState<FormValues>(session?.custom_values ?? {});
  const [moreTemplates, setMoreTemplates] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    getTemplates(ctrl.signal)
      .then((r) => setTemplates(r.templates))
      .catch(() => {}); // without templates the form is the built-in one, as before
    return () => ctrl.abort();
  }, []);
  const template = templates.find((t) => t.id === templateId) ?? null;
  const picker = templates.filter((t) => !t.archived || t.id === templateId);
  const shownPicker = moreTemplates ? picker : picker.slice(0, 4);
  const valueProblem = template
    ? checkValues(template, cleanValues(values), session?.template_id === template.id ? session.custom_values : {})
    : null;
  const core = (name: "distance_km" | "elevation_m") => !templateId || (template?.core_fields.includes(name) ?? false);
  const climbsShown =
    sport === "climbing" && (!templateId || (template?.fields.some((f) => f.type === "climbs") ?? false));

  // Gyms (#99): the gym starts as the session's own, else the last one used.
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [gymId, setGymId] = useState<number | null>(null);
  const [outdoors, setOutdoors] = useState(false);
  const firstSystem = session?.climbs?.find((c) => c.grade_system)?.grade_system ?? "gym";
  const [system, setSystem] = useState<GradeSystem>(firstSystem);
  useEffect(() => {
    if (sport !== "climbing" || gyms.length) return;
    const ctrl = new AbortController();
    getGyms(ctrl.signal)
      .then(({ gyms: all, last_gym_id }) => {
        const live = all.filter((g) => !g.archived);
        setGyms(live);
        setGymId(startGym(live, last_gym_id, session?.climbs)?.id ?? null);
        if (live.length && firstSystem !== "gym" && !session?.climbs?.some((c) => c.gym_id != null)) {
          setOutdoors(true);
        }
      })
      .catch(() => {}); // without gyms the form offers My gym's colours, as before
    return () => ctrl.abort();
  }, [sport, gyms.length, session?.climbs, firstSystem]);
  const gym = gyms.find((g) => g.id === gymId) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutes = Number(duration);
  const km = Number(distance.replace(",", "."));
  const durationOk = Number.isInteger(minutes) && minutes > 0;
  const distanceOk = distance === "" || km > 0;
  const metres = Number(elevation);
  const elevationOk = elevation === "" || (Number.isInteger(metres) && metres >= 0);
  const valid =
    sport !== null &&
    date !== "" &&
    durationOk &&
    distanceOk &&
    (sport !== "running" || elevationOk) &&
    (templateId === null || (template !== null && valueProblem === null));
  const pace = sport === "running" && durationOk && km > 0 ? formatPace(minutes / km) : null;

  const updateClimb = (i: number, f: (c: FormClimb) => FormClimb) =>
    setClimbs((cs) => cs.map((c, j) => (j === i ? f(c) : c)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !sport) return;
    const input: SessionInput = {
      sport,
      date,
      duration_min: minutes,
      effort,
      notes: notes.trim() || null,
    };
    if (sport === "running" && distance !== "" && core("distance_km")) input.distance_km = km;
    // A chat draft's elevation survives "Review in Log form" (#84).
    if (sport === "running" && elevation !== "" && core("elevation_m")) input.elevation_m = metres;
    if (climbsShown) input.climbs = climbs.map(climbInput);
    if (template) {
      input.template_id = template.id;
      input.values = cleanValues(values);
    } else if (session?.template_id != null) {
      input.template_id = null; // an edit back to the built-in form
    }
    // Only when used: [] is sent to clear tags a session already had.
    if (tags.length || session?.tags?.length) input.tags = tags;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(input);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the session.");
      setBusy(false);
    }
  }

  const climbsField = (
    <ClimbsField
      style={style}
      onStyle={setStyle}
      climbs={climbs}
      onAdd={({ grade, colour }) =>
        setClimbs((cs) => [
          ...cs,
          {
            grade,
            style,
            sent: false,
            attempts: 1,
            colour,
            // Before the gyms load, a colour goes to the backend's default gym.
            ...(system !== "gym" || gym
              ? {
                  grade_system: system,
                  gym_id: outdoors ? null : (gym?.id ?? null),
                }
              : {}),
          },
        ])
      }
      gyms={gyms}
      gym={gym}
      system={system}
      outdoors={outdoors}
      onGym={(g) => {
        setOutdoors(g === null);
        if (g) setGymId(g.id);
        if (g === null && system === "gym") setSystem("v");
        if (g !== null) setSystem("gym");
      }}
      onSystem={setSystem}
      onCycle={(i) => updateClimb(i, nextOutcome)}
      onAttempts={(i, delta) =>
        updateClimb(i, (c) => ({
          ...c,
          // A send keeps at least 2 attempts: − never turns it into a flash silently.
          attempts: Math.max(climbOutcome(c) === "sent" ? 2 : 1, (c.attempts ?? (c.sent ? 2 : 1)) + delta),
        }))
      }
      onRemove={(i) => setClimbs((cs) => cs.filter((_, j) => j !== i))}
    />
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <fieldset className="min-w-0">
        <legend className={label}>What did you do?</legend>
        <div role="radiogroup" aria-label="Sport" className="grid grid-cols-2 gap-2">
          {SPORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={sport === s.value && templateId === null}
              onClick={() => {
                setSport(s.value);
                setTemplateId(null);
              }}
              className={tile}
            >
              <SportBadge sport={s.value} size="sm" />
              {s.label}
            </button>
          ))}
          {shownPicker.map((t) => (
            <button
              key={`t${t.id}`}
              type="button"
              role="radio"
              aria-checked={templateId === t.id}
              onClick={() => {
                setSport(t.sport);
                if (templateId !== t.id) setValues(session?.template_id === t.id ? (session.custom_values ?? {}) : {});
                setTemplateId(t.id);
              }}
              className={tile}
            >
              <SportBadge sport={t.sport} size="sm" />
              <span className="min-w-0 truncate">{t.name}</span>
            </button>
          ))}
          {picker.length > 4 && (
            <button
              type="button"
              onClick={() => setMoreTemplates((m) => !m)}
              aria-expanded={moreTemplates}
              className={`${tile} text-ink-muted`}
            >
              {moreTemplates ? "Fewer" : `More (${picker.length - 4})`}
            </button>
          )}
        </div>
        {templates.length === 0 && (
          <p className="mt-2 text-sm text-ink-muted">
            Want your own fields?{" "}
            <Link href="/templates" className="font-medium text-accent underline-offset-2 hover:underline">
              Make a log form
            </Link>
          </p>
        )}
      </fieldset>

      {sport && (
        <>
          <div className={pair}>
            <div>
              <label htmlFor="date" className={label}>
                Date
              </label>
              <DateInput id="date" value={date} max={todayIso || undefined} onChange={setDate} />
            </div>
            <div>
              <label htmlFor="duration" className={label}>
                Duration (min)
              </label>
              <input
                id="duration"
                type="number"
                inputMode="numeric"
                min={1}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className={field}
              />
            </div>
          </div>

          {sport === "running" && (core("distance_km") || core("elevation_m")) && (
            <div className={pair}>
              {core("distance_km") && (
                <>
                  <div>
                    <label htmlFor="distance" className={label}>
                      Distance (km)
                    </label>
                    <input
                      id="distance"
                      type="text"
                      inputMode="decimal"
                      value={distance}
                      onChange={(e) => setDistance(e.target.value)}
                      aria-invalid={!distanceOk}
                      className={field}
                    />
                  </div>
                  <div>
                    <span className={label} id="pace-label">
                      Pace
                    </span>
                    <output
                      aria-labelledby="pace-label"
                      aria-live="polite"
                      className="flex min-h-11 items-center font-display text-lg font-semibold tabular-nums"
                    >
                      {pace ? `${pace} /km` : "–"}
                    </output>
                  </div>
                </>
              )}
              {core("elevation_m") && (
                <div>
                  <label htmlFor="elevation" className={label}>
                    Elevation gain (m) <span className="font-normal text-ink-muted">(optional)</span>
                  </label>
                  <input
                    id="elevation"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={elevation}
                    onChange={(e) => setElevation(e.target.value)}
                    aria-invalid={!elevationOk}
                    className={field}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label htmlFor="effort" className={`${label} flex justify-between`}>
              <span>Effort</span>
              <span className="tabular-nums text-ink-muted">{effort} / 10</span>
            </label>
            <input
              id="effort"
              type="range"
              min={1}
              max={10}
              step={1}
              value={effort}
              onChange={(e) => setEffort(Number(e.target.value))}
              className="h-11 w-full accent-accent"
            />
            <div className="flex justify-between text-xs text-ink-muted" aria-hidden="true">
              <span>Very easy</span>
              <span>Max</span>
            </div>
          </div>

          {template ? (
            <>
              <TemplateFields
                template={template}
                values={values}
                onChange={(key, v) => setValues((vs) => ({ ...vs, [key]: v }))}
                climbs={climbsShown ? climbsField : null}
              />
              {valueProblem && (
                <p role="status" className="text-sm text-ink-muted">
                  {valueProblem}
                </p>
              )}
            </>
          ) : (
            climbsShown && climbsField
          )}

          <TagsField
            tags={tags}
            onToggle={(t) =>
              setTags((ts) =>
                ts.includes(t) ? ts.filter((x) => x !== t) : TAGS.filter((x) => x === t || ts.includes(x)),
              )
            }
          />

          <div>
            <label htmlFor="notes" className={label}>
              Notes
            </label>
            <textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${field} py-2`}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={!valid || busy} className="flex-1">
              {busy ? "Saving…" : editing ? "Save changes" : "Log session"}
            </Button>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </>
      )}
    </form>
  );
}

/** "How did it feel?": optional context tags (N6), off by default, one tap each. */
function TagsField({ tags, onToggle }: { tags: Tag[]; onToggle: (t: Tag) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium">
        How did it feel? <span className="font-normal text-ink-muted">(optional)</span>
      </legend>
      <div className="flex flex-wrap gap-2" role="group" aria-label="How did it feel?">
        {TAGS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tags.includes(t)}
            onClick={() => onToggle(t)}
            className="inline-flex min-h-11 items-center rounded-full border border-control bg-surface px-3.5 text-sm font-medium text-ink transition aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
          >
            {TAG_LABELS[t]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** The grade chips to add a climb: the gym's colours with their approximate
 *  range, or the V or Font scale. Before the gyms load (or without any),
 *  "My gym"'s colours; the backend then uses the last gym or makes My gym. */
function gradeChoices(system: GradeSystem, gym: Gym | null): GradeChoice[] {
  if (system === "v") return V_GRADES.map((g) => ({ grade: g, colour: null, range: null }));
  if (system === "font") return FONT_GRADES.map((g) => ({ grade: g, colour: null, range: null }));
  if (!gym) return GRADES.map((g) => ({ grade: g, colour: null, range: null }));
  return activeColours(gym).map((c) => ({
    grade: c.name,
    colour: c.colour,
    range: c.range_text ?? null,
  }));
}

type GradeChoice = {
  grade: Grade;
  colour: string | null;
  range: string | null;
};

const SYSTEMS: { value: GradeSystem; label: string }[] = [
  { value: "gym", label: "Gym colours" },
  { value: "v", label: "V-scale" },
  { value: "font", label: "Font" },
];

/** Where did you climb? A button with the gym's name (G1 variant A in
 *  docs/custom-log-forms.md) that opens a sheet with the gyms and "Outdoors". */
function GymPicker({
  gyms,
  gym,
  outdoors,
  onPick,
}: {
  gyms: Gym[];
  gym: Gym | null;
  outdoors: boolean;
  onPick: (gym: Gym | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  const option = "flex min-h-14 w-full items-center gap-3 px-1 text-left";
  return (
    <div>
      <span className={label} id="gym-label">
        Gym
      </span>
      <button
        type="button"
        aria-labelledby="gym-label"
        aria-haspopup="dialog"
        onClick={() => ref.current?.showModal()}
        className={`${field} flex items-center gap-2 text-left`}
      >
        <PinIcon size={18} className="shrink-0 text-climb" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {outdoors ? "Outdoors or a board" : (gym?.name ?? "My gym")}
        </span>
        <ChevronIcon size={16} className="shrink-0 rotate-90 text-ink-muted" />
      </button>
      <dialog
        ref={ref}
        aria-labelledby="gym-sheet-title"
        onClick={(e) => e.target === ref.current && close()}
        className="m-0 mt-auto max-h-[80dvh] w-full max-w-none overflow-y-auto rounded-t-lg bg-elevated px-4 pt-3 pb-6 text-ink shadow-sheet backdrop:bg-ink/40 sm:m-auto sm:max-w-md sm:rounded-lg"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 id="gym-sheet-title" className="font-display text-lg font-semibold">
            Where did you climb?
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-11 place-items-center rounded-full hover:bg-sunken"
          >
            <CloseIcon size={16} />
          </button>
        </div>
        <ul className="divide-y divide-line">
          {gyms.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                aria-pressed={!outdoors && gym?.id === g.id}
                onClick={() => {
                  onPick(g);
                  close();
                }}
                className={option}
              >
                <PinIcon size={18} className="shrink-0 text-climb" />
                <span className="flex-1">
                  <span className="block font-medium">{g.name}</span>
                  <span className="flex items-center gap-1 text-xs text-ink-muted">
                    {activeColours(g).map((c) => (
                      <GradeDot key={c.name} grade={c.name} colour={c.colour} size={8} />
                    ))}
                    <span className="ml-1">{activeColours(g).length} colours</span>
                  </span>
                </span>
                {!outdoors && gym?.id === g.id && <CheckIcon size={16} className="text-accent" />}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              aria-pressed={outdoors}
              onClick={() => {
                onPick(null);
                close();
              }}
              className={option}
            >
              <span className="flex-1">
                <span className="block font-medium">Outdoors or a board</span>
                <span className="block text-xs text-ink-muted">V or Font grades, no gym</span>
              </span>
              {outdoors && <CheckIcon size={16} className="text-accent" />}
            </button>
          </li>
          <li>
            <Link href="/gyms" className={`${option} font-medium text-accent`}>
              <PlusIcon size={18} /> Add or edit gyms
            </Link>
          </li>
        </ul>
      </dialog>
    </div>
  );
}

function ClimbsField({
  style,
  onStyle,
  climbs,
  onAdd,
  onCycle,
  onAttempts,
  onRemove,
  gyms,
  gym,
  system,
  outdoors,
  onGym,
  onSystem,
}: {
  style: Style;
  onStyle: (s: Style) => void;
  climbs: FormClimb[];
  onAdd: (choice: GradeChoice) => void;
  onCycle: (i: number) => void;
  onAttempts: (i: number, delta: number) => void;
  onRemove: (i: number) => void;
  gyms: Gym[];
  gym: Gym | null;
  system: GradeSystem;
  outdoors: boolean;
  onGym: (gym: Gym | null) => void;
  onSystem: (s: GradeSystem) => void;
}) {
  const choices = gradeChoices(system, gym);
  return (
    // min-w-0: a fieldset's default min width is its content's, so a long row inside
    // (the gym button, grade chips) would widen the whole page (#110).
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className={label}>Climbs</legend>
      {gyms.length > 0 && <GymPicker gyms={gyms} gym={gym} outdoors={outdoors} onPick={onGym} />}
      <div role="radiogroup" aria-label="Grades" className="flex rounded-full border border-control bg-surface p-1">
        {SYSTEMS.filter((s) => !(outdoors && s.value === "gym")).map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={system === s.value}
            onClick={() => onSystem(s.value)}
            // min-w-0 + truncate: the three tabs share the pill's width and never push past it (#110).
            className={`min-h-9 min-w-0 flex-1 truncate rounded-full px-2 text-sm font-medium text-ink-muted aria-checked:bg-accent-soft aria-checked:text-accent ${HIT_AREA_Y}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div
        role="radiogroup"
        aria-label="Default style"
        className="inline-flex self-start rounded-full border border-control bg-surface p-1"
      >
        {STYLES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={style === s.value}
            onClick={() => onStyle(s.value)}
            className={`min-h-9 rounded-full px-4 text-sm font-medium text-ink-muted aria-checked:bg-accent-soft aria-checked:text-accent ${HIT_AREA_Y}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div
        // Every grade system wraps onto several rows; V and Font used to sit in one
        // long row, which (inside a fieldset) widened the page (#110).
        className="flex flex-wrap gap-2"
        aria-label="Tap a grade to add a climb"
        role="group"
      >
        {choices.map((c) => (
          <button
            key={c.grade}
            type="button"
            onClick={() => onAdd(c)}
            aria-label={`Add ${c.grade}${c.range ? `, about ${c.range}` : ""}`}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-control bg-sunken px-3 text-sm font-medium capitalize"
          >
            <GradeDot grade={c.grade} colour={c.colour} size={12} />
            {c.grade}
            {c.range && (
              <span {...SENSITIVE} className="text-xs font-normal text-ink-muted normal-case">
                {c.range}
              </span>
            )}
          </button>
        ))}
      </div>

      {climbs.length > 0 ? (
        <ul className="divide-y divide-line rounded-md border border-line" aria-label="Logged climbs">
          {climbs.map((c, i) => {
            const outcome = climbOutcome(c);
            return (
              <li key={i} className="flex items-center gap-1 pl-3">
                <button
                  type="button"
                  onClick={() => onCycle(i)}
                  aria-label={`${climbLabel(c)}. Tap to change.`}
                  className="flex min-h-11 flex-1 items-center gap-3 text-left"
                >
                  <GradeDot grade={c.grade} colour={c.colour} size={14} />
                  <span className="flex-1 text-sm font-medium capitalize">{c.grade}</span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      outcome === "tried" ? "text-ink-muted" : "text-accent"
                    }`}
                  >
                    {outcome === "flash" && <BoltIcon size={12} />}
                    {outcome === "sent" && <CheckIcon size={12} />}
                    {outcome === "flash" ? "Flash" : outcome === "sent" ? "Sent" : "Not sent"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onAttempts(i, -1)}
                  aria-label={`Fewer tries on ${c.grade}`}
                  className="grid size-11 place-items-center rounded-full text-lg hover:bg-sunken"
                >
                  −
                </button>
                {/* The unit sits under the number, so the counter can't be read as a grade
                    or a set count, and the row stays one line at 375 px. <output> also
                    announces the new count after − or +. */}
                <output
                  aria-label={c.attempts == null ? "Tries not set" : `${c.attempts} ${triesWord(c.attempts)}`}
                  className="flex w-6 flex-col items-center leading-none"
                >
                  <span aria-hidden="true" className="text-sm tabular-nums">
                    {c.attempts ?? "–"}
                  </span>
                  <span aria-hidden="true" className="mt-0.5 text-[10px] text-ink-muted">
                    {triesWord(c.attempts)}
                  </span>
                </output>
                <button
                  type="button"
                  onClick={() => onAttempts(i, 1)}
                  aria-label={`More tries on ${c.grade}`}
                  className="grid size-11 place-items-center rounded-full text-lg hover:bg-sunken"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label={`Remove ${c.grade}`}
                  className="grid size-11 place-items-center rounded-full text-ink-muted hover:bg-sunken"
                >
                  <CloseIcon size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">Tap a grade to add a climb.</p>
      )}
    </fieldset>
  );
}
