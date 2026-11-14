"""Pausing tracking on purpose (docs/design-proposals-2.md, N5).

A pause has a reason (injury, illness, travel, other); an injury may also note a
body part, pain 0-10 and a note. While a pause is on, and for the days it
covered, trends and the acute:chronic ratio leave those days out instead of
reading them as a decline (Epstein et al. 2015: suspending tracking is not
quitting). Ending a pause asks whether to keep the old baseline ("continue") or
to start fresh, which leaves everything before the restart out of the trend
windows for four weeks.

The app never diagnoses. These are the user's own notes, kept so a later
return-to-training feature (#34) can use them.
"""

from datetime import date, timedelta

REASONS = ("injury", "illness", "travel", "other")
RESUME_CHOICES = ("continue", "fresh")
FRESH_DAYS = 28  # how long "start fresh" hides the old baseline
NOTE_MAX = 500
BODY_PART_MAX = 60


def validate_pause(reason: str, body_part: str | None = None, pain: int | None = None,
                   note: str | None = None, planned_end: str | None = None,
                   today: date | None = None) -> dict:
    """The row for a new pause starting today, or ValueError."""
    today = today or date.today()
    if reason not in REASONS:
        raise ValueError(f"reason must be one of {REASONS}, got {reason!r}")
    body_part = (body_part or "").strip() or None
    note = (note or "").strip() or None
    if reason != "injury" and (body_part is not None or pain is not None):
        raise ValueError("body part and pain are only for an injury")
    if pain is not None and not (isinstance(pain, int) and 0 <= pain <= 10):
        raise ValueError("pain must be a whole number from 0 to 10")
    if body_part and len(body_part) > BODY_PART_MAX:
        raise ValueError(f"body part must be at most {BODY_PART_MAX} characters")
    if note and len(note) > NOTE_MAX:
        raise ValueError(f"note must be at most {NOTE_MAX} characters")
    if planned_end is not None:
        try:
            end = date.fromisoformat(planned_end)
        except ValueError:
            raise ValueError(f"planned_end must be YYYY-MM-DD, got {planned_end!r}") from None
        if end < today:
            raise ValueError("planned_end can't be before today")
    return {"start_date": today.isoformat(), "planned_end": planned_end, "reason": reason,
            "body_part": body_part, "pain": pain, "note": note}


def _d(value) -> date:
    return value if isinstance(value, date) else date.fromisoformat(value)


def excluded_days(pauses: list[dict], today: date) -> frozenset[date]:
    """The days to leave out of trends and the load ratio: every paused day (the
    day a pause ended is a normal day again), and, for four weeks after a
    "start fresh", every day before the restart."""
    days: set[date] = set()
    for p in pauses:
        start = _d(p["start_date"])
        end = _d(p["ended_on"]) if p.get("ended_on") else today + timedelta(days=1)
        days.update(start + timedelta(days=i) for i in range((min(end, today + timedelta(days=1)) - start).days))
    fresh = [_d(p["ended_on"]) for p in pauses
             if p.get("resume_choice") == "fresh" and p.get("ended_on")
             and today < _d(p["ended_on"]) + timedelta(days=FRESH_DAYS)]
    if fresh:
        restart = max(fresh)
        # Far enough back to cover every trend window (6 weeks) and the ratio's 28 days.
        days.update(restart - timedelta(days=i) for i in range(1, 7 * 8))
    return frozenset(days)


def describe(pause: dict) -> str:
    """'an injury (knee, pain 6/10)' or 'travel', for the coach's context."""
    reason = {"injury": "an injury", "illness": "illness", "travel": "travel",
              "other": "another reason"}[pause["reason"]]
    details = [d for d in (pause.get("body_part"),
                           f"pain {pause['pain']}/10" if pause.get("pain") is not None else None) if d]
    return f"{reason} ({', '.join(details)})" if details else reason


def coach_context(pause: dict | None) -> str:
    """A paragraph for the system prompt while a pause is on, or ''."""
    if not pause:
        return ""
    until = f", planned until {pause['planned_end']}" if pause.get("planned_end") else ""
    note = f' Their note: "{pause["note"]}".' if pause.get("note") else ""
    return (
        f"\nThe user paused tracking on {pause['start_date']}{until} because of "
        f"{describe(pause)}.{note} Trends and the load ratio leave the paused days out. "
        "Respect the break: don't suggest making up for lost training and don't call the "
        "gap a decline."
    )
