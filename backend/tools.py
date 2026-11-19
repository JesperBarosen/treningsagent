"""The tool functions the agent can call, and their validation.

Storage is passed in as a Store, so these functions never touch a database
directly and can be tested offline. Only raw, user-reported facts are stored.
Derived values (pace, load) are computed when history is read, so they can
never go stale or disagree.
"""

import json
from datetime import date, timedelta
from typing import Protocol

import forms
import goals
import grades
import gyms
import pauses
import plans
import progression
import training_profile

# Strength and Other (#100) have only the core fields built in; templates shape them.
SPORTS = forms.SPORTS
RUNNING_FIELDS = ("distance_km", "elevation_m")
# The colours of "My gym", easiest first: the scale every user had before gyms
# (#98). Other gyms and V/Font grades are in grades.py.
GRADES = grades.LEGACY_COLOURS
CLIMB_STYLES = ("boulder", "kilter", "rope")
CLIMB_FIELDS = {"grade", "attempts", "sent", "style", "notes", "grade_system", "gym_id"}
# The acute:chronic ratio compares 7 days with 28, so it means little before
# 28 days of history.
RATIO_MIN_HISTORY_DAYS = 28


class Store(Protocol):
    """Where sessions are kept. db.PostgresStore in the app, a fake in tests."""

    def insert_session(self, row: dict, climbs: list[dict] = ()) -> int: ...
    def sessions_since(self, since: str) -> list[dict]: ...
    def first_session_date(self, sport: str | None = None) -> str | None: ...
    def climbs_since(self, since: str) -> list[dict]: ...
    def log_model_call(self, call: dict) -> None: ...
    def get_session(self, session_id: int) -> dict | None: ...
    def update_session(self, session_id: int, row: dict,
                       climbs: list[dict] | None) -> bool: ...
    def delete_session(self, session_id: int) -> bool: ...
    # Gyms (#98): each with its colours under "grades", archived ones included.
    def gyms(self) -> list[dict]: ...
    def insert_gym(self, row: dict, colours: list[dict]) -> dict: ...
    def update_gym(self, gym_id: int, row: dict, colours: list[dict] | None) -> dict | None: ...
    def delete_gym(self, gym_id: int) -> bool: ...
    def last_gym_id(self) -> int | None: ...
    # Session templates (#100), archived ones included.
    def templates(self) -> list[dict]: ...
    def insert_template(self, row: dict) -> dict: ...
    def update_template(self, template_id: int, row: dict) -> dict | None: ...
    def delete_template(self, template_id: int) -> bool: ...
    def template_value_keys(self, template_id: int) -> set[str]: ...


SESSION_FIELDS = ("sport", "date", "duration_min", "effort", "notes")

# Context tags (N6, docs/design-proposals-2.md): optional, one tap each, never
# required. They let the coach notice what often goes together (Li et al. 2010:
# relate facets of life), never a cause.
TAGS = ("slept_badly", "sore", "tired", "felt_strong", "hot", "stressed")


def _tags(value) -> list[str] | None:
    """Tags in TAGS order without repeats; None if not given. ValueError if unknown."""
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(t, str) for t in value):
        raise ValueError("tags must be a list of strings")
    unknown = sorted(set(value) - set(TAGS))
    if unknown:
        raise ValueError(f"unknown tags {unknown}; allowed: {list(TAGS)}")
    return [t for t in TAGS if t in value]


def log_session(
    store: Store,
    sport: str,
    date: str,
    duration_min: int,
    effort: int,
    notes: str | None = None,
    climbs: list[dict] | None = None,
    template_id: int | None = None,
    values: dict | None = None,
    **sport_fields,
) -> dict:
    """Validate and store one session, and for climbing its individual climbs,
    in one go. Returns the stored session with its id. With `template_id`, the
    session uses that template and `values` are its fields by key (#100)."""
    template = _template(store, template_id)
    row, climb_rows = validate_session(sport, date, duration_min, effort, notes, climbs,
                                       gym_list=_gyms_for(store, climbs, create=True),
                                       template=template, values=values, **sport_fields)
    session_id = store.insert_session(row, climb_rows)
    result = {"id": session_id, **row}
    if climb_rows:
        result["climbs"] = climb_rows
    return _with_template(result, template)


def _template(store: Store, template_id: int | None, *, allow_archived: bool = False) -> dict | None:
    """The user's template `template_id` (None for none). ValueError if it
    isn't theirs, or is archived (unless an existing session keeps it)."""
    if template_id is None:
        return None
    if isinstance(template_id, bool) or not isinstance(template_id, int):
        raise ValueError("template_id must be a template's id")
    template = next((t for t in store.templates() if t["id"] == template_id), None)
    if template is None:
        raise ValueError(f"template {template_id} not found")
    if template.get("archived_at") and not allow_archived:
        raise ValueError(f"the {template['name']} template is archived")
    return template


def _with_template(session: dict, template: dict | None) -> dict:
    """Add the template's name and the values with labels (forms.described)."""
    if template is None:
        return session
    return {**session, "template": template["name"],
            "fields": forms.described(template, session.get("custom_values") or {})}


def draft_session(
    store: Store,
    sport: str,
    date: str,
    duration_min: int,
    effort: int,
    notes: str | None = None,
    climbs: list[dict] | None = None,
    template_id: int | None = None,
    values: dict | None = None,
    **sport_fields,
) -> dict:
    """Check a session the user described, with log_session's rules, without
    storing it. The app shows the draft with Save and Review, so the user
    confirms what the agent understood before anything is written (N4)."""
    template = _template(store, template_id) if hasattr(store, "templates") else None
    if template_id is not None and template is None:
        raise ValueError(f"template {template_id} not found")
    row, climb_rows = validate_session(sport, date, duration_min, effort, notes, climbs,
                                       gym_list=_gyms_for(store, climbs, create=False),
                                       template=template, values=values, **sport_fields)
    result = {"draft": True, **row}
    if climb_rows:
        result["climbs"] = climb_rows
    return _with_template(result, template)


