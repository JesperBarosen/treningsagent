// Typed client for the FastAPI backend in backend/. Numbers such as load and
// pace come from the backend's tool functions; the frontend only formats them.

import { clearSavedChats } from "./chat-storage";
import { LIMITS, limitMessage, type LimitBody } from "./limits";
import { accessToken, supabaseBrowser } from "./supabase/client";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

/** "My gym"'s colours, easiest first: the scale everyone had before gyms (#98),
 *  and the fallback when the gyms haven't loaded. Each has a --color-grade-* token. */
export const GRADES = ["yellow", "green", "blue", "purple", "red", "black", "white"] as const;
export type LegacyGrade = (typeof GRADES)[number];
/** A grade as the user knows it: a gym colour ("blue"), "V4" or "6B+". */
export type Grade = string;
export type GradeSystem = "gym" | "v" | "font";
/** The built-in sports, in the fixed chart order (#100 adds strength and other). */
export const SPORTS = ["running", "climbing", "strength", "other"] as const;
export type Sport = (typeof SPORTS)[number];

/** V and Font grades, easiest first (backend grades.py). */
export const V_GRADES = ["VB", ...Array.from({ length: 18 }, (_, i) => `V${i}`)];
export const FONT_GRADES = [
  "4", "4+", "5", "5+", "6A", "6A+", "6B", "6B+", "6C", "6C+", "7A", "7A+",
  "7B", "7B+", "7C", "7C+", "8A", "8A+", "8B", "8B+", "8C", "8C+", "9A",
];

export type Climb = {
  grade: Grade;
  /** The colour's place in its gym (1 = easiest); null for V and Font. */
  grade_ordinal?: number | null;
  sent: boolean;
  style: "boulder" | "kilter" | "rope";
  attempts?: number | null;
  notes?: string | null;
  /** Absent on rows from before #98: a "My gym" colour. */
  grade_system?: GradeSystem;
  gym_id?: number | null;
  gym_grade_id?: number | null;
  /** The gym's name and the colour's swatch, as history returns them. */
  gym?: string;
  colour?: string;
};

// --- Session templates (#100, #101) -------------------------------------------------

export const FIELD_TYPES = ["number", "select", "boolean", "text", "sets", "climbs"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type SelectOption = { value: string; label: string; archived?: boolean };
export type ExtraColumn = { key: string; label: string; unit?: string; min?: number; max?: number; decimals?: number };

/** One field of a template's schema (docs/custom-log-forms.md 3.2). */
export type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  archived?: boolean;
  // number: one unit, or 1 to 4 measures with their own unit (#111)
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  measures?: Measure[];
  // select
  options?: SelectOption[];
  multiple?: boolean;
  // text
  max_length?: number;
  // sets
  reps_unit?: "reps" | "s";
  load_unit?: "kg" | "lb" | null;
  load_signed?: boolean;
  extras?: ExtraColumn[];
  // climbs
  default_style?: "boulder" | "kilter" | "rope";
};

/** One measure of a number field (#111): its name or unit ("kg", "reps", "s") and decimals. */
export type Measure = { key: string; label: string; decimals?: number };
/** A measures field's value: one number per measure that was filled in. */
export type MeasureValues = Record<string, number>;
/** The measure a plain number belongs to: a field made before measures keeps its old unit under this key. */
export const PLAIN_MEASURE = "value";

export type SetRow = { sets: number; reps: number; load?: number } & Record<string, number | undefined>;
export type TemplateValue = number | string | boolean | string[] | SetRow[] | MeasureValues;
export type TemplateValues = Record<string, TemplateValue>;
export type DescribedValue = {
  key: string;
  label: string;
  type: FieldType;
  value: TemplateValue;
  text: string;
  /** A number field with measures: the value is one number per measure. */
  measures?: Pick<Measure, "key" | "label">[];
};

export type Template = {
  id: number;
  name: string;
  sport: Sport;
  core_fields: ("distance_km" | "elevation_m")[];
  fields: TemplateField[];
  position: number;
  archived: boolean;
};

export type TemplateInput = Pick<Template, "name" | "sport" | "core_fields"> & {
  fields: (Omit<TemplateField, "key"> & { key?: string })[];
};

export function getTemplates(signal?: AbortSignal): Promise<{ templates: Template[]; starters: { name: string; sport: Sport }[] }> {
  return request("/templates", { signal });
}

