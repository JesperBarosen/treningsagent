// Every message the app shows when a usage limit stops the coach (#129, #130).
// Edit the words here; the backend only sends which limit was hit
// (backend/limits.py). No blame, and logging by hand always still works.

/** What the backend's 429 / 403 body says. */
export type LimitBody = {
  limit: "closed_beta" | "global_month" | "global_day" | "hourly" | "daily";
  retry_after_minutes?: number;
  /** Only with global_month, and only when SUPPORT_URL is set on the backend. */
  support_url?: string;
};

export const LIMITS = ["closed_beta", "global_month", "global_day", "hourly", "daily"] as const;

/** "in 12 minutes", "in about 3 hours". */
export function waitText(minutes: number | undefined): string {
  if (!minutes || minutes <= 1) return "in a minute";
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

export const CLOSED_BETA = {
  title: "The app is in closed beta",
  body: "Treningsagent is open to invited testers only for now. If you think you should have access, ask the person who invited you.",
};

/** The chat's message for each limit: a title and a sentence. */
export function limitMessage(body: LimitBody): { title: string; text: string } {
  switch (body.limit) {
    case "global_month":
      return {
        title: "The coach is resting until the 1st",
        text:
          "This month's free coach budget is used up. Treningsagent is built and paid for by one student, and every " +
          "message costs real money. Logging still works, and the coach is back on the 1st.",
      };
    case "global_day":
      return {
        title: "The coach is taking a break",
        text: "The coach is taking a break for the rest of the day. Logging still works.",
      };
    case "hourly":
      return {
        title: "That's a lot of messages for one hour",
        text: `You can message the coach again ${waitText(body.retry_after_minutes)}. Logging still works.`,
      };
    case "daily":
      return {
        title: "That's today's coach time used",
        text: `The coach is back ${waitText(body.retry_after_minutes)}, tomorrow. Logging still works.`,
      };
    case "closed_beta":
      return { title: CLOSED_BETA.title, text: CLOSED_BETA.body };
  }
}

export const SUPPORT_LABEL = "Support the app";