def update_session(store: Store, session_id: int, changes: dict) -> dict:
    """Apply `changes` to a stored session and validate the result with the
    same rules as log_session. `climbs`, if given, replaces all the session's
    climbs. Raises LookupError if the session doesn't exist (or isn't the
    user's), ValueError if the result is invalid."""
    current = store.get_session(session_id)
    if current is None:
        raise LookupError(f"session {session_id} not found")
    merged = {k: current[k] for k in SESSION_FIELDS}
    if current.get("tags"):  # an edit keeps the tags unless it changes them
        merged["tags"] = current["tags"]
    if changes.get("sport", current["sport"]) == current["sport"] == "running":
        merged.update({f: current[f] for f in RUNNING_FIELDS if current.get(f) is not None})
    # An edit keeps the template and its values unless it changes them (#100).
    old_template_id = current.get("template_id")
    old_values = current.get("custom_values") or {}
    merged.update(changes)
    climbs = merged.pop("climbs", None)
    template_id = merged.pop("template_id", old_template_id)
    same_template = template_id is not None and template_id == old_template_id
    values = merged.pop("values", old_values if same_template else None)
    # A session may keep an archived template it already has.
    template = _template(store, template_id, allow_archived=same_template)

    row, climb_rows = validate_session(**merged, climbs=climbs,
                                       gym_list=_gyms_for(store, climbs, create=True),
                                       template=template, values=values,
                                       previous_values=old_values if same_template else None)
    if row["sport"] != "climbing":
        replace_climbs = []  # a session that's no longer climbing keeps no climbs
    else:
        replace_climbs = climb_rows if climbs is not None else None
    # Every column is written, so fields the new version doesn't have become null.
    full_row = {**{f: None for f in RUNNING_FIELDS}, **row}
    if old_template_id is not None or template is not None:
        full_row.setdefault("template_id", None)
        full_row.setdefault("custom_values", {})
    if not store.update_session(session_id, full_row, replace_climbs):
        raise LookupError(f"session {session_id} not found")
    return _with_template({"id": session_id, **row}, template)


def list_templates(store: Store) -> list[dict]:
    """The user's templates for the app, live ones first, in their order."""
    rows = sorted(store.templates(), key=lambda t: (bool(t.get("archived_at")), t.get("position", 0), t["id"]))
    return [forms.view(t) for t in rows]


def _coach_field(f: dict) -> dict:
    """A field as the coach needs it to fill it in: no archived options, no noise."""
    out = {"key": f["key"], "label": f["label"], "type": f["type"]}
    if f.get("required"):
        out["required"] = True
    for prop in ("unit", "min", "max", "multiple", "reps_unit", "load_unit", "load_signed",
                 "max_length", "default_style"):
        if f.get(prop) not in (None, False):
            out[prop] = f[prop]
    if f["type"] == "select":
        out["options"] = [{"value": o["value"], "label": o["label"]}
                          for o in f["options"] if not o.get("archived")]
    if f.get("extras"):
        out["extras"] = [{k: c[k] for k in ("key", "label", "unit") if c.get(k)} for c in f["extras"]]
    if f.get("measures"):  # #111: one value per measure
        out["measures"] = [{"key": m["key"], "label": m["label"]} for m in f["measures"]]
    return out


def templates_for_coach(store: Store) -> dict:
    """list_templates for the agent (#102): live templates with their fields,
    gyms with their colours and approximate V range, and the gym used last."""
    templates = [{"id": t["id"], "name": t["name"], "sport": t["sport"],
                  **({"core_fields": t["core_fields"]} if t.get("core_fields") else {}),
                  "fields": [_coach_field(f) for f in t["fields"] if not f.get("archived")]}
                 for t in (store.templates() if hasattr(store, "templates") else [])
                 if not t.get("archived_at")]
    gym_list = [{"id": g["id"], "name": g["name"],
                 "colours": [{"name": c["name"], "range": grades.range_text(c, "v")}
                             for c in grades.active_grades(g)]}
                for g in (store.gyms() if hasattr(store, "gyms") else []) if not g.get("archived_at")]
    return {"templates": templates, "gyms": gym_list,
            "last_gym_id": store.last_gym_id() if hasattr(store, "last_gym_id") else None,
            "grades": "Gym colours belong to a gym (no gym_id = the last gym used, or My gym). "
                      "Outdoors and boards use grade_system v (VB, V0-V17) or font (4 to 9A)."}


def create_template(store: Store, name: str, sport: str, fields: list,
                    core_fields: list | None = None) -> dict:
    row = forms.validate_template(name, sport, fields, core_fields)
    _unique_name(store, row["name"])
    row["position"] = len([t for t in store.templates() if not t.get("archived_at")])
    return forms.view(store.insert_template(row))


def add_starters(store: Store, names: list[str]) -> list[dict]:
    """Add starter templates (forms.STARTERS) the user picked (Q3)."""
    unknown = [n for n in names if n not in forms.STARTERS]
    if unknown:
        raise ValueError(f"unknown starters {unknown}; starters: {list(forms.STARTERS)}")
    out = []
    for name in names:
        row = forms.starter(name)
        out.append(create_template(store, row["name"], row["sport"], row["fields"], row["core_fields"]))
    return out


def update_template(store: Store, template_id: int, changes: dict) -> dict:
    """Rename, reorder, archive or reshape a template, under the edit rules in
    forms.validate_template. LookupError if not found."""
    current = next((t for t in store.templates() if t["id"] == template_id), None)
    if current is None:
        raise LookupError(f"template {template_id} not found")
    unexpected = set(changes) - {"name", "sport", "fields", "core_fields", "position", "archived"}
    if unexpected:
        raise ValueError(f"unknown template fields: {sorted(unexpected)}")
    merged = {k: changes.get(k, current[k]) for k in ("name", "sport", "fields", "core_fields")}
    row = forms.validate_template(**merged, previous=current,
                                  used_keys=store.template_value_keys(template_id))
    archived = changes.get("archived", bool(current.get("archived_at")))
    if not archived and row["name"].lower() != current["name"].lower() or (
            not archived and current.get("archived_at")):
        _unique_name(store, row["name"], but=template_id)
    if "position" in changes:
        if isinstance(changes["position"], bool) or not isinstance(changes["position"], int):
            raise ValueError("position must be a whole number")
        row["position"] = changes["position"]
    if "archived" in changes:
        row["archived"] = bool(changes["archived"])
    updated = store.update_template(template_id, row)
    if updated is None:
        raise LookupError(f"template {template_id} not found")
    return forms.view(updated)


def delete_template(store: Store, template_id: int) -> None:
    """Delete an unused template. LookupError if not found, ValueError if
    sessions use it (archive it instead)."""
    if not store.delete_template(template_id):
        raise LookupError(f"template {template_id} not found")


def _unique_name(store: Store, name: str, but: int | None = None) -> None:
    if any(t["name"].lower() == name.lower() and not t.get("archived_at") and t["id"] != but
           for t in store.templates()):
        raise ValueError(f"you already have a template called {name!r}")


