"""The user's gyms and their colour circuits (#98, docs/custom-log-forms.md 3.4).

A gym has an ordered list of colours, easiest first. Each colour has a name,
a swatch from grades.PALETTE and optionally an approximate range, entered as
V or Font grades (the gym's `range_system`) and stored as index values. A
colour that climbs or goals use can be archived but not deleted (the database
refuses it), so old climbs keep their name.
"""

import grades

MAX_GRADES = 20


def _range(system: str, value) -> tuple[float, float] | tuple[None, None]:
    """[low, high] as grades in `system` -> index values. None or [] -> no range."""
    if not value:
        return None, None
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError("range must be [lowest, highest], e.g. ['V1', 'V3']")
    low, high = (grades.index_of(system, v) for v in value)
    if low > high:
        raise ValueError(f"range {value[0]}–{value[1]} goes down; give the easiest first")
    return low, high


def _colour(value) -> str:
    text = str(value or "").strip().lower()
    if text in grades.PALETTE:
        return grades.PALETTE[text]
    if text in grades.PALETTE.values():
        return text
    raise ValueError(f"colour must be one of {list(grades.PALETTE)}, got {value!r}")


def validate_gym(name: str, range_system: str = "v", colours: list[dict] | None = None) -> tuple[dict, list[dict]]:
    """The gym row and its colour rows, in order, from what the app sent.

    Each colour: {id?, name, colour, range?: [low, high], archived?: bool}. The
    order of the colours that aren't archived is the order on the wall."""
    name = str(name or "").strip()
    if not 1 <= len(name) <= 60:
        raise ValueError("gym name must be 1 to 60 characters")
    if range_system not in grades.RANGE_SYSTEMS:
        raise ValueError(f"range_system must be one of {grades.RANGE_SYSTEMS}")
    colours = colours or []
    active = [c for c in colours if not c.get("archived")]
    if not 1 <= len(active) <= MAX_GRADES:
        raise ValueError(f"a gym needs 1 to {MAX_GRADES} colours")
    rows, seen = [], set()
    for c in active + [c for c in colours if c.get("archived")]:
        # range_text is what view() returns; it is ignored, so a gym round-trips.
        unexpected = set(c) - {"id", "name", "colour", "range", "archived", "range_text"}
        if unexpected:
            raise ValueError(f"unknown colour fields: {sorted(unexpected)}")
        label = str(c.get("name") or "").strip().lower()
        if not 1 <= len(label) <= 24:
            raise ValueError("each colour needs a name of 1 to 24 characters")
        if not c.get("archived"):
            if label in seen:
                raise ValueError(f"two colours are called {label!r}")
            seen.add(label)
        low, high = _range(range_system, c.get("range"))
        rows.append({"id": c.get("id"), "name": label, "colour": _colour(c.get("colour")),
                     "range_low": low, "range_high": high, "archived": bool(c.get("archived"))})
    for position, row in enumerate(rows, start=1):
        row["position"] = position
    return {"name": name, "range_system": range_system}, rows


def view(gym: dict) -> dict:
    """A gym as the API returns it: colours easiest first, with range labels."""
    system = gym.get("range_system") or "v"
    ordered = sorted(gym["grades"], key=lambda g: (bool(g.get("archived_at")), g["position"]))
    return {"id": gym["id"], "name": gym["name"], "range_system": system,
            "archived": bool(gym.get("archived_at")),
            "colours": [{"id": g["id"], "name": g["name"], "colour": g["colour"],
                         "range": ([grades.label(system, float(g["range_low"])),
                                    grades.label(system, float(g["range_high"]))]
                                   if g.get("range_low") is not None else None),
                         "range_text": grades.range_text(g, system),
                         "archived": bool(g.get("archived_at"))} for g in ordered]}


def list_gyms(store) -> dict:
    """The user's gyms for the app, and the one used last (the Log form's default)."""
    return {"gyms": [view(g) for g in store.gyms()], "last_gym_id": store.last_gym_id()}


def create_gym(store, name: str, range_system: str = "v", colours: list[dict] | None = None) -> dict:
    row, rows = validate_gym(name, range_system, colours)
    if any(r["id"] for r in rows):
        raise ValueError("a new gym's colours have no ids")
    return view(store.insert_gym(row, rows))


def update_gym(store, gym_id: int, changes: dict) -> dict:
    """Change a gym. `colours`, if given, is the whole new list (as `view`
    returns it, with ids for the colours that stay). LookupError if not found."""
    current = next((g for g in store.gyms() if g["id"] == gym_id), None)
    if current is None:
        raise LookupError(f"gym {gym_id} not found")
    unexpected = set(changes) - {"name", "range_system", "archived", "colours"}
    if unexpected:
        raise ValueError(f"unknown gym fields: {sorted(unexpected)}")
    name = changes.get("name", current["name"])
    system = changes.get("range_system", current["range_system"])
    if "colours" in changes:
        colours = changes["colours"]
    else:  # re-validate the stored colours, e.g. after a new name or range system
        colours = [{k: c[k] for k in ("id", "name", "colour", "range", "archived")}
                   for c in view(current)["colours"]]
        colours = [{**c, "range": c["range"] and [grades.label(system, grades.index_of(
            current["range_system"], v)) for v in c["range"]]} for c in colours]
    row, rows = validate_gym(name, system, colours)
    if "archived" in changes:
        row["archived"] = bool(changes["archived"])
    updated = store.update_gym(gym_id, row, rows if "colours" in changes else None)
    if updated is None:
        raise LookupError(f"gym {gym_id} not found")
    return view(updated)


def delete_gym(store, gym_id: int) -> None:
    """Delete an unused gym. LookupError if not found, ValueError if used."""
    if not store.delete_gym(gym_id):
        raise LookupError(f"gym {gym_id} not found")


def default_gym(store, gyms: list[dict], *, create: bool) -> dict:
    """The gym a colour climb without a gym_id goes to: the last one used, else
    the first, else a new "My gym" (only created when `create`; a draft gets
    the same gym without an id, and saving it creates it)."""
    live = [g for g in gyms if not g.get("archived_at")]
    last = store.last_gym_id()
    for g in live:
        if g["id"] == last:
            return g
    if live:
        return live[0]
    if not create:
        return grades.legacy_gym()
    row, colours = validate_gym(grades.DEFAULT_GYM_NAME, "v", [
        {"name": n, "colour": c, "range": [grades.label("v", lo), grades.label("v", hi)]}
        for n, c, lo, hi in grades.LEGACY_CIRCUIT])
    gym = store.insert_gym(row, colours)
    gyms.append(gym)
    return gym
