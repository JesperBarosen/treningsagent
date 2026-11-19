"""The training profile (#137): what the user tells the app about themselves.

One row per user (public.training_profiles). Every field is optional. The
coach reads it in every turn (coach_context), propose_program uses it for
what the coach would otherwise have to ask (sessions per week, days, pain),
and the coach changes it only by proposing a change the user confirms
(propose_profile_update): like a session draft, nothing is stored without
the user's tap. The app edits it on the You tab and in the first-login step.
"""

from plans import WEEKDAYS

FIELDS = ("longest_run_km", "weekly_run_km", "climbing_level", "injuries", "sessions_per_week",
          "preferred_days", "other_sports", "goals_note")
ONBOARDING = ("done", "skipped")
MAX_INJURIES = 10

EMPTY = {"longest_run_km": None, "weekly_run_km": None, "climbing_level": None, "injuries": [],
         "sessions_per_week": None, "preferred_days": [], "other_sports": None, "goals_note": None,
         "onboarding": None}


def _number(value, what: str, low: float, high: float, *, low_open: bool = False) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{what} must be a number")
    if (value <= low if low_open else value < low) or value > high:
        raise ValueError(f"{what} must be between {low:g} and {high:g}")
    return round(float(value), 1)


def _text(value, what: str, longest: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{what} must be text")
    text = value.strip()
    if len(text) > longest:
        raise ValueError(f"{what} can be at most {longest} characters")
    return text or None


def _injury(item) -> dict:
    if not isinstance(item, dict) or set(item) - {"body_part", "pain", "note"}:
        raise ValueError("each injury has body_part, pain (0-10) and an optional note")
    part = _text(item.get("body_part"), "body_part", 40)
    if not part:
        raise ValueError("each injury needs a body_part")
    pain = item.get("pain")
    if pain is not None and (isinstance(pain, bool) or not isinstance(pain, int) or not 0 <= pain <= 10):
        raise ValueError("pain must be a whole number from 0 to 10")
    return {"body_part": part, "pain": pain, "note": _text(item.get("note"), "injury note", 200)}


def _days(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("preferred_days must be a list of weekday names")
    out = []
    for d in value:
        name = str(d).strip().lower()
        match = next((w for w in WEEKDAYS if len(name) >= 3 and w.startswith(name[:3])), None)
        if match is None:
            raise ValueError(f"preferred_days must be weekday names, got {d!r}")
        out.append(match)
    return sorted(set(out), key=WEEKDAYS.index)


def validate_changes(changes: dict, *, allow_onboarding: bool = True) -> dict:
    """The columns to write for `changes`, or ValueError. Only the given keys
    change; None (or an empty list) clears a field."""
    if not isinstance(changes, dict):
        raise ValueError("changes must be an object")
    allowed = set(FIELDS) | ({"onboarding"} if allow_onboarding else set())
    unknown = set(changes) - allowed
    if unknown:
        raise ValueError(f"unknown profile fields: {sorted(unknown)}")
    out: dict = {}
    for key, value in changes.items():
        if key == "longest_run_km":
            out[key] = _number(value, "longest_run_km", 0, 200, low_open=True)
        elif key == "weekly_run_km":
            out[key] = _number(value, "weekly_run_km", 0, 500)
        elif key == "sessions_per_week":
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 14):
                raise ValueError("sessions_per_week must be a whole number from 1 to 14")
            out[key] = value
        elif key == "climbing_level":
            out[key] = _text(value, "climbing_level", 60)
        elif key == "other_sports":
            out[key] = _text(value, "other_sports", 200)
        elif key == "goals_note":
            out[key] = _text(value, "goals_note", 500)
        elif key == "preferred_days":
            out[key] = _days(value)
        elif key == "injuries":
            items = value or []
            if not isinstance(items, list) or len(items) > MAX_INJURIES:
                raise ValueError(f"injuries must be a list of at most {MAX_INJURIES}")
            out[key] = [_injury(i) for i in items]
        elif key == "onboarding":
            if value is not None and value not in ONBOARDING:
                raise ValueError(f"onboarding must be one of {ONBOARDING}")
            out[key] = value
    return out


def read(store) -> dict:
    """The user's profile, every field present (empty ones as None or [])."""
    row = store.get_profile() if hasattr(store, "get_profile") else None
    return {**EMPTY, **(row or {})}


def coach_context(p: dict) -> str:
    """The profile as a few lines for the system prompt, or "" when empty."""
    lines = []
    if p.get("longest_run_km") is not None:
        lines.append(f"longest recent run about {p['longest_run_km']:g} km (as they said)")
    if p.get("weekly_run_km") is not None:
        lines.append(f"typical running about {p['weekly_run_km']:g} km a week (as they said)")
    if p.get("climbing_level"):
        lines.append(f"climbing level: {p['climbing_level']}")
    if p.get("sessions_per_week"):
        lines.append(f"{p['sessions_per_week']} sessions a week")
    if p.get("preferred_days"):
        lines.append("preferred days: " + ", ".join(d.title() for d in p["preferred_days"]))
    for i in p.get("injuries") or []:
        pain = f", pain {i['pain']}/10" if i.get("pain") is not None else ""
        note = f" ({i['note']})" if i.get("note") else ""
        lines.append(f"injury or pain: {i['body_part']}{pain}{note}")
    if p.get("other_sports"):
        lines.append(f"other sports: {p['other_sports']}")
    if p.get("goals_note"):
        lines.append(f"goals in their words: {p['goals_note']}")
    if not lines:
        return ""
    return ("\nThe user's training profile (what they told the app; their logged sessions win "
            "where they disagree):\n- " + "\n- ".join(lines) + "\nUse it instead of asking again. "
            "Change it only with propose_profile_update, which the user must confirm; never "
            "diagnose an injury in it.")


def injury_text(p: dict) -> str | None:
    """The profile's injuries in one line, for propose_program; None when there are none."""
    items = p.get("injuries") or []
    if not items:
        return None
    return "; ".join(f"{i['body_part']}" + (f" (pain {i['pain']}/10)" if i.get("pain") is not None else "")
                     for i in items)


def propose_update(store, **changes) -> dict:
    """The coach's change to the profile, for the user to confirm (#137). Never
    stored here, whatever "Save without asking" says: the app shows the change
    with Save and Dismiss, and Save sends `changes` to PATCH /profile."""
    if not changes:
        raise ValueError("nothing to change")
    clean = validate_changes(changes, allow_onboarding=False)
    before = read(store)
    return {"profile_update": True, "stored": False, "changes": clean,
            "before": {k: before.get(k) for k in clean}}