def delete_session(store: Store, session_id: int) -> None:
    """Delete a session and its climbs. Raises LookupError if not found."""
    if not store.delete_session(session_id):
        raise LookupError(f"session {session_id} not found")


def validate_session(
    sport: str,
    date: str,
    duration_min: int,
    effort: int,
    notes: str | None = None,
    climbs: list[dict] | None = None,
    gym_list: list[dict] | None = None,
    template: dict | None = None,
    values: dict | None = None,
    previous_values: dict | None = None,
    **sport_fields,
) -> tuple[dict, list[dict]]:
    """The rules every stored session follows, whoever writes it (the agent
    or the app). Returns the session row and the validated climb rows.
    `gym_list` is the user's gyms with the default gym first (_gyms_for);
    without it, colours are checked against "My gym"'s. With `template`,
    `values` are checked by forms.validate_values (#100)."""
    if values is not None and template is None:
        raise ValueError("values need a template_id")
    if sport not in SPORTS:
        raise ValueError(f"sport must be one of {SPORTS}, got {sport!r}")
    _parse_date(date)
    if duration_min <= 0:
        raise ValueError("duration_min must be positive")
    if not 1 <= effort <= 10:
        raise ValueError("effort must be between 1 and 10")

    tags = _tags(sport_fields.pop("tags", None))
    allowed = RUNNING_FIELDS if sport == "running" else ()
    unexpected = set(sport_fields) - set(allowed)
    if unexpected:
        raise ValueError(f"fields not valid for {sport}: {sorted(unexpected)}")
    if climbs and sport != "climbing":
        raise ValueError("climbs can only be logged for climbing sessions")
    gym_list = gym_list or [grades.legacy_gym()]
    climb_rows = [_climb_row(c, gym_list) for c in climbs or []]

    row = {"sport": sport, "date": date, "duration_min": duration_min,
           "effort": effort, "notes": notes, **sport_fields}
    if tags is not None:  # only when given, so rows without tags stay as before
        row["tags"] = tags
    if template is not None:  # only with a template, so plain rows stay as before
        row["template_id"] = template["id"]
        row["custom_values"] = forms.validate_values(template, values, sport, previous_values)
    return row, climb_rows


def _gyms_for(store: Store, climbs: list[dict] | None, *, create: bool) -> list[dict] | None:
    """The user's gyms with the default one (gyms.default_gym) first, when a
    climb may need them; None when there are no climbs. With `create`, a user
    without gyms gets "My gym" (as the migration gave existing users)."""
    if not climbs or not hasattr(store, "gyms"):  # no store: "My gym"'s colours
        return None
    gym_list = store.gyms()
    # Only a colour without a gym_id needs the default gym (and may create it).
    needs_default = any((c.get("grade_system") or "gym") == "gym" and c.get("gym_id") is None
                        for c in climbs)
    default = gyms.default_gym(store, gym_list, create=create and needs_default)
    return [default] + [g for g in gym_list if g is not default]


def _climb_row(climb: dict, gym_list: list[dict]) -> dict:
    """Validate one climb and resolve its grade: a colour of its gym (the
    default gym, gym_list[0], unless gym_id says otherwise) or a V/Font grade."""
    unexpected = set(climb) - CLIMB_FIELDS
    if unexpected:
        raise ValueError(f"unknown climb fields: {sorted(unexpected)}")
    system = climb.get("grade_system") or "gym"
    if system not in grades.SYSTEMS:
        raise ValueError(f"climb grade_system must be one of {grades.SYSTEMS}, got {system!r}")
    gym = None
    if climb.get("gym_id") is not None:
        gym = next((g for g in gym_list if g["id"] == climb["gym_id"]), None)
        if gym is None:
            raise ValueError(f"gym {climb['gym_id']} not found")
    if system == "gym":
        gym = gym or gym_list[0]
        wanted = str(climb.get("grade", "")).strip().lower()
        # An archived colour still matches, so an old session can be edited.
        match = next((g for g in sorted(gym["grades"], key=lambda g: bool(g.get("archived_at")))
                      if g["name"] == wanted), None)
        if match is None:
            names = tuple(g["name"] for g in grades.active_grades(gym))
            raise ValueError(f"climb grade must be one of {names} at {gym['name']}, "
                             f"got {climb.get('grade')!r}")
        resolved = {"grade": match["name"], "grade_ordinal": match["position"],
                    "grade_system": "gym", "gym_id": gym["id"], "gym_grade_id": match["id"]}
    else:
        resolved = {"grade": grades.normalise(system, climb.get("grade", "")), "grade_ordinal": None,
                    "grade_system": system, "gym_id": gym and gym["id"], "gym_grade_id": None}
    if climb.get("style") not in CLIMB_STYLES:
        raise ValueError(f"climb style must be one of {CLIMB_STYLES}, got {climb.get('style')!r}")
    if not isinstance(climb.get("sent"), bool):
        raise ValueError("climb sent must be true or false")
    attempts = climb.get("attempts")
    if attempts is not None and (not isinstance(attempts, int) or attempts < 1):
        raise ValueError("climb attempts must be a positive integer")
    return {**resolved, "attempts": attempts, "sent": climb["sent"], "style": climb["style"],
            "notes": climb.get("notes")}


def get_history(store: Store, days: int, today: date | None = None) -> list[dict]:
    """Sessions from the last `days` days (today included), oldest first,
    with derived metrics computed on the fly."""
    if days < 1:
        raise ValueError("days must be at least 1")
    today = today or date.today()
    since = (today - timedelta(days=days - 1)).isoformat()
    climbs = annotated_climbs(store, since)
    climbs_by_session: dict[int, list[dict]] = {}
    for c in climbs:
        climbs_by_session.setdefault(c["session_id"], []).append(c)

    rows = store.sessions_since(since)
    templates = ({t["id"]: t for t in store.templates()}
                 if any(r.get("template_id") for r in rows) else {})
    sessions = []
    for row in rows:
        s = {k: v for k, v in row.items() if v is not None and v != {}}
        s = _with_template(s, templates.get(s.get("template_id")))
        if s["id"] in climbs_by_session:
            s["climbs"] = climbs_by_session[s["id"]]
        s.update(derived_metrics(s))
        if "climbs" in s:  # index and level are internal; gym and colour are shown
            s["climbs"] = [{k: v for k, v in c.items() if v is not None
                            and k not in ("id", "session_id", "index", "level", "label")}
                           for c in s["climbs"]]
        sessions.append(s)
    return sessions