export function createTemplate(input: TemplateInput): Promise<Template> {
  return request("/templates", { method: "POST", body: JSON.stringify(input) });
}

export function addStarters(names: string[]): Promise<Template[]> {
  return request("/templates/starters", { method: "POST", body: JSON.stringify({ names }) });
}

export function updateTemplate(
  id: number,
  change: Partial<TemplateInput> & { archived?: boolean; position?: number },
): Promise<Template> {
  return request(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(change) });
}

export function deleteTemplate(id: number): Promise<void> {
  return request(`/templates/${id}`, { method: "DELETE" });
}

// --- Gyms (#98, #99) --------------------------------------------------------------

export type GymColour = {
  id: number | null;
  name: string;
  colour: string; // a palette hex value
  /** [lowest, highest] in the gym's range_system, e.g. ["V1", "V3"]. */
  range: [string, string] | null;
  range_text?: string | null;
  archived: boolean;
};

export type Gym = {
  id: number;
  name: string;
  range_system: "v" | "font";
  archived: boolean;
  colours: GymColour[];
};

/** The swatches a gym colour may use (backend grades.PALETTE): the screen-safe grade colours. */
export const PALETTE: { name: LegacyGrade; hex: string }[] = [
  { name: "yellow", hex: "#f2c230" },
  { name: "green", hex: "#3fae5f" },
  { name: "blue", hex: "#2f6fd6" },
  { name: "purple", hex: "#9440b8" },
  { name: "red", hex: "#c0302f" },
  { name: "black", hex: "#1a1a1a" },
  { name: "white", hex: "#ffffff" },
];

export type GymInput = {
  name: string;
  range_system: "v" | "font";
  colours: Omit<GymColour, "range_text">[];
};

export function getGyms(signal?: AbortSignal): Promise<{ gyms: Gym[]; last_gym_id: number | null }> {
  return request("/gyms", { signal });
}

export function createGym(input: GymInput): Promise<Gym> {
  return request("/gyms", { method: "POST", body: JSON.stringify(input) });
}

/** PATCH /gyms/{id}: `colours`, when sent, is the whole new list. */
export function updateGym(id: number, change: Partial<GymInput> & { archived?: boolean }): Promise<Gym> {
  return request(`/gyms/${id}`, { method: "PATCH", body: JSON.stringify(change) });
}

export function deleteGym(id: number): Promise<void> {
  return request(`/gyms/${id}`, { method: "DELETE" });
}

/** Context tags (N6), in the backend's order (tools.TAGS). Optional, one tap each. */
export const TAGS = ["slept_badly", "sore", "tired", "felt_strong", "hot", "stressed"] as const;
export type Tag = (typeof TAGS)[number];
export const TAG_LABELS: Record<Tag, string> = {
  slept_badly: "Slept badly",
  sore: "Sore",
  tired: "Tired",
  felt_strong: "Felt strong",
  hot: "Hot",
  stressed: "Stressed",
};

/** A session as GET /sessions (get_history) or log_session returns it. */
export type Session = {
  id: number;
  sport: Sport;
  date: string; // YYYY-MM-DD
  duration_min: number;
  effort: number;
  notes?: string | null;
  distance_km?: number | null;
  elevation_m?: number | null;
  climbs?: Climb[];
  /** Context tags (N6); absent before the tags migration. */
  tags?: Tag[];
  /** A session template (#100): its id, name and values, and the values described. */
  template_id?: number | null;
  template?: string;
  custom_values?: TemplateValues;
  fields?: DescribedValue[];
  // Derived by the backend (get_history only).
  load?: number;
  pace_min_per_km?: number;
  climbs_sent?: number;
  hardest_sent_grade?: Grade;
};

/** A session the agent understood but didn't store (draft_session, N4): the
 *  user saves it with one tap or reviews it in the Log form. No id yet. */
export type Draft = Omit<Session, "id" | "load" | "pace_min_per_km" | "climbs_sent" | "hardest_sent_grade"> & {
  draft: true;
};

export type ChatResponse = {
  reply: string;
  history: unknown[];
  conversation_id: string;
  logged_sessions: Session[];
  drafts?: Draft[];
  /** Plans the coach proposed this turn (#119): never stored until Accept (Q5). */
  proposals?: PlanProposal[];
  /** Profile changes the coach proposed this turn (#137): stored only on Save. */
  profile_updates?: ProfileUpdate[];
};

