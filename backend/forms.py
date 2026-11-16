"""Session templates: typed log forms per sport (#100, docs/custom-log-forms.md 3.2-3.3).

A template adds fields after the core fields every session has (date,
duration, effort, notes, tags), which stay outside the schema because load is
duration x effort. Its `fields` are a typed schema stored as jsonb; a session
that uses it keeps `template_id` and its `custom_values` by field key.

Every rule lives here and is used by every writer (the Log form's API, edits
and the agent's log_session and draft_session). The database only checks
shapes and sizes. Errors name the field by its label, so the app can show them
and the agent can correct itself.

Edits never change what a stored value means: a field's key, type and units
are fixed once saved; used fields and options are archived, not removed.
"""

import json
import re

SPORTS = ("running", "climbing", "strength", "other")
FIELD_TYPES = ("number", "select", "boolean", "text", "sets", "climbs")
CORE_FIELDS = {"running": ("distance_km", "elevation_m")}  # optional built-ins a template may show
CLIMB_STYLES = ("boulder", "kilter", "rope")

MAX_FIELDS = 20
MAX_VALUES_BYTES = 16384
KEY = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
SET_KEYS = ("sets", "reps", "load")
MAX_SET_ROWS = 30
NUMBER_LIMIT = 1_000_000

COMMON = {"key", "label", "type", "required", "help", "archived"}
EXTRA_PROPS = {
    "number": {"unit", "min", "max", "decimals"},
    "select": {"options", "multiple"},
    "boolean": set(),
    "text": {"max_length"},
    "sets": {"reps_unit", "load_unit", "load_signed", "extras"},
    "climbs": {"default_style"},
}
# Fixed once the template is saved: changing them would change old values' meaning.
FIXED = ("type", "unit", "reps_unit", "load_unit", "multiple")