def annotated_climbs(store: Store, since: str) -> list[dict]:
    """Climbs since `since` with index, level and label (grades.annotate)."""
    climbs = [dict(c) for c in store.climbs_since(since)]
    if climbs:
        grades.annotate(climbs, store.gyms())
    return climbs


def session_load(session: dict) -> int:
    """Session-RPE load (Foster et al. 2001): minutes x perceived effort (1-10)."""
    return session["duration_min"] * session["effort"]


def get_training_load(store: Store, weeks: int = 4, today: date | None = None,
                      sport: str | None = None) -> dict:
    """Session-RPE load per day and per calendar week (Monday start) across all
    sports, for the current week and the `weeks - 1` before it, plus the
    acute:chronic workload ratio: average daily load over the last 7 days
    divided by the average over the last 28 (today included in both).

    With `sport` (#46, the Dashboard filter), everything counts that sport's
    sessions only: load, sessions, the ratio and its history. Breaks apply to
    every sport alike.

    ratio_status is "not_enough_data" when under RATIO_MIN_HISTORY_DAYS days
    have passed since the first logged session (today included), or when there
    is no ratio at all; otherwise "ok". history_days is that day count."""
    if not 1 <= weeks <= 12:
        raise ValueError("weeks must be between 1 and 12")
    if sport is not None and sport not in SPORTS:
        raise ValueError(f"sport must be one of {SPORTS}, got {sport!r}")
    today = today or date.today()
    start = today - timedelta(days=today.weekday() + 7 * (weeks - 1))
    chronic_start = today - timedelta(days=27)
    sessions = store.sessions_since(min(start, chronic_start).isoformat())
    if sport is not None:
        sessions = [s for s in sessions if s["sport"] == sport]

    by_day: dict[date, int] = {}
    for s in sessions:
        d = _parse_date(s["date"])
        by_day[d] = by_day.get(d, 0) + session_load(s)

    def days_from(first: date):
        return (first + timedelta(days=i) for i in range((today - first).days + 1))

    weekly = []
    for i in range(weeks):
        week_start = start + timedelta(days=7 * i)
        week = [s for s in sessions
                if week_start <= _parse_date(s["date"]) < week_start + timedelta(days=7)]
        by_sport: dict[str, int] = {}
        for s in week:
            by_sport[s["sport"]] = by_sport.get(s["sport"], 0) + session_load(s)
        weekly.append({"week_start": week_start.isoformat(), "load": sum(by_sport.values()),
                       "sessions": len(week), "load_by_sport": by_sport})

    # Paused days (N5) are left out of both averages, so a break doesn't look
    # like a sudden drop. While a pause is on, the ratio isn't interpreted.
    excluded, active = _pause_days(store, chronic_start, today)

    def daily_avg(first: date) -> float | None:
        days = [d for d in days_from(first) if d not in excluded]
        return sum(by_day.get(d, 0) for d in days) / len(days) if days else None

    acute = daily_avg(today - timedelta(days=6))
    chronic = daily_avg(chronic_start)
    ratio = round(acute / chronic, 2) if acute is not None and chronic else None
    first = store.first_session_date(sport)
    history_days = max((today - _parse_date(first)).days + 1, 0) if first else 0
    enough = ratio is not None and history_days >= RATIO_MIN_HISTORY_DAYS
    return {
        "daily": [{"date": d.isoformat(), "load": by_day.get(d, 0)} for d in days_from(start)],
        "weekly": weekly,
        "acute_7d_avg": round(acute or 0, 1),
        "chronic_28d_avg": round(chronic or 0, 1),
        "acute_chronic_ratio": ratio,
        "ratio_status": "paused" if active else ("ok" if enough else "not_enough_data"),
        "history_days": history_days,
        "paused_days": sum(1 for d in days_from(chronic_start) if d in excluded),
        "pause": active,
    }


TAG_MIN_SESSIONS = 8  # sessions of a sport before any pattern is reported
TAG_MIN_TAGGED = 3    # sessions with a tag before it can be part of a pattern


