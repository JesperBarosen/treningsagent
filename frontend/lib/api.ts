// Typed client for the FastAPI backend in backend/. Numbers such as load and
// pace come from the backend's tool functions; the frontend only formats them.

import { clearSavedChats } from "./chat-storage";
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
export type Sport = "running" | "climbing";

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
};

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
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // keep the generic message
    }
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