def _num(value, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{what} must be a number")
    if abs(value) > NUMBER_LIMIT:
        raise ValueError(f"{what} is too large")
    return value


def _text(value, what: str, longest: int, *, optional: bool = False) -> str | None:
    if value is None and optional:
        return None
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= longest:
        raise ValueError(f"{what} must be 1 to {longest} characters")
    return value.strip()


def slug(label: str) -> str:
    """A field key made from its first label: 'Added load (kg)' -> 'added_load_kg'."""
    key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    if not key or not key[0].isalpha():
        key = f"f_{key}" if key else "field"
    return key[:32]


def _limits(f: dict, what: str) -> dict:
    out = {}
    for k in ("min", "max"):
        if f.get(k) is not None:
            out[k] = _num(f[k], f"{what} {k}")
    if "min" in out and "max" in out and out["min"] > out["max"]:
        raise ValueError(f"{what}: min is above max")
    decimals = f.get("decimals", 0)
    if isinstance(decimals, bool) or decimals not in (0, 1, 2):
        raise ValueError(f"{what}: decimals must be 0, 1 or 2")
    out["decimals"] = decimals
    return out


def _field(f: dict, sport: str) -> dict:
    if not isinstance(f, dict):
        raise ValueError("each field must be an object")
    kind = f.get("type")
    if kind not in FIELD_TYPES:
        raise ValueError(f"field type must be one of {FIELD_TYPES}, got {kind!r}")
    unexpected = set(f) - COMMON - EXTRA_PROPS[kind]
    if unexpected:
        raise ValueError(f"unknown properties for a {kind} field: {sorted(unexpected)}")
    label = _text(f.get("label"), "a field label", 40)
    what = f"Field {label!r}"
    key = f.get("key") or slug(label)
    if not isinstance(key, str) or not KEY.match(key):
        raise ValueError(f"{what}: key must be lower case letters, digits and _, starting with a letter")
    out = {"key": key, "label": label, "type": kind, "required": bool(f.get("required", False)),
           "archived": bool(f.get("archived", False))}
    if f.get("help") is not None:
        out["help"] = _text(f["help"], f"{what} help", 80)

    if kind == "number":
        unit = f.get("unit")
        if unit is not None:
            out["unit"] = _text(unit, f"{what} unit", 8)
        out.update(_limits(f, what))
    elif kind == "select":
        options = f.get("options")
        if not isinstance(options, list) or not 2 <= len(options) <= 12:
            raise ValueError(f"{what}: a select needs 2 to 12 options")
        seen, opts = set(), []
        for o in options:
            if not isinstance(o, dict) or set(o) - {"value", "label", "archived"}:
                raise ValueError(f"{what}: each option is {{value, label, archived?}}")
            olabel = _text(o.get("label"), f"{what} option label", 40)
            value = o.get("value") or slug(olabel)
            if not isinstance(value, str) or not KEY.match(value) or value in seen:
                raise ValueError(f"{what}: option values must be unique keys")
            seen.add(value)
            opts.append({"value": value, "label": olabel, "archived": bool(o.get("archived", False))})
        out["options"] = opts
        out["multiple"] = bool(f.get("multiple", False))
    elif kind == "text":
        longest = f.get("max_length", 200)
        if isinstance(longest, bool) or not isinstance(longest, int) or not 1 <= longest <= 500:
            raise ValueError(f"{what}: max_length must be 1 to 500")
        out["max_length"] = longest
    elif kind == "sets":
        if f.get("reps_unit", "reps") not in ("reps", "s"):
            raise ValueError(f"{what}: reps_unit must be 'reps' or 's'")
        if f.get("load_unit") not in (None, "kg", "lb"):
            raise ValueError(f"{what}: load_unit must be 'kg', 'lb' or none")
        out["reps_unit"] = f.get("reps_unit", "reps")
        out["load_unit"] = f.get("load_unit")
        out["load_signed"] = bool(f.get("load_signed", False))
        extras = f.get("extras") or []
        if not isinstance(extras, list) or len(extras) > 2:
            raise ValueError(f"{what}: up to 2 extra columns")
        cols, keys = [], set(SET_KEYS)
        for e in extras:
            if not isinstance(e, dict) or set(e) - {"key", "label", "unit", "min", "max", "decimals"}:
                raise ValueError(f"{what}: each extra column is {{key, label, unit, min, max, decimals}}")
            elabel = _text(e.get("label"), f"{what} column label", 40)
            ekey = e.get("key") or slug(elabel)
            if not isinstance(ekey, str) or not KEY.match(ekey) or ekey in keys:
                raise ValueError(f"{what}: column keys must be unique and not sets, reps or load")
            keys.add(ekey)
            col = {"key": ekey, "label": elabel, **_limits(e, f"{what} column {elabel!r}")}
            if e.get("unit") is not None:
                col["unit"] = _text(e["unit"], f"{what} column unit", 8)
            cols.append(col)
        out["extras"] = cols
    elif kind == "climbs":
        if sport != "climbing":
            raise ValueError("a climbs field is only for climbing templates")
        style = f.get("default_style", "boulder")
        if style not in CLIMB_STYLES:
            raise ValueError(f"{what}: default_style must be one of {CLIMB_STYLES}")
        out["default_style"] = style
    return out


def validate_template(name: str, sport: str, fields: list, core_fields: list | None = None,
                      previous: dict | None = None, used_keys: set | None = None) -> dict:
    """The template row from what the app or a starter sent, or ValueError.

    With `previous` (the stored template) and `used_keys` (keys that sessions
    have values for), the edit rules apply: fixed properties stay, a used
    field or option can be archived but not removed, and a used template keeps
    its sport."""
    name = _text(name, "template name", 40)
    if sport not in SPORTS:
        raise ValueError(f"sport must be one of {SPORTS}, got {sport!r}")
    core = list(core_fields or [])
    bad = set(core) - set(CORE_FIELDS.get(sport, ()))
    if bad:
        raise ValueError(f"core fields not available for {sport}: {sorted(bad)}")
    if not isinstance(fields, list) or len(fields) > MAX_FIELDS:
        raise ValueError(f"a template has up to {MAX_FIELDS} fields")
    rows = [_field(f, sport) for f in fields]
    keys = [f["key"] for f in rows]
    if len(set(keys)) != len(keys):
        raise ValueError("two fields have the same key; give them different labels")
    if sum(f["type"] == "climbs" for f in rows) > 1:
        raise ValueError("a template has at most one climbs field")

    if previous is not None:
        used = used_keys or set()
        if used and sport != previous["sport"]:
            raise ValueError("a template that sessions use keeps its sport; make a new one")
        new_by_key = {f["key"]: f for f in rows}
        for old in previous["fields"]:
            new = new_by_key.get(old["key"])
            if new is None:
                if old["key"] in used:
                    raise ValueError(f"field {old['label']!r} has logged values; archive it instead")
                continue
            for prop in FIXED:
                if old.get(prop) != new.get(prop):
                    raise ValueError(f"field {old['label']!r}: {prop} can't change once saved; "
                                     "add a new field and archive this one")
            if old["type"] == "select":
                kept = {o["value"] for o in new["options"]}
                gone = [o["label"] for o in old["options"] if o["value"] not in kept]
                if gone and old["key"] in used:
                    raise ValueError(f"field {old['label']!r}: archive options instead of removing "
                                     f"them ({', '.join(gone)})")
            if old["type"] == "sets":
                old_cols = {c["key"]: c for c in old.get("extras", [])}
                for c in new.get("extras", []):
                    if c["key"] in old_cols and old_cols[c["key"]].get("unit") != c.get("unit"):
                        raise ValueError(f"field {old['label']!r}: a column's unit can't change")
                if old["key"] in used and set(old_cols) - {c["key"] for c in new.get("extras", [])}:
                    raise ValueError(f"field {old['label']!r}: a used column can't be removed")
    return {"name": name, "sport": sport, "core_fields": core, "fields": rows}


# --- Values ----------------------------------------------------------------------------

def _check_number(value, f: dict, what: str):
    _num(value, what)
    if "min" in f and value < f["min"] or "max" in f and value > f["max"]:
        unit = f" {f['unit']}" if f.get("unit") else ""
        lo, hi = f.get("min"), f.get("max")
        rng = (f"between {lo:g} and {hi:g}" if lo is not None and hi is not None
               else f"at least {lo:g}" if lo is not None else f"at most {hi:g}")
        raise ValueError(f"{what} must be {rng}{unit}")
    if round(value, f.get("decimals", 0)) != value:
        d = f.get("decimals", 0)
        raise ValueError(f"{what} takes {'whole numbers' if d == 0 else f'up to {d} decimals'}")
    return int(value) if f.get("decimals", 0) == 0 else value


def _check_rows(value, f: dict) -> list[dict]:
    label = f["label"]
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_SET_ROWS:
        raise ValueError(f"{label} needs 1 to {MAX_SET_ROWS} rows")
    extras = {c["key"]: c for c in f.get("extras", [])}
    allowed = {"sets", "reps"} | ({"load"} if f.get("load_unit") else set()) | set(extras)
    rows = []
    for i, row in enumerate(value, start=1):
        what = f"{label}, row {i}"
        if not isinstance(row, dict):
            raise ValueError(f"{what} must be an object")
        unexpected = set(row) - allowed
        if unexpected:
            raise ValueError(f"{what}: unknown columns {sorted(unexpected)}")
        out = {}
        for key, lo, hi in (("sets", 1, 20), ("reps", 1, 600)):
            if key not in row:
                raise ValueError(f"{what}: {key} is missing")
            v = row[key]
            if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
                noun = "seconds" if key == "reps" and f.get("reps_unit") == "s" else key
                raise ValueError(f"{what}: {noun} must be a whole number from {lo} to {hi}")
            out[key] = v
        if row.get("load") is not None:
            load = _num(row["load"], f"{what}: load")
            if not f.get("load_signed") and load < 0:
                raise ValueError(f"{what}: load can't be negative here")
            if abs(load) > 1000 or round(load, 2) != load:
                raise ValueError(f"{what}: load must be at most 1000 with up to 2 decimals")
            out["load"] = load
        for key, col in extras.items():
            if row.get(key) is not None:
                out[key] = _check_number(row[key], col, f"{what}: {col['label'].lower()}")
        rows.append(out)
    return rows


def validate_values(template: dict, values: dict | None, sport: str,
                    previous: dict | None = None) -> dict:
    """The custom values for a session using `template`, or ValueError.

    `previous` is the session's stored values on an edit: an archived field or
    option it already has may stay; a new session can't use them."""
    if sport != template["sport"]:
        raise ValueError(f"the {template['name']} template is for {template['sport']}, not {sport}")
    values = {} if values is None else values
    if not isinstance(values, dict):
        raise ValueError("values must be an object of field key to value")
    previous = previous or {}
    fields = {f["key"]: f for f in template["fields"] if f["type"] != "climbs"}
    unknown = sorted(set(values) - set(fields))
    if unknown:
        raise ValueError(f"no such fields in {template['name']}: {unknown}; "
                         f"fields: {[k for k, f in fields.items() if not f.get('archived')]}")
    out = {}
    for key, value in values.items():
        f = fields[key]
        if value is None:
            continue
        if f.get("archived") and previous.get(key) != value:
            raise ValueError(f"{f['label']} is archived and can't get new values")
        out[key] = _value(value, f, previous.get(key))
    for f in fields.values():
        if f.get("required") and not f.get("archived") and f["key"] not in out:
            raise ValueError(f"{f['label']} is required")
    if len(json.dumps(out)) > MAX_VALUES_BYTES:
        raise ValueError("the values are too large")
    return out


def _value(value, f: dict, previous):
    label = f["label"]
    kind = f["type"]
    if kind == "number":
        return _check_number(value, f, label)
    if kind == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"{label} must be yes or no (true or false)")
        return value
    if kind == "text":
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{label} must be text")
        if len(value.strip()) > f.get("max_length", 200):
            raise ValueError(f"{label} is longer than {f.get('max_length', 200)} characters")
        return value.strip()
    if kind == "select":
        live = {o["value"] for o in f["options"] if not o.get("archived")}
        kept = set(previous if isinstance(previous, list) else [previous] if previous else [])
        picked = value if f.get("multiple") else [value]
        if (not isinstance(picked, list) or not picked or not all(isinstance(v, str) for v in picked)
                or len(set(picked)) != len(picked)):
            if not f.get("multiple") and isinstance(value, list):
                raise ValueError(f"{label}: {value!r} is not an option; pick one: {sorted(live)}")
            raise ValueError(f"{label}: pick {'one or more options' if f.get('multiple') else 'one option'}")
        for v in picked:
            if v not in live and v not in kept:
                raise ValueError(f"{label}: {v!r} is not an option; options: {sorted(live)}")
        return picked if f.get("multiple") else value
    if kind == "sets":
        return _check_rows(value, f)
    raise ValueError(f"{label} takes no value here")  # pragma: no cover