def tag_patterns(store: Store, days: int = 56, today: date | None = None) -> dict:
    """Which context tags (N6) often go with a sport's weakest sessions: the
    slowest third of runs (min/km) and the climbing sessions with the lowest
    hardest send. Co-occurrence only, and only with enough sessions: never a
    cause. Per sport: session and tag counts, and `patterns`, each with how many
    of the weakest sessions had the tag against how many of the others."""
    if not 7 <= days <= 365:
        raise ValueError("days must be between 7 and 365")
    today = today or date.today()
    since = (today - timedelta(days=days - 1)).isoformat()
    sessions = [s for s in store.sessions_since(since) if _parse_date(s["date"]) <= today]
    hardest: dict[int, float] = {}
    for c in annotated_climbs(store, since):
        if c["sent"] and c["level"] is not None:
            hardest[c["session_id"]] = max(hardest.get(c["session_id"], 0), c["level"])

    def weakness(s: dict) -> float | None:  # higher = weaker
        if s["sport"] == "running":
            return s["duration_min"] / s["distance_km"] if s.get("distance_km") else None
        return -hardest.get(s["id"], 0)

    out = {}
    for sport in SPORTS:
        rated = [s for s in sessions if s["sport"] == sport and weakness(s) is not None]
        rated.sort(key=weakness, reverse=True)  # weakest first
        counts = {t: sum(t in (s.get("tags") or []) for s in rated) for t in TAGS}
        patterns = []
        if len(rated) >= TAG_MIN_SESSIONS:
            cut = max(len(rated) // 3, 1)
            weak, rest = rated[:cut], rated[cut:]
            for t in TAGS:
                if counts[t] < TAG_MIN_TAGGED:
                    continue
                in_weak = sum(t in (s.get("tags") or []) for s in weak)
                in_rest = sum(t in (s.get("tags") or []) for s in rest)
                if in_weak >= 2 and in_weak / len(weak) >= 2 * (in_rest / len(rest)):
                    patterns.append({"tag": t, "in_weakest": in_weak, "weakest": len(weak),
                                     "elsewhere": in_rest, "others": len(rest)})
        out[sport] = {"sessions": len(rated), "tag_counts": {t: n for t, n in counts.items() if n},
                      "patterns": patterns,
                      "enough_data": len(rated) >= TAG_MIN_SESSIONS}
    return {"days": days, **out,
            "weakest_means": {"running": "slowest third of runs by pace",
                              "climbing": "the third of sessions with the lowest hardest send"}}


def list_goals(store: Store, today: date | None = None) -> list[dict]:
    """Every goal with its progress (goals.py). An active goal that has been
    reached is marked achieved, with the day it was reached."""
    today = today or date.today()
    rows = store.goals()
    if not rows:
        return []
    since = min(_parse_date(g["created_on"]) for g in rows) - timedelta(days=goals.LOOKBACK)
    sessions = store.sessions_since(since.isoformat())
    climbs = annotated_climbs(store, since.isoformat())
    gym_list = store.gyms() if any(g["kind"] == "climb_grade" for g in rows) else []
    out = []
    for g in rows:
        g = goals.with_progress(g, sessions, climbs, today, gym_list)
        reached = g["progress"]["reached_on"]
        if g["status"] == "active" and reached:
            g = {**g, **store.update_goal(g["id"], {"status": "achieved", "achieved_on": reached}),
                 "overdue": False}
        out.append(g)
    return out


def set_goal(store: Store, kind: str, grade: str | None = None, climb_mode: str | None = None,
             band: str | None = None, target_pace: float | None = None,
             target_date: str | None = None, today: date | None = None,
             grade_system: str | None = None, gym_id: int | None = None) -> dict:
    """Add a goal the user chose. A pace goal starts from the user's recent pace
    in that band, so progress shows how far they have come. A gym-colour goal
    is for `gym_id`, or the default gym (the last one used)."""
    today = today or date.today()
    gym = None
    if kind == "climb_grade" and (grade_system or "gym") == "gym":
        gym_list = store.gyms()
        if gym_id is None:
            gym = gyms.default_gym(store, gym_list, create=True)
        else:
            gym = next((g for g in gym_list if g["id"] == gym_id), None)
            if gym is None:
                raise ValueError(f"gym {gym_id} not found")
    row = goals.validate_goal(kind, grade, climb_mode, band, target_pace, target_date, today,
                              grade_system=grade_system, gym=gym)
    if kind == "run_pace":
        since = (today - timedelta(days=goals.NOW_DAYS)).isoformat()
        row["start_pace"] = goals.start_pace(store.sessions_since(since), band, today)
    row["created_on"] = today.isoformat()
    return store.insert_goal(row)


def _pause_days(store: Store, since: date, today: date) -> tuple[frozenset, dict | None]:
    """Days to leave out of trends and the ratio, and the pause that is on now.
    A store without pauses (the eval runner's) has neither."""
    pauses_since = getattr(store, "pauses_since", None)
    if pauses_since is None:
        return frozenset(), None
    rows = pauses_since(since.isoformat())
    active = next((p for p in rows if not p.get("ended_on")), None)
    return pauses.excluded_days(rows, today), active


def calculate_progression(store: Store, weeks: int = 8, today: date | None = None) -> dict:
    """Per-sport progression for the current calendar week (Monday start,
    partial) and the `weeks - 1` before it, with a trend per metric. See
    progression.py for the metrics and the trend rule."""
    if not 1 <= weeks <= 26:
        raise ValueError("weeks must be between 1 and 26")
    today = today or date.today()
    start = today - timedelta(days=today.weekday() + 7 * (weeks - 1))
    windows = progression.Windows(today)
    since = min(start, windows.baseline_start).isoformat()
    shown = [start + timedelta(days=7 * i) for i in range(weeks)]
    excluded, _ = _pause_days(store, windows.baseline_start, today)
    climbs = [dict(c) for c in store.climbs_since(since)]
    scale = grades.annotate(climbs, store.gyms())
    result = progression.calculate(store.sessions_since(since), climbs, shown, today, excluded)
    # How many days of the trend windows a pause (or a fresh start) left out.
    result["paused_days"] = sum(1 for d in excluded if windows.baseline_start <= d <= today)
    climbing = result["climbing"]
    # Grade numbers are levels on this scale: 1 = its first grade (#98).
    climbing["grade_scale"] = list(scale.names)
    climbing["grade_scale_detail"] = scale.detail()
    climbing["grade_scale_gym"] = next((g["name"] for g in store.gyms() if g["id"] == scale.gym_id),
                                       None) if scale.gym_id is not None else None
    for key in ("avg_session_hardest_sent", "avg_session_flash_grade"):
        t = climbing["trends"][key]
        t["recent_grade"] = scale.nearest(t["recent"])
        t["baseline_grade"] = scale.nearest(t["baseline"])
    return {"weeks": weeks, "today": today.isoformat(),
            "trend_rule": progression.TREND_RULE, **result}


def nearest_grade(ordinal: float | None) -> str | None:
    """The "My gym" colour whose position is closest to an average, halves
    rounding up (4.5 -> red). Python's round() would send 4.5 down to purple."""
    return grades.gym_scale(grades.legacy_gym()).nearest(ordinal)


def derived_metrics(session: dict) -> dict:
    """Values computed from stored facts. Never written to the database."""
    metrics = {"load": session_load(session)}
    if session.get("distance_km"):
        metrics["pace_min_per_km"] = round(session["duration_min"] / session["distance_km"], 2)
    climbs = session.get("climbs", [])
    if climbs:
        sent = [c for c in climbs if c["sent"]]
        metrics["climbs_sent"] = len(sent)
        if sent:
            def hardness(c: dict) -> tuple[float, float]:
                level, index = grades.level_of(c), c.get("index")
                return (level if level is not None else -99, index if index is not None else -99)
            metrics["hardest_sent_grade"] = max(sent, key=hardness)["grade"]
    return metrics


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"date must be YYYY-MM-DD, got {value!r}") from None