// --- Training profile (#137) -------------------------------------------------------------

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type Injury = { body_part: string; pain: number | null; note: string | null };

/** What the user tells the app about themselves; every field optional. */
export type TrainingProfile = {
  longest_run_km: number | null;
  weekly_run_km: number | null;
  climbing_level: string | null;
  injuries: Injury[];
  sessions_per_week: number | null;
  preferred_days: Weekday[];
  other_sports: string | null;
  goals_note: string | null;
  /** The first-login step: null until shown, then done or skipped. */
  onboarding: "done" | "skipped" | null;
};

export type ProfileChanges = Partial<Omit<TrainingProfile, "onboarding">> & { onboarding?: "done" | "skipped" };

/** propose_profile_update's result: shown with Save and Dismiss, stored only on Save. */
export type ProfileUpdate = {
  profile_update: true;
  stored: false;
  changes: ProfileChanges;
  before: ProfileChanges;
};

export function getProfile(signal?: AbortSignal): Promise<TrainingProfile> {
  return request("/profile", { signal });
}

export function saveProfile(changes: ProfileChanges): Promise<TrainingProfile> {
  return request("/profile", { method: "PATCH", body: JSON.stringify(changes) });
}

// --- Training plans (#116, #118, #119) -------------------------------------------------

export type WeekKind = "build" | "deload" | "taper" | "test";
export type WeekMeta = { index: number; kind: WeekKind; note: string | null };

/** A planned session's target: every part optional (docs/training-plans.md 3). */
export type RunType = "easy" | "long" | "strides" | "intervals" | "tempo" | "recovery";

export type PlanTarget = {
  duration_min?: number;
  effort?: number;
  distance_km?: number;
  /** Running only (#135). */
  session_type?: RunType;
  /** The concrete content, e.g. "6 x 800 m at 10 km pace, 90 s jog rest" (#135). */
  workout?: string;
  grades?: { system: GradeSystem; grade: string; count: number; gym_id?: number }[];
  values?: TemplateValues;
};

/** Derived by the backend when read; nothing judgemental is stored (Q7). */
export type PlannedState = "done" | "today" | "upcoming" | "not_done" | "skipped" | "paused";

export type PlannedSession = {
  id: number | null;
  plan_id: number | null;
  date: string;
  slot: number;
  sport: Sport;
  template_id: number | null;
  title: string;
  target: PlanTarget;
  status: "planned" | "skipped";
  skip_reason: string | null;
  session_id: number | null;
  week: number | null;
  planned_load: number | null;
  state?: PlannedState;
  /** The logged session that did it, when done. */
  done?: { id: number; date: string; duration_min: number; effort: number; distance_km: number | null } | null;
};

export type PlanWeek = { index: number; kind: WeekKind; week_start: string; sessions: number; planned_load: number };

export type PlanStatus = "active" | "paused" | "finished" | "left";

export type Plan = {
  id: number;
  name: string;
  goal_id: number | null;
  start_date: string;
  end_date: string;
  weeks: number;
  week_meta: WeekMeta[];
  status: PlanStatus;
  ended_on: string | null;
  rationale: string | null;
  source: "coach" | "user";
  sessions: PlannedSession[];
  weekly: PlanWeek[];
  today?: string;
  current_week?: number | null;
};

/** What Accept sends back to POST /plans. */
export type PlanInput = {
  name: string;
  start_date: string;
  weeks: number;
  goal_id: number | null;
  week_meta: WeekMeta[];
  rationale: string | null;
  source: "coach" | "user";
  sessions: Pick<PlannedSession, "date" | "sport" | "template_id" | "title" | "target">[];
};

/** propose_program's result: shown as a card, stored only on Accept. */
export type PlanProposal = {
  proposal: true;
  stored: false;
  plan: Omit<Plan, "id" | "status" | "ended_on"> & { id: null; status: "proposed"; weekly_running_km?: number[] };
  accept: PlanInput;
  goal: Goal | null;
  rules_applied: string[];
  /** What the coach asked first (#135): frequency, days, pain, and the user's own words. */
  context?: { sessions_per_week: number; available_days: string[]; injury_or_pain: string; user_said: string[] };
  /** Per week: runs, quality sessions and the easy share of running km (L8, needs source). */
  intensity?: { week: number; runs: number; quality_sessions: number; easy_share: number | null }[];
};