# --- Reading ------------------------------------------------------------------------------

def _fmt(n) -> str:
    return f"{n:g}"


def sets_text(row: dict, f: dict) -> str:
    """'6 × 10 s · 20 mm · +10 kg' for one sets row."""
    reps = f"{row['reps']} s" if f.get("reps_unit") == "s" else str(row["reps"])
    parts = [f"{row['sets']} × {reps}"]
    for col in f.get("extras", []):
        if row.get(col["key"]) is not None:
            parts.append(f"{_fmt(row[col['key']])}{' ' + col['unit'] if col.get('unit') else ''}")
    if row.get("load") is not None:
        sign = "+" if f.get("load_signed") and row["load"] > 0 else ""
        parts.append(f"{sign}{_fmt(row['load'])} {f.get('load_unit') or ''}".rstrip())
    return " · ".join(parts)


def value_text(value, f: dict) -> str:
    kind = f["type"]
    if kind == "number":
        return f"{_fmt(value)}{' ' + f['unit'] if f.get('unit') else ''}"
    if kind == "boolean":
        return "Yes" if value else "No"
    if kind == "select":
        labels = {o["value"]: o["label"] for o in f["options"]}
        picked = value if isinstance(value, list) else [value]
        return ", ".join(labels.get(v, v) for v in picked)
    if kind == "sets":
        return "; ".join(sets_text(r, f) for r in value)
    return str(value)