# JSON schemas sent to Claude. The descriptions are prompts: they tell the
# model when and how to call each tool.
TOOLS = [
    {
        "name": "log_session",
        "description": (
            "Store one completed training session. Call this when the user describes "
            "a workout they did. Only include fields the user actually stated; never "
            "guess numbers. Use running fields only for running. For climbing, list "
            "each climb the user mentions in `climbs`, all in this one call. If the "
            "session fits one of the user's templates (list_templates), pass its "
            "template_id and the fields they stated in `values`."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sport": {"type": "string", "enum": list(SPORTS)},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "duration_min": {"type": "integer", "minimum": 1},
                "effort": {"type": "integer", "minimum": 1, "maximum": 10,
                           "description": "Perceived effort (RPE), 1 = very easy, 10 = max"},
                "notes": {"type": "string"},
                "distance_km": {"type": "number", "description": "Running only"},
                "elevation_m": {"type": "integer", "description": "Running only: elevation gain"},
                "tags": {
                    "type": "array",
                    "items": {"type": "string", "enum": list(TAGS)},
                    "description": "Optional context, only what the user said: 'slept badly' "
                                   "-> slept_badly, 'legs were sore' -> sore, 'felt strong' -> "
                                   "felt_strong, 'it was hot' -> hot, also tired and stressed. "
                                   "Leave out if not mentioned; never infer.",
                },
                "climbs": {
                    "type": "array",
                    "description": "Climbing only: one item per climb the user mentions. "
                                   "'3 blues' is three items.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "grade": {"type": "string",
                                      "description": "As the user said it: a colour of the "
                                                     "gym (grade_system gym; list_templates "
                                                     "has each gym's colours, My gym's are "
                                                     + ", ".join(GRADES) + "), or a V grade "
                                                     "such as V4, or a Font grade such as 6B+"},
                            "grade_system": {"type": "string", "enum": list(grades.SYSTEMS),
                                             "description": "gym (default) for a colour, v "
                                                            "or font outdoors or on a board"},
                            "gym_id": {"type": "integer",
                                       "description": "From list_templates, when the user "
                                                      "names a gym; leave out for the last "
                                                      "gym used, and outdoors"},
                            "style": {"type": "string", "enum": list(CLIMB_STYLES),
                                      "description": "boulder = gym boulder, kilter = Kilter "
                                                     "board, rope = top rope or lead"},
                            "sent": {"type": "boolean",
                                     "description": "true if topped, false if not (yet)"},
                            "attempts": {"type": "integer", "minimum": 1,
                                         "description": "Only if the user said; a flash is 1"},
                            "notes": {"type": "string"},
                        },
                        "required": ["grade", "style", "sent"],
                        "additionalProperties": False,
                    },
                },
                "template_id": {"type": "integer",
                                "description": "A template from list_templates whose sport and "
                                               "fields fit the session. Leave out for a plain "
                                               "run, climb, strength or other session; never "
                                               "invent one."},
                "values": {"type": "object",
                           "description": "The template's fields by key, only what the user "
                                          "stated: number (for a number field with measures, an "
                                          "object of measure key to number, only the measures "
                                          "the user gave: 'pull-ups +10 kg, 5 reps, 3 sets' -> "
                                          "{kg: 10, reps: 5, sets: 3}), option value (a list when the field "
                                          "is multiple), true/false, text, or for sets a list of "
                                          "{sets, reps, load, <extra keys>} rows, one per group "
                                          "of identical sets ('6 x 10 s on 20 mm with +10 kg' -> "
                                          "{sets: 6, reps: 10, edge_mm: 20, load: 10})."},
            },
            "required": ["sport", "date", "duration_min", "effort"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_history",
        "description": (
            "Get logged sessions from the last N days, including computed load "
            "(minutes x effort), running pace, and for climbing the individual climbs "
            "with the hardest sent grade. Use this before answering questions about "
            "past training or climbing progression."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "minimum": 1}},
            "required": ["days"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_training_load",
        "description": (
            "Get training load across all sports: session-RPE load (minutes x effort, "
            "Foster et al. 2001) per day and per calendar week (Monday start, current week "
            "is partial), and the acute:chronic workload ratio (average daily load over "
            "the last 7 days / last 28 days). Use this when the user asks about load, "
            "fatigue, how hard a week was, whether to train harder or rest, or injury "
            "risk. The ratio is only a rough warning signal of how this week compares with "
            "the last four: never call any range of it safe, never present it as an injury "
            "risk or prediction, and don't quote a 'sweet spot' as fact (the research behind "
            "such bands is weak; Impellizzeri 2020). ratio_status is \"not_enough_data\" when under 28 days have "
            "passed since the first logged session (history_days); then don't interpret "
            "the ratio, say there isn't enough history yet. ratio_status is \"paused\" "
            "while the user has paused tracking (`pause`); then don't interpret it either. "
            "Paused days (`paused_days`) are left out of both averages."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"weeks": {"type": "integer", "minimum": 1, "maximum": 12,
                                     "description": "Calendar weeks to show, default 4"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "calculate_progression",
        "description": (
            "Measure whether the user is improving, per sport, from logged data. Running "
            "per calendar week: runs, distance, duration, pace (min/km) overall and per "
            "distance band (under_7km, 7_to_15km, over_15km). Climbing per week: climbs, "
            "hardest sent grade, flash grade (sent with attempts = 1), send rate per "
            "grade. Each sport has `last_session` and `days_since_last_session`: use "
            "these, not the weekly rows, for when the user last trained. Each metric has a trend (improving / flat / declining / not enough "
            "data) comparing the last 14 days with the 28 before, with the recent and "
            "baseline values and how many sessions each is based on; `trend_rule` gives "
            "the exact rule. Climbing grade trends are averages of grade ordinals on "
            "`grade_scale` (1 = yellow), with the nearest grade in `recent_grade` and "
            "`baseline_grade`: name grades only with those fields, never by mapping "
            "the numbers yourself. Use this whenever the user asks if they are "
            "improving, getting faster or stronger, or how they are progressing. Quote "
            "the actual numbers. Prefer pace per distance band over overall pace, which "
            "mixes short and long runs. If a trend is 'not enough data', say so plainly "
            "and do not guess. Never claim progress the numbers do not show."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"weeks": {"type": "integer", "minimum": 1, "maximum": 26,
                                     "description": "Calendar weeks to show, default 8"}},
            "additionalProperties": False,
        },
    },
]


SET_GOAL = {
    "name": "set_goal",
    "description": (
        "Add an outcome goal the user asked for, e.g. 'set a goal to send a red by March' or "
        "'I want to run 7-15 km under 5:00 per km'. Only when the user clearly asks for a "
        "goal; never invent one. Two kinds: climb_grade (grade + climb_mode send or flash) "
        "and run_pace (band + target_pace in min/km, e.g. 5:00 = 5.0, 4:45 = 4.75). "
        "target_date is optional (YYYY-MM-DD). Afterwards say the goal was added and that "
        "it can be changed or let go at any time on the Dashboard."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": list(goals.KINDS)},
            "grade": {"type": "string",
                      "description": "A gym colour (My gym: " + ", ".join(GRADES) + "), or with "
                                     "grade_system v or font a V or Font grade"},
            "grade_system": {"type": "string", "enum": list(grades.SYSTEMS),
                             "description": "gym (default), v or font. An equally hard climb "
                                            "at any gym or outdoors reaches the goal"},
            "gym_id": {"type": "integer", "description": "The gym of a colour goal, from "
                                                         "list_templates; default the last gym used"},
            "climb_mode": {"type": "string", "enum": ["send", "flash"]},
            "band": {"type": "string", "enum": list(goals.BANDS),
                     "description": "Running distance band"},
            "target_pace": {"type": "number", "description": "min/km, e.g. 5.0"},
            "target_date": {"type": "string", "description": "YYYY-MM-DD, optional"},
        },
        "required": ["kind"],
        "additionalProperties": False,
    },
}

