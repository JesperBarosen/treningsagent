// Typed client for the FastAPI backend in backend/. Numbers such as load and
// pace come from the backend's tool functions; the frontend only formats them.

import { clearSavedChats } from "./chat-storage";
import { accessToken, supabaseBrowser } from "./supabase/client";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

export const GRADES = ["yellow", "green", "blue", "purple", "red", "black", "white"] as const;
export type Grade = (typeof GRADES)[number];
export type Sport = "running" | "climbing";

export type Climb = {
  grade: Grade;
  grade_ordinal: number;
  sent: boolean;
  style: "boulder" | "kilter" | "rope";
  attempts?: number | null;
  notes?: string | null;
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
  if (d.sport === "climbing" && d.climbs?.length) {
    input.climbs = d.climbs.map(({ grade, style, sent, attempts }) => ({
      grade,
      style,
      sent,
      attempts: attempts ?? null,
    }));
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
  climbs?: Pick<Climb, "grade" | "style" | "sent" | "attempts">[];
};

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
  progress: { steps: number; of: number; best_grade: Grade | null; best_count_28d: number; reached_on: string | null };
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
  | { kind: "climb_grade"; grade: Grade; climb_mode: "send" | "flash"; target_date?: string | null }
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
  grade_scale: Grade[];
  weekly: {
    week_start: string;
    sessions: number;
    climbs: number;
    hardest_sent: Grade | null;
    flash_grade: Grade | null;
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

export function getTrainingLoad(weeks = 8, signal?: AbortSignal): Promise<TrainingLoad> {
  return request(`/training-load?weeks=${weeks}`, { signal });
}

export function getProgression(weeks = 8, signal?: AbortSignal): Promise<Progression> {
  return request(`/progression?weeks=${weeks}`, { signal });
}