export function getPlans(signal?: AbortSignal): Promise<{ current: Plan | null; plans: Omit<Plan, "sessions" | "weekly">[] }> {
  return request("/plans", { signal });
}

export function createPlan(input: PlanInput): Promise<Plan> {
  return request("/plans", { method: "POST", body: JSON.stringify(input) });
}

export function changePlan(id: number, change: { status?: "active" | "paused" | "finished"; name?: string }): Promise<Plan> {
  return request(`/plans/${id}`, { method: "PATCH", body: JSON.stringify(change) });
}

export function leavePlan(id: number): Promise<Plan> {
  return request(`/plans/${id}/leave`, { method: "POST" });
}

/** What the Log form or the Save button sends for a draft. */
export function draftInput(d: Draft): SessionInput {
  const input: SessionInput = {
    sport: d.sport,
    date: d.date,
    duration_min: d.duration_min,
    effort: d.effort,
    notes: d.notes ?? null,
  };
  if (d.sport === "running" && d.distance_km) input.distance_km = d.distance_km;
  if (d.sport === "running" && d.elevation_m != null) input.elevation_m = d.elevation_m;
  if (d.sport === "climbing" && d.climbs?.length) {
    input.climbs = d.climbs.map(climbInput);
  }
  if (d.tags?.length) input.tags = d.tags;
  if (d.template_id != null) {
    input.template_id = d.template_id;
    input.values = d.custom_values ?? {};
  }
  return input;
}