GET_GOALS = {
    "name": "get_goals",
    "description": (
        "Get the user's outcome goals with progress: for a grade goal the hardest grade "
        "reached as steps on the scale; for a pace goal the pace at the start, now (last 28 "
        "days) and the target. Use this when the user asks about their goals or how close "
        "they are. A goal is never 'failed': if `overdue`, say the date has passed and that "
        "they can keep it, move the date or let it go."
    ),
    "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
}

GET_TAG_PATTERNS = {
    "name": "get_tag_patterns",
    "description": (
        "See which context tags the user added to sessions (slept_badly, sore, tired, "
        "felt_strong, hot, stressed) often go with their weakest sessions: the slowest third "
        "of runs, and the climbing sessions with the lowest hardest send. Use this when the "
        "user asks why some sessions went worse, or what affects their training. Report only "
        "`patterns`, as counts, e.g. 'three of your four slowest runs had Slept badly'. Say "
        "the two often go together; never say one causes the other. If `enough_data` is "
        "false or there are no patterns, say there isn't enough to see a pattern yet."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"days": {"type": "integer", "minimum": 7, "maximum": 365,
                                "description": "How far back to look, default 56"}},
        "additionalProperties": False,
    },
}

LIST_TEMPLATES = {
    "name": "list_templates",
    "description": (
        "Get the user's log templates (custom forms per kind of session, with each field's "
        "key, label, type, unit and options) and gyms (each with its colours easiest first "
        "and their approximate V range), and the gym used last. Call it before logging or "
        "drafting anything that isn't a plain run or climb (fingerboard, strength, intervals, "
        "mobility...), or when the user names a gym or a colour you don't know. If one "
        "template clearly fits, use it; if two could fit, ask which; if none fits, log "
        "without a template. Tell the user which template you used."
    ),
    "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
}

_TARGET = {
    "type": "object",
    "description": "All optional. duration_min and effort (1-10) give planned load; running needs "
                   "distance_km so the load rules can be checked; climbing may list grades; a "
                   "templated session puts its field values in `values`, in the template's shape",
    "properties": {
        "duration_min": {"type": "integer", "minimum": 1, "maximum": 600},
        "effort": {"type": "integer", "minimum": 1, "maximum": 10},
        "distance_km": {"type": "number"},
        "session_type": {"type": "string", "enum": list(plans.RUN_TYPES),
                         "description": "Running: easy, long, strides, intervals, tempo or recovery"},
        "workout": {"type": "string", "description": "Concrete content, required for intervals and tempo, "
                                                     "e.g. '6 x 800 m at 10 km pace, 90 s jog rest' or "
                                                     "'20 min at tempo effort between 10 min easy'"},
        "grades": {"type": "array", "items": {
            "type": "object",
            "properties": {"system": {"type": "string", "enum": list(grades.SYSTEMS)},
                           "grade": {"type": "string"}, "count": {"type": "integer"},
                           "gym_id": {"type": "integer"}},
            "required": ["grade"]}},
        "values": {"type": "object"},
    },
    "additionalProperties": False,
}

PROPOSE_PROGRAM = {
    "name": "propose_program",
    "description": (
        "Propose a training plan of 4-12 weeks, ONLY when the user asks for a plan. Nothing is "
        "stored: the app shows it as a card with Accept, Dismiss and View plan, and only the "
        "user's Accept saves it, whatever their settings. So call it a proposal; never say it is "
        "saved, scheduled or set up. Start on a Monday. BEFORE calling it you need, from the user "
        "or their training profile (never guessed): sessions_per_week, available_days, and "
        "injury_or_pain ('none' if they said none). Left out, the profile's values are used, so ask "
        "only for what neither gives; check current form with get_training_load or get_history. If any is missing, "
        "ask for all of it in one short message instead of calling. Put what the user said that "
        "shaped the plan in user_said (short quotes, e.g. 'I have sore calves', '3 days a week'); "
        "the card shows them, and the rationale must reflect them. With injury or pain, be "
        "conservative, never diagnose, and suggest a physiotherapist if it persists. Every session "
        "needs duration_min and effort; every run a session_type. START NEAR CURRENT FORM: week 1's "
        "long run about the recent longest run and its volume about the recent weekly average "
        "(`capacity` gives the 'at least' values); the load rules cap increases, they are never a "
        "reason to start lower. Runs the user says they did in the last 30 days but didn't log go in "
        "recent_runs and count as the baseline (say so in the reason); older achievements (PBs, races "
        "before an injury) don't raise it, which you explain in one sentence. A running plan of 3+ "
        "runs a week mixes most volume easy, one long run and one or two quality sessions (strides, "
        "tempo or intervals) with a concrete workout; without pain, every build week with 3+ runs "
        "needs one. With pain or injury: no hard sessions in week 1, none at all above 2/10, and "
        "later ones only while pain stays at or below 2/10; set pain_level and say this in the "
        "reason. No quality session in the last days before a goal date. (L8 has no sourced numbers: "
        "don't quote any.) NEVER change the user's goal (e.g. half marathon to 5 km) without asking: "
        "if it can't be fully reached, propose the best plan toward it and say what is realistic. "
        "With a goal_id whose date is 4-12 weeks away, "
        "leave out weeks: the goal's date sets the end. One plan at a time: if the user has "
        "one, this fails and they can leave or finish it in the Plan view. The server checks "
        "the sourced load rules (`rules_applied`: L1a longest run, L1b weekly running increase, "
        "L2 lighter week every 4th week) and refuses a proposal that breaks one, listing why "
        "and the `capacity` the rules allow: then change the plan, never the rules. If the "
        "goal can't be fully built up in time within the rules, say so plainly and propose "
        "what the rules allow. Put the key reasons in `rationale` (max 300 characters), citing "
        "the rule and principle, e.g. 'runs grow at most 10% (L1a, P31)'. Rules marked needs "
        "source (taper, combining sports, finger load) have no number: don't invent one. Call "
        "list_templates first for templated sessions such as hangboard."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Short, e.g. '6 weeks to a red'"},
            "start_date": {"type": "string", "description": "A Monday, YYYY-MM-DD, this week or later"},
            "weeks": {"type": "integer", "minimum": 4, "maximum": 12},
            "goal_id": {"type": "integer", "description": "From get_goals"},
            "week_meta": {"type": "array", "items": {
                "type": "object",
                "properties": {"index": {"type": "integer"},
                               "kind": {"type": "string", "enum": ["build", "deload", "taper", "test"]},
                               "note": {"type": "string"}},
                "required": ["index", "kind"]},
                "description": "Weeks left out are build weeks"},
            "rationale": {"type": "string"},
            "sessions_per_week": {"type": "integer", "minimum": 1, "maximum": 14,
                                  "description": "As the user said; ask if unknown"},
            "available_days": {"type": "array", "items": {"type": "string"},
                               "description": "Weekday names the user can train, e.g. ['tuesday', 'thursday', 'saturday']"},
            "injury_or_pain": {"type": "string",
                               "description": "What the user said about injury or pain, or 'none'; an "
                                              "active injury pause is checked automatically"},
            "user_said": {"type": "array", "items": {"type": "string"}, "maxItems": 5,
                          "description": "Short quotes from the user that shaped the plan"},
            "pain_level": {"type": "integer", "minimum": 0, "maximum": 10,
                           "description": "The pain the user reported, 0-10, if they gave one (the profile's is used otherwise)"},
            "recent_runs": {"type": "array", "maxItems": 10, "items": {
                "type": "object",
                "properties": {"km": {"type": "number"},
                               "days_ago": {"type": "integer", "minimum": 0, "maximum": 30}},
                "required": ["km", "days_ago"]},
                "description": "Runs the user says they did in the last 30 days but didn't log; they "
                               "count as the P31 baseline. Never PBs or older races"},
            "sessions": {"type": "array", "items": {
                "type": "object",
                "properties": {"date": {"type": "string"}, "sport": {"type": "string", "enum": list(SPORTS)},
                               "title": {"type": "string"}, "template_id": {"type": "integer"},
                               "target": _TARGET},
                "required": ["date", "sport", "title"]}},
        },
        "required": ["name", "start_date", "rationale", "sessions"],
        "additionalProperties": False,
    },
}

