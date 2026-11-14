// Records UI events in the ui_events table, to measure whether design changes
// work (docs/design-proposals-2.md, "Measurement"). Only an event name is
// sent: the database adds the user id and the time, and stores no content.
// The app can insert but never read events (RLS), so this is write-only.

import { currentUserId, supabaseBrowser } from "./supabase/client";

/** Same rule as the table's check constraint: a short lower-case slug. */
const EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** Records `event` for the signed-in user, in the background. Never throws
 *  and never blocks the UI: a lost event is better than a broken screen.
 *  Does nothing when signed out. */
export function recordEvent(event: string): void {
  if (!EVENT_NAME.test(event)) {
    if (process.env.NODE_ENV !== "production") console.warn(`recordEvent: bad event name "${event}"`);
    return;
  }
  void (async () => {
    try {
      if (!(await currentUserId())) return;
      await supabaseBrowser().from("ui_events").insert({ event });
    } catch {
      // Measurement is best-effort.
    }
  })();
}
