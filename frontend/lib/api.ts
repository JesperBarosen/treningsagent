// Typed client for the FastAPI backend in backend/. Numbers such as load and
// pace come from the backend's tool functions; the frontend only formats them.

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

export type ChatResponse = {
  reply: string;
  history: unknown[];
  conversation_id: string;
  logged_sessions: Session[];
};

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
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("Can't reach the backend.", null);
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
  return res.json() as Promise<T>;
}

export function sendChat(
  message: string,
  history: unknown[],
  conversationId: string | null,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return request("/chat", {
    method: "POST",
    body: JSON.stringify({ message, history, conversation_id: conversationId }),
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
};

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
  running: RunningProgression;
  climbing: ClimbingProgression;
};

export function getTrainingLoad(weeks = 8, signal?: AbortSignal): Promise<TrainingLoad> {
  return request(`/training-load?weeks=${weeks}`, { signal });
}

export function getProgression(weeks = 8, signal?: AbortSignal): Promise<Progression> {
  return request(`/progression?weeks=${weeks}`, { signal });
}