GET_PLAN = {
    "name": "get_plan",
    "description": (
        "Get the user's current plan (active or paused): weeks, planned load per week, and this "
        "week's and next week's planned sessions with their status (done, today, upcoming, "
        "not_done, skipped, paused). Use it before answering 'what should I do today?' or "
        "before proposing a plan. 'not_done' is neutral: never count it against the user."
    ),
    "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
}

PROPOSE_PROFILE_UPDATE = {
    "name": "propose_profile_update",
    "description": (
        "Propose a change to the user's training profile (shown in the system prompt), e.g. "
        "after they say 'I can only train twice a week now' or 'my knee hurts, about 4 out of 10'. "
        "Nothing is stored: the app shows the change with Save and Dismiss, and only the user's "
        "Save stores it, whatever their settings. Include only the fields that change, with what "
        "the user said; never guess. injuries replaces the whole list, so include the ones that "
        "stay. Never diagnose: record the body part, pain 0-10 and their own words. Afterwards "
        "say the change is ready to save, never that it is saved."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "longest_run_km": {"type": "number"},
            "weekly_run_km": {"type": "number"},
            "climbing_level": {"type": "string", "description": "In their words, e.g. 'projecting V5'"},
            "sessions_per_week": {"type": "integer", "minimum": 1, "maximum": 14},
            "preferred_days": {"type": "array", "items": {"type": "string"}},
            "injuries": {"type": "array", "items": {
                "type": "object",
                "properties": {"body_part": {"type": "string"},
                               "pain": {"type": "integer", "minimum": 0, "maximum": 10},
                               "note": {"type": "string"}},
                "required": ["body_part"]}},
            "other_sports": {"type": "string"},
            "goals_note": {"type": "string"},
        },
        "additionalProperties": False,
    },
}

TOOLS += [SET_GOAL, GET_GOALS, GET_TAG_PATTERNS, LIST_TEMPLATES, PROPOSE_PROGRAM, GET_PLAN,
          PROPOSE_PROFILE_UPDATE]

DRAFT_SESSION = {
    "name": "draft_session",
    "description": (
        "Prepare one completed training session the user described, for them to confirm. "
        "Nothing is stored: the app shows it as a draft with Save and Review buttons. "
        "Call this when the user describes a workout they did. Only include fields the user "
        "actually stated; never guess numbers. Use running fields only for running. For "
        "climbing, list each climb the user mentions in `climbs`, all in this one call. "
        "Afterwards say the session is ready to save or review; never say it is logged."
    ),
    "input_schema": TOOLS[0]["input_schema"],  # exactly log_session's fields and rules
}

LOG_SESSION_DISABLED = {
    **TOOLS[0],
    "description": (
        "Not available: in this app the user saves sessions themselves. Use draft_session "
        "for a session the user describes."
    ),
}


def tools_for(auto_save: bool) -> list[dict]:
    """The tools offered for one chat turn. With auto_save (the user's setting
    "Save chat sessions without asking") the agent stores sessions itself, as
    before N4. Otherwise it drafts them; log_session stays defined, because
    earlier turns in a saved history may call it, but it is marked unavailable
    and run_turn refuses it."""
    if auto_save:
        return TOOLS
    return [LOG_SESSION_DISABLED, DRAFT_SESSION, *TOOLS[1:]]


def run_tool(store: Store, name: str, tool_input: dict) -> str:
    """Dispatch a tool call from Claude and return the result as JSON text."""
    if name == "log_session":
        result = log_session(store, **tool_input)
    elif name == "draft_session":
        result = draft_session(store, **tool_input)
    elif name == "get_history":
        result = get_history(store, **tool_input)
    elif name == "get_training_load":
        result = get_training_load(store, **tool_input)
    elif name == "calculate_progression":
        result = calculate_progression(store, **tool_input)
    elif name == "set_goal":
        result = set_goal(store, **tool_input)
    elif name == "get_goals":
        result = list_goals(store, **tool_input)
    elif name == "get_tag_patterns":
        result = tag_patterns(store, **tool_input)
    elif name == "list_templates":
        result = templates_for_coach(store, **tool_input)
    elif name == "propose_program":
        result = plans.propose_program(store, **tool_input)
    elif name == "get_plan":
        result = plans.plan_for_coach(store, **tool_input)
    elif name == "propose_profile_update":
        result = training_profile.propose_update(store, **tool_input)
    else:
        raise ValueError(f"unknown tool {name!r}")
    return json.dumps(result)
