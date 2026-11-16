"""Climbing grade systems and the common difficulty index (#98).

See docs/custom-log-forms.md, sections 3.4 and 3.5. A climb is graded in one
of three systems:

- gym:  a colour of one of the user's gyms (an ordered circuit, easiest first),
        optionally with an approximate range in difficulty-index values;
- v:    the V-scale, VB and V0-V17;
- font: Fontainebleau grades, 4 to 9A.

The difficulty index is a number on the V-scale (VB = -1, V0 = 0 ... V17 = 17).
Font maps onto it with the table below and a gym colour sits at the midpoint of
its range. It is computed when read and never stored, and never shown to the
user as a number.

Charts and trends show grades on one display scale: the user's most-used gym
(else the V-scale). A climb at the display gym is placed at its own position in
the circuit, so a user with only "My gym" gets exactly the numbers they had
before gyms existed. Climbs elsewhere are placed by their index, interpolated
between the display gym's colour midpoints.
"""

from dataclasses import dataclass, field

SYSTEMS = ("gym", "v", "font")
RANGE_SYSTEMS = ("v", "font")

V_INDEX: dict[str, float] = {"VB": -1.0, **{f"V{i}": float(i) for i in range(18)}}
FONT_INDEX: dict[str, float] = {
    "4": 0, "4+": 0.5, "5": 1, "5+": 2, "6A": 3, "6A+": 3.5, "6B": 4, "6B+": 4.5,
    "6C": 5, "6C+": 5.5, "7A": 6, "7A+": 7, "7B": 8, "7B+": 8.5, "7C": 9, "7C+": 10,
    "8A": 11, "8A+": 12, "8B": 13, "8B+": 14, "8C": 15, "8C+": 16, "9A": 17,
}
INDEX_BY_SYSTEM = {"v": V_INDEX, "font": FONT_INDEX}

# The seven colours the app had before gyms, easiest first, with their screen
# colours and the default ranges agreed in docs/custom-log-forms.md (Q2), as
# index values. Migration 20261116120100_climb_grade_systems.sql gives every
# existing user a gym "My gym" with exactly these rows (a test checks they match).
DEFAULT_GYM_NAME = "My gym"
LEGACY_CIRCUIT: tuple[tuple[str, str, float, float], ...] = (
    ("yellow", "#f2c230", -1, 0),
    ("green", "#3fae5f", 0, 1),
    ("blue", "#2f6fd6", 1, 3),
    ("purple", "#9440b8", 3, 4),
    ("red", "#c0302f", 4, 6),
    ("black", "#1a1a1a", 6, 8),
    ("white", "#ffffff", 8, 10),
)
LEGACY_COLOURS = tuple(name for name, *_ in LEGACY_CIRCUIT)

# Swatches a gym colour may use: the screen-safe grade colours (#55). New hues
# (orange, pink, grey) join only after the colour-blind checks.
PALETTE = {name: hex_ for name, hex_, *_ in LEGACY_CIRCUIT}


def normalise(system: str, grade: str) -> str:
    """A V or Font grade in its canonical spelling ('v4' -> 'V4', '6b+' -> '6B+').
    ValueError if it isn't one."""
    if system not in INDEX_BY_SYSTEM:
        raise ValueError(f"grade system must be one of {RANGE_SYSTEMS}, got {system!r}")
    text = str(grade).strip().upper().replace(" ", "")
    if system == "font":
        text = text.removeprefix("F").removeprefix("ONT")
    if text not in INDEX_BY_SYSTEM[system]:
        examples = "VB, V0 ... V17" if system == "v" else "4, 5+, 6A, 6B+ ... 9A"
        raise ValueError(f"{grade!r} is not a {system.upper()} grade ({examples})")
    return text


def index_of(system: str, grade: str) -> float:
    return INDEX_BY_SYSTEM[system][normalise(system, grade)]


def label(system: str, index: float) -> str:
    """The grade in `system` nearest to an index value ('V3', '6A+')."""
    table = INDEX_BY_SYSTEM[system]
    return min(table, key=lambda g: (abs(table[g] - index), table[g]))


def midpoint(low, high) -> float | None:
    if low is None or high is None:
        return None
    return (float(low) + float(high)) / 2


def range_text(grade: dict, system: str = "v") -> str | None:
    """'V1–V3' for a gym grade's range, in `system`; None without one."""
    if grade.get("range_low") is None:
        return None
    low, high = label(system, float(grade["range_low"])), label(system, float(grade["range_high"]))
    return low if low == high else f"{low}–{high}"


@dataclass
class Scale:
    """An ordered list of grade names (1 = easiest) that levels are measured on.
    `anchors` are (index, position) pairs, ascending, for the grades with an
    index; a climb elsewhere is placed between them by its index."""
    names: list[str]
    anchors: list[tuple[float, float]] = field(default_factory=list)
    gym_id: int | None = None
    system: str = "gym"
    # gym_grade_id -> position, for climbs at this gym.
    positions: dict[int, int] = field(default_factory=dict)
    colours: list[str | None] = field(default_factory=list)
    ranges: list[str | None] = field(default_factory=list)

    def level_of_index(self, index: float | None) -> float | None:
        a = self.anchors
        if index is None or not a:
            return None
        if len(a) == 1:
            return a[0][1] + (index - a[0][0])
        # Piecewise linear through the anchors, extended past the ends.
        if index <= a[0][0]:
            (i0, p0), (i1, p1) = a[0], a[1]
        elif index >= a[-1][0]:
            (i0, p0), (i1, p1) = a[-2], a[-1]
        else:
            (i0, p0), (i1, p1) = next((x, y) for x, y in zip(a, a[1:]) if x[0] <= index <= y[0])
        return p0 + (index - i0) * (p1 - p0) / (i1 - i0) if i1 != i0 else p0

    def level(self, climb: dict) -> float | None:
        """Where a climb sits on this scale. None if it can't be placed."""
        if self.system == "gym" and climb.get("gym_grade_id") in self.positions:
            return float(self.positions[climb["gym_grade_id"]])
        return self.level_of_index(climb.get("index"))

    def nearest(self, level: float | None) -> str | None:
        """The grade nearest to a level, halves rounding up (4.5 -> the 5th)."""
        if level is None or not self.names:
            return None
        i = min(max(int(level + 0.5), 1), len(self.names)) - 1
        return self.names[i]

    def detail(self) -> list[dict]:
        return [{"name": n, "colour": c, "range": r}
                for n, c, r in zip(self.names, self.colours, self.ranges)]