def described(template: dict, values: dict) -> list[dict]:
    """The session's values in the template's order with labels, units and a
    text for each: what history, the coach and the draft card show."""
    out = []
    for f in template["fields"]:
        if f["type"] == "climbs" or values.get(f["key"]) is None:
            continue
        item = {"key": f["key"], "label": f["label"], "type": f["type"],
                "value": values[f["key"]], "text": value_text(values[f["key"]], f)}
        for prop in ("unit", "reps_unit", "load_unit"):
            if f.get(prop):
                item[prop] = f[prop]
        out.append(item)
    return out


# --- Starter templates (Q3) -----------------------------------------------------------

def _opts(*labels: str) -> list[dict]:
    return [{"label": label} for label in labels]


STARTERS: dict[str, dict] = {
    "Fingerboard": {"sport": "other", "fields": [
        {"label": "Protocol", "type": "select", "options": _opts("Max hangs", "Repeaters", "Density hangs")},
        {"label": "Grip", "type": "select", "multiple": True,
         "options": _opts("Half crimp", "Open hand", "Full crimp")},
        {"key": "hangs", "label": "Hangs", "type": "sets", "required": True, "reps_unit": "s",
         "load_unit": "kg", "load_signed": True,
         "extras": [{"key": "edge_mm", "label": "Edge", "unit": "mm", "min": 4, "max": 60}]},
        {"key": "rest_s", "label": "Rest between sets", "type": "number", "unit": "s", "min": 0, "max": 600},
        {"key": "finger_pain", "label": "Any finger pain?", "type": "boolean"},
    ]},
    "Strength": {"sport": "strength", "fields": [
        {"label": "Exercise", "type": "select",
         "options": _opts("Squat", "Deadlift", "Bench press", "Pull-up", "Overhead press", "Row")},
        {"key": "sets", "label": "Sets", "type": "sets", "required": True, "reps_unit": "reps",
         "load_unit": "kg", "load_signed": True},
    ]},
    "Intervals": {"sport": "running", "core_fields": ["distance_km"], "fields": [
        {"label": "Workout", "type": "select",
         "options": _opts("Track repeats", "Hill repeats", "Tempo blocks", "Fartlek")},
        {"key": "reps", "label": "Reps", "type": "number", "min": 1, "max": 50},
        {"key": "rep_m", "label": "Rep distance", "type": "number", "unit": "m", "min": 50, "max": 10000},
    ]},
    "Mobility": {"sport": "other", "fields": [
        {"label": "Focus", "type": "select", "multiple": True,
         "options": _opts("Hips", "Shoulders", "Ankles", "Spine", "Full body")},
        {"key": "routine", "label": "Routine", "type": "text", "max_length": 200},
    ]},
}


def starter(name: str) -> dict:
    """A starter's template row, validated like any other. KeyError if unknown."""
    s = STARTERS[name]
    return validate_template(name, s["sport"], s["fields"], s.get("core_fields"))


def view(template: dict) -> dict:
    """A template as the API returns it."""
    return {k: template[k] for k in ("id", "name", "sport", "core_fields", "fields")} | {
        "archived": bool(template.get("archived_at")), "position": template.get("position", 0)}
