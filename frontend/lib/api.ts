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
