"""Progression per sport: weekly numbers and a trend per metric.

Everything here is computed from stored sessions and climbs when asked for and
never written back. Each sport is a module: a function that takes the sessions,
climbs, shown weeks and trend windows, and returns that sport's weekly rows and
trends. To add a sport (e.g. strength), write one more such function and add
it to SPORT_MODULES.

Trend rule (the same for every metric): compare the RECENT window (the last 14
days, today included) with the BASELINE window (the 28 days before that). Each
side needs at least MIN_SESSIONS sessions that have the metric, otherwise the
trend is "not enough data". Otherwise the change is "flat" if it is below the
metric's threshold, else "improving" or "declining" in the metric's good
direction. Volumes compare weekly averages (total / 2 vs total / 4).
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta

RECENT_DAYS = 14
BASELINE_DAYS = 28
MIN_SESSIONS = 3

# Flat thresholds. Relative ones are a fraction of the baseline value.
VOLUME_FLAT = 0.10       # weekly distance, duration, climbs: under 10% change
PACE_FLAT = 0.02         # pace: under 2% (about 6 s/km at 5:00/km)
GRADE_FLAT = 0.5         # average grade ordinal: under half a grade
SEND_RATE_FLAT = 0.10    # send rate: under 10 percentage points

TREND_RULE = (
    "Trends compare the last 14 days (today included) with the 28 days before. "
    "Each side needs at least 3 sessions with the metric, else 'not enough data'. "
    "'flat' means the change is under: 10% for weekly volume, 2% for pace, half a "
    "grade for grade averages, 10 percentage points for send rate. Volumes are "
    "weekly averages; for volume, 'improving' just means more."
)

# Running distance bands, so a slow long run is compared with other long runs.
DISTANCE_BANDS = ("under_7km", "7_to_15km", "over_15km")


@dataclass(frozen=True)
class Windows:
    """The recent and baseline windows that trends compare."""
    today: date

    @property
    def recent_start(self) -> date:
        return self.today - timedelta(days=RECENT_DAYS - 1)

    @property
    def baseline_start(self) -> date:
        return self.recent_start - timedelta(days=BASELINE_DAYS)

    def recent(self, sessions: list[dict]) -> list[dict]:
        return [s for s in sessions if self.recent_start <= _date(s) <= self.today]

    def baseline(self, sessions: list[dict]) -> list[dict]:
        return [s for s in sessions if self.baseline_start <= _date(s) < self.recent_start]


def trend(recent: float | None, recent_n: int, baseline: float | None, baseline_n: int,
          *, flat: float, relative: bool = False, lower_is_better: bool = False,
          digits: int = 2) -> dict:
    """Compare a metric's recent and baseline values. `recent_n` and
    `baseline_n` are the number of sessions each value is based on."""
    out = {"recent": _round(recent, digits), "baseline": _round(baseline, digits),
           "recent_sessions": recent_n, "baseline_sessions": baseline_n}
    if (recent_n < MIN_SESSIONS or baseline_n < MIN_SESSIONS
            or recent is None or baseline is None or (relative and baseline == 0)):
        return {**out, "trend": "not enough data"}
    change = (recent - baseline) / baseline if relative else recent - baseline
    if lower_is_better:
        change = -change
    if abs(change) < flat:
        return {**out, "trend": "flat"}
    return {**out, "trend": "improving" if change > 0 else "declining"}


# --- Running -----------------------------------------------------------------

def distance_band(distance_km: float) -> str:
    if distance_km < 7:
        return "under_7km"
    return "7_to_15km" if distance_km <= 15 else "over_15km"


def _pace(runs: list[dict]) -> float | None:
    """Total minutes / total km over runs with a distance (so longer runs weigh more)."""
    with_distance = [r for r in runs if r.get("distance_km")]
    km = sum(r["distance_km"] for r in with_distance)
    return sum(r["duration_min"] for r in with_distance) / km if km else None


def _with_distance(runs: list[dict], band: str | None = None) -> list[dict]:
    return [r for r in runs if r.get("distance_km")
            and (band is None or distance_band(r["distance_km"]) == band)]


def running(sessions: list[dict], climbs_by_session: dict[int, list[dict]],
            weeks: list[date], windows: Windows) -> dict:
    runs = [s for s in sessions if s["sport"] == "running"]

    weekly = []
    for start in weeks:
        week = _in_week(runs, start)
        bands = {}
        for band in DISTANCE_BANDS:
            in_band = _with_distance(week, band)
            if in_band:
                bands[band] = {"runs": len(in_band),
                               "pace_min_per_km": _round(_pace(in_band), 2)}
        weekly.append({
            "week_start": start.isoformat(),
            "runs": len(week),
            "distance_km": round(sum(r.get("distance_km") or 0 for r in week), 1),
            "duration_min": sum(r["duration_min"] for r in week),
            "pace_min_per_km": _round(_pace(week), 2),
            "pace_by_distance": bands,
        })

    recent, baseline = windows.recent(runs), windows.baseline(runs)

    def per_week(total: Callable[[list[dict]], float], flat: float, digits: int) -> dict:
        return trend(total(recent) / (RECENT_DAYS / 7), len(recent),
                     total(baseline) / (BASELINE_DAYS / 7), len(baseline),
                     flat=flat, relative=True, digits=digits)

    def pace_trend(band: str | None) -> dict:
        r, b = _with_distance(recent, band), _with_distance(baseline, band)
        return trend(_pace(r), len(r), _pace(b), len(b),
                     flat=PACE_FLAT, relative=True, lower_is_better=True)

    return {
        "sessions": sum(w["runs"] for w in weekly),
        "weekly": weekly,
        "trends": {
            "distance_km_per_week": per_week(
                lambda rs: sum(r.get("distance_km") or 0 for r in rs), VOLUME_FLAT, 1),
            "duration_min_per_week": per_week(
                lambda rs: sum(r["duration_min"] for r in rs), VOLUME_FLAT, 0),
            "pace_min_per_km": pace_trend(None),
            "pace_by_distance": {band: pace_trend(band) for band in DISTANCE_BANDS},
        },
    }


# --- Climbing ----------------------------------------------------------------

def _hardest(climbs: list[dict]) -> dict | None:
    return max(climbs, key=lambda c: c["grade_ordinal"], default=None)


def _sends(climbs: list[dict]) -> list[dict]:
    return [c for c in climbs if c["sent"]]


def _flashes(climbs: list[dict]) -> list[dict]:
    """Sent on the first attempt. Climbs without a stated attempt count are not flashes."""
    return [c for c in climbs if c["sent"] and c.get("attempts") == 1]


def _send_rate_by_grade(climbs: list[dict]) -> dict:
    by_grade: dict[str, dict] = {}
    for c in sorted(climbs, key=lambda c: c["grade_ordinal"]):
        g = by_grade.setdefault(c["grade"], {"sent": 0, "tried": 0})
        g["tried"] += 1
        g["sent"] += c["sent"]
    for g in by_grade.values():
        g["rate"] = round(g["sent"] / g["tried"], 2)
    return by_grade


def climbing(sessions: list[dict], climbs_by_session: dict[int, list[dict]],
             weeks: list[date], windows: Windows) -> dict:
    climbing_sessions = [s for s in sessions if s["sport"] == "climbing"]

    def climbs_of(group: list[dict]) -> list[dict]:
        return [c for s in group for c in climbs_by_session.get(s["id"], [])]

    weekly = []
    for start in weeks:
        week = _in_week(climbing_sessions, start)
        climbs = climbs_of(week)
        hardest, flash = _hardest(_sends(climbs)), _hardest(_flashes(climbs))
        weekly.append({
            "week_start": start.isoformat(),
            "sessions": len(week),
            "climbs": len(climbs),
            "hardest_sent": hardest and hardest["grade"],
            "flash_grade": flash and flash["grade"],
            "send_rate_by_grade": _send_rate_by_grade(climbs),
        })

    recent = windows.recent(climbing_sessions)
    baseline = windows.baseline(climbing_sessions)

    def per_session_top(group: list[dict], pick: Callable) -> tuple[float | None, int]:
        """Average over sessions of each session's hardest picked climb's ordinal."""
        tops = [_hardest(pick(climbs_by_session.get(s["id"], []))) for s in group]
        ordinals = [t["grade_ordinal"] for t in tops if t]
        return (sum(ordinals) / len(ordinals) if ordinals else None), len(ordinals)

    def grade_trend(pick: Callable) -> dict:
        return trend(*per_session_top(recent, pick), *per_session_top(baseline, pick),
                     flat=GRADE_FLAT)

    def with_climbs(group: list[dict], grade: str | None = None) -> int:
        return sum(1 for s in group if any(grade in (None, c["grade"])
                                           for c in climbs_by_session.get(s["id"], [])))

    def send_rate_trend(grade: str) -> dict:
        r = [c for c in climbs_of(recent) if c["grade"] == grade]
        b = [c for c in climbs_of(baseline) if c["grade"] == grade]
        return trend(len(_sends(r)) / len(r) if r else None, with_climbs(recent, grade),
                     len(_sends(b)) / len(b) if b else None, with_climbs(baseline, grade),
                     flat=SEND_RATE_FLAT)

    tried = sorted({(c["grade_ordinal"], c["grade"])
                    for c in climbs_of(recent) + climbs_of(baseline)})
    return {
        "sessions": sum(w["sessions"] for w in weekly),
        "weekly": weekly,
        "trends": {
            "climbs_per_week": trend(
                len(climbs_of(recent)) / (RECENT_DAYS / 7), with_climbs(recent),
                len(climbs_of(baseline)) / (BASELINE_DAYS / 7), with_climbs(baseline),
                flat=VOLUME_FLAT, relative=True, digits=1),
            "avg_session_hardest_sent": grade_trend(_sends),
            "avg_session_flash_grade": grade_trend(_flashes),
            "send_rate_by_grade": {grade: send_rate_trend(grade) for _, grade in tried},
        },
    }


# Add a sport by adding its module here.
SPORT_MODULES: dict[str, Callable[..., dict]] = {
    "running": running,
    "climbing": climbing,
}


def calculate(sessions: list[dict], climbs: list[dict], weeks: list[date],
              today: date) -> dict:
    """Weekly rows for `weeks` and trends per metric, for every sport module.
    `sessions` and `climbs` must cover the shown weeks and the trend windows."""
    windows = Windows(today)
    climbs_by_session: dict[int, list[dict]] = {}
    for c in climbs:
        climbs_by_session.setdefault(c["session_id"], []).append(c)
    sessions = [s for s in sessions if _date(s) <= today]
    return {sport: module(sessions, climbs_by_session, weeks, windows)
            for sport, module in SPORT_MODULES.items()}


def _in_week(sessions: list[dict], start: date) -> list[dict]:
    return [s for s in sessions if start <= _date(s) < start + timedelta(days=7)]


def _date(session: dict) -> date:
    return date.fromisoformat(session["date"])


def _round(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    return round(value) if digits == 0 else round(value, digits)