export class ApiError extends Error {
  constructor(
    message: string,
    /** null when the backend could not be reached at all. */
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** A usage limit stopped the request (#129, #130): `limit` says which, and
 *  lib/limits.ts has the words to show. The coach wasn't called. */
export class LimitError extends ApiError {
  constructor(
    readonly limit: LimitBody,
    status: number,
  ) {
    super(limitMessage(limit).text, status);
  }
}

function asLimit(body: unknown): LimitBody | null {
  const limit = (body as { limit?: unknown } | null)?.limit;
  return typeof limit === "string" && (LIMITS as readonly string[]).includes(limit) ? (body as LimitBody) : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Can't reach the backend.", null);
  }
  if (res.status === 401) {
    // The backend rejected the session. Drop it here too (otherwise /sign-in
    // would send us straight back), then reload on /sign-in so no state survives.
    clearSavedChats();
    await supabaseBrowser().auth.signOut({ scope: "local" });
    window.location.replace(`${window.location.origin}/sign-in`);
    throw new ApiError("Your session has ended. Sign in again.", 401);
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status}).`;
    let body: unknown = null;
    try {
      body = await res.json();
      const d = (body as { detail?: unknown })?.detail;
      if (typeof d === "string") detail = d;
    } catch {
      // keep the generic message
    }
    const limit = asLimit(body);
    if (limit?.limit === "closed_beta") {
      // Not invited (#130): no endpoint works, so show the closed-beta page.
      window.location.replace(`${window.location.origin}/closed-beta`);
    }
    if (limit) throw new LimitError(limit, res.status);
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** What the Log form sends. The backend checks it with log_session's rules. */
export type SessionInput = {
  sport: Sport;
  date: string;
  duration_min: number;
  effort: number;
  notes: string | null;
  distance_km?: number;
  /** Running only: elevation gain in whole metres (#84). */
  elevation_m?: number;
  climbs?: ClimbInput[];
  /** Context tags (N6); [] clears a session's tags on edit. */
  tags?: Tag[];
  /** A template (#100) and its values by field key; null on an edit drops the template. */
  template_id?: number | null;
  values?: TemplateValues;
};

/** A climb as the Log form sends it. Without gym_id a colour goes to the last gym used. */
export type ClimbInput = Pick<Climb, "grade" | "style" | "sent" | "attempts"> & {
  grade_system?: GradeSystem;
  gym_id?: number | null;
};

/** The fields of a stored or drafted climb that the backend takes back. */
export function climbInput(c: Climb | ClimbInput): ClimbInput {
  const out: ClimbInput = { grade: c.grade, style: c.style, sent: c.sent, attempts: c.attempts ?? null };
  if (c.grade_system) out.grade_system = c.grade_system;
  if (c.gym_id != null) out.gym_id = c.gym_id;
  return out;
}

export function createSession(input: SessionInput): Promise<Session> {
  return request("/sessions", { method: "POST", body: JSON.stringify(input) });
}

/** PATCH /sessions/{id}: `climbs`, when sent, replaces all the session's climbs. */
export function updateSession(id: number, input: SessionInput): Promise<Session> {
  return request(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteSession(id: number): Promise<void> {
  return request(`/sessions/${id}`, { method: "DELETE" });
}

export function sendChat(
  message: string,
  history: unknown[],
  conversationId: string | null,
  signal?: AbortSignal,
  autoSave = false,
): Promise<ChatResponse> {
  return request("/chat", {
    method: "POST",
    body: JSON.stringify({ message, history, conversation_id: conversationId, auto_save: autoSave }),
    signal,
  });
}

export function getSessions(days = 56, signal?: AbortSignal): Promise<Session[]> {
  return request(`/sessions?days=${days}`, { signal });
}

/** GET /training-load (tools.get_training_load). */
export type TrainingLoad = {
  daily: { date: string; load: number }[];
  weekly: {
    week_start: string;
    load: number;
    sessions: number;
    load_by_sport: Partial<Record<Sport, number>>;
  }[];
  acute_7d_avg: number;
  chronic_28d_avg: number;
  acute_chronic_ratio: number | null;
  /** "not_enough_data" under 28 days since the first logged session; "paused"
   *  while a pause is on (the ratio isn't interpreted then). */
  ratio_status: "ok" | "not_enough_data" | "paused";
  /** Days since the first logged session, today included. */
  history_days: number;
  /** Days of the last 28 a pause left out of both averages (N5). */
  paused_days?: number;
  /** The pause that is on now, if any. */
  pause?: Pause | null;
};

// --- Goals (N2) -------------------------------------------------------------------

export type GoalStatus = "active" | "paused" | "achieved" | "dropped";

type GoalBase = {
  id: number;
  target_date: string | null;
  status: GoalStatus;
  achieved_on: string | null;
  created_on: string;
  /** The date passed while the goal was still open: ask, never "failed". */
  overdue: boolean;
};

export type GradeGoal = GoalBase & {
  kind: "climb_grade";
  grade: Grade;
  climb_mode: "send" | "flash";
  grade_system?: GradeSystem;
  gym_id?: number | null;
  progress: {
    steps: number;
    of: number;
    best_grade: Grade | null;
    best_count_28d: number;
    reached_on: string | null;
    /** Where it was reached: any gym or outdoors counts when as hard (#98, Q4). */
    reached_with?: { grade: Grade; grade_system: GradeSystem; gym: string | null; about: string | null };
  };
};

export type PaceGoal = GoalBase & {
  kind: "run_pace";
  band: DistanceBand;
  target_pace: number;
  start_pace: number | null;
  progress: {
    start_pace: number | null;
    now_pace: number | null;
    target_pace: number;
    fraction: number | null;
    reached_on: string | null;
  };
};

export type Goal = GradeGoal | PaceGoal;

export type GoalInput =
  | {
      kind: "climb_grade";
      grade: Grade;
      climb_mode: "send" | "flash";
      target_date?: string | null;
      grade_system?: GradeSystem;
      gym_id?: number | null;
    }
  | { kind: "run_pace"; band: DistanceBand; target_pace: number; target_date?: string | null };

export function getGoals(signal?: AbortSignal): Promise<Goal[]> {
  return request("/goals", { signal });
}

export function addGoal(input: GoalInput): Promise<Goal> {
  return request("/goals", { method: "POST", body: JSON.stringify(input) });
}

/** Move or remove the date (`target_date: null`), or pause, resume or let go. */
export function changeGoal(
  id: number,
  change: { target_date?: string | null; status?: "active" | "paused" | "dropped" },
): Promise<Goal> {
  return request(`/goals/${id}`, { method: "PATCH", body: JSON.stringify(change) });
}

export function deleteGoal(id: number): Promise<void> {
  return request(`/goals/${id}`, { method: "DELETE" });
}

// --- Pauses (N5) ------------------------------------------------------------------

export const PAUSE_REASONS = ["injury", "illness", "travel", "other"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export type Pause = {
  id: number;
  start_date: string;
  planned_end: string | null;
  ended_on: string | null;
  reason: PauseReason;
  body_part: string | null;
  pain: number | null;
  note: string | null;
  resume_choice: "continue" | "fresh" | null;
};

export type PauseStart = {
  reason: PauseReason;
  body_part?: string | null;
  pain?: number | null;
  note?: string | null;
  planned_end?: string | null;
};

export function getPause(signal?: AbortSignal): Promise<{ active: Pause | null; recent: Pause | null }> {
  return request("/pause", { signal });
}

export function startPause(input: PauseStart): Promise<Pause> {
  return request("/pause", { method: "POST", body: JSON.stringify(input) });
}

/** Edit the break that is on (#82). Every field is replaced; the start date stays. */
export function editPause(input: PauseStart): Promise<Pause> {
  return request("/pause", { method: "PATCH", body: JSON.stringify(input) });
}

export function endPause(resumeChoice: "continue" | "fresh"): Promise<Pause> {
  return request("/pause/end", { method: "POST", body: JSON.stringify({ resume_choice: resumeChoice }) });
}

export type TrendWord = "improving" | "flat" | "declining" | "not enough data";

export type Trend = {
  recent: number | null;
  baseline: number | null;
  recent_sessions: number;
  baseline_sessions: number;
  trend: TrendWord;
};

export const DISTANCE_BANDS = ["under_7km", "7_to_15km", "over_15km"] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

export type RunningProgression = {
  last_session: string | null;
  days_since_last_session: number | null;
  sessions: number;
  weekly: {
    week_start: string;
    runs: number;
    distance_km: number;
    duration_min: number;
    pace_min_per_km: number | null;
    pace_by_distance: Partial<Record<DistanceBand, { runs: number; pace_min_per_km: number | null }>>;
  }[];
  trends: {
    distance_km_per_week: Trend;
    duration_min_per_week: Trend;
    pace_min_per_km: Trend;
    pace_by_distance: Record<DistanceBand, Trend>;
  };
};

export type SendRate = { sent: number; tried: number; rate: number };

export type ClimbingProgression = {
  last_session: string | null;
  days_since_last_session: number | null;
  sessions: number;
  /** The grades the numbers are measured on (1 = the first): the main gym's
   *  colours, or V. Levels in trends are places on this scale (#98). */
  grade_scale: Grade[];
  /** Swatch (null for V/Font) and approximate range per grade_scale entry. */
  grade_scale_detail?: { name: Grade; colour: string | null; range: string | null }[];
  /** The gym the scale belongs to, or null for V. */
  grade_scale_gym?: string | null;
  weekly: {
    week_start: string;
    sessions: number;
    climbs: number;
    hardest_sent: Grade | null;
    flash_grade: Grade | null;
    /** Places on grade_scale (1 = its first grade), possibly between two (#99). */
    hardest_sent_level?: number | null;
    flash_level?: number | null;
    hardest_sent_colour?: string | null;
    flash_colour?: string | null;
    send_rate_by_grade: Partial<Record<Grade, SendRate>>;
  }[];
  trends: {
    climbs_per_week: Trend;
    avg_session_hardest_sent: Trend & { recent_grade: Grade | null; baseline_grade: Grade | null };
    avg_session_flash_grade: Trend & { recent_grade: Grade | null; baseline_grade: Grade | null };
    send_rate_by_grade: Partial<Record<Grade, Trend>>;
  };
};

/** GET /progression (tools.calculate_progression). */
export type Progression = {
  weeks: number;
  today: string;
  trend_rule: string;
  /** Days of the trend windows a pause or a fresh start left out (N5). */
  paused_days?: number;
  running: RunningProgression;
  climbing: ClimbingProgression;
};

/** With `sport` (the Dashboard filter, #46), load, sessions and the ratio count that sport only. */
export function getTrainingLoad(weeks = 8, signal?: AbortSignal, sport?: Sport): Promise<TrainingLoad> {
  return request(`/training-load?weeks=${weeks}${sport ? `&sport=${sport}` : ""}`, { signal });
}

/** The all-sports load with each sport's own under `by_sport`, in one request,
 *  so the Dashboard filter (#46) switches without fetching. A backend from
 *  before `by_sport` leaves it out; lib/dashboard-data.ts then fetches per sport. */
export function getTrainingLoadBySport(
  weeks = 8,
  signal?: AbortSignal,
): Promise<TrainingLoad & { by_sport?: Record<Sport, TrainingLoad> }> {
  return request(`/training-load?weeks=${weeks}&by_sport=true`, { signal });
}

export function getProgression(weeks = 8, signal?: AbortSignal): Promise<Progression> {
  return request(`/progression?weeks=${weeks}`, { signal });
}