def v_scale() -> Scale:
    names = list(V_INDEX)
    return Scale(names=names, anchors=[(V_INDEX[n], i + 1) for i, n in enumerate(names)],
                 system="v", colours=[None] * len(names), ranges=[None] * len(names))


def font_scale() -> Scale:
    names = list(FONT_INDEX)
    return Scale(names=names, anchors=[(FONT_INDEX[n], i + 1) for i, n in enumerate(names)],
                 system="font", colours=[None] * len(names), ranges=[None] * len(names))


def active_grades(gym: dict) -> list[dict]:
    """A gym's colours that are in use, easiest first."""
    return sorted((g for g in gym["grades"] if not g.get("archived_at")),
                  key=lambda g: g["position"])


def gym_scale(gym: dict) -> Scale:
    grades = active_grades(gym)
    anchors = sorted({(midpoint(g["range_low"], g["range_high"]), float(g["position"]))
                      for g in grades if g.get("range_low") is not None})
    # Archived colours keep their position, so old climbs on them still place.
    positions = {g["id"]: g["position"] for g in gym["grades"] if g["id"] is not None}
    system = gym.get("range_system") or "v"
    return Scale(names=[g["name"] for g in grades], anchors=anchors, gym_id=gym["id"],
                 system="gym", positions=positions, colours=[g["colour"] for g in grades],
                 ranges=[range_text(g, system) for g in grades])


def legacy_gym(gym_id=None) -> dict:
    """'My gym' as it would be created, for a user who has none yet."""
    return {"id": gym_id, "name": DEFAULT_GYM_NAME, "range_system": "v", "archived_at": None,
            "grades": [{"id": None, "gym_id": gym_id, "position": i + 1, "name": name,
                        "colour": colour, "range_low": low, "range_high": high,
                        "archived_at": None}
                       for i, (name, colour, low, high) in enumerate(LEGACY_CIRCUIT)]}


def grade_index(climb: dict, grades_by_id: dict[int, dict]) -> float | None:
    """A climb's difficulty index, or None (a gym colour without a range)."""
    system = climb.get("grade_system") or "gym"
    if system == "gym":
        g = grades_by_id.get(climb.get("gym_grade_id"))
        return midpoint(g["range_low"], g["range_high"]) if g else None
    return INDEX_BY_SYSTEM[system].get(climb["grade"])


def display_scale(gyms: list[dict], climbs: list[dict]) -> Scale:
    """The scale charts use: the gym with the most of these climbs, else the
    first gym, else the V-scale."""
    counts: dict[int, int] = {}
    for c in climbs:
        if (c.get("grade_system") or "gym") == "gym" and c.get("gym_id") is not None:
            counts[c["gym_id"]] = counts.get(c["gym_id"], 0) + 1
    by_id = {g["id"]: g for g in gyms}
    if counts:
        best = min(counts, key=lambda i: (-counts[i], i))
        if best in by_id:
            return gym_scale(by_id[best])
    if any(c.get("grade_system") in RANGE_SYSTEMS for c in climbs):
        return v_scale()
    live = [g for g in gyms if not g.get("archived_at")]
    # No climbs at a gym: the first gym, or "My gym" as everyone had before gyms.
    return gym_scale(live[0] if live else legacy_gym())


def annotate(climbs: list[dict], gyms: list[dict], scale: Scale | None = None) -> Scale:
    """Add `index`, `level` (on the display scale), `label` and, at a gym,
    `gym` (its name) and `colour` to each climb, in place. Returns the scale."""
    grades_by_id = {g["id"]: g for gym in gyms for g in gym["grades"]}
    names = {gym["id"]: gym["name"] for gym in gyms}
    scale = scale or display_scale(gyms, climbs)
    for c in climbs:
        c["index"] = grade_index(c, grades_by_id)
        c["level"] = scale.level(c)
        system = c.get("grade_system") or "gym"
        if system == "gym":
            g = grades_by_id.get(c.get("gym_grade_id"))
            c["gym"] = names.get(c.get("gym_id"))
            c["colour"] = g["colour"] if g else PALETTE.get(c["grade"])
            at_display = scale.system == "gym" and c.get("gym_id") == scale.gym_id
            c["label"] = c["grade"] if at_display or c["gym"] is None else f"{c['grade']} ({c['gym']})"
        else:
            c["label"] = c["grade"]
    return scale


def level_of(climb: dict) -> float | None:
    """A climb's level: from annotate(), or for a plain row its stored ordinal."""
    return climb["level"] if "level" in climb else climb.get("grade_ordinal")
