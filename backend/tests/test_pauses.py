"""Pausing tracking on purpose (N5): validation, which days are left out of
trends and the load ratio, what the coach is told, and the API."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import api
import chat
import pauses
import tools
from conftest import FakeClient, make_message

TODAY = date(2026, 11, 15)
iso = lambda d: d.isoformat()  # noqa: E731


# --- Validation -------------------------------------------------------------------

def test_an_injury_can_note_body_part_pain_and_a_note():
    row = pauses.validate_pause("injury", " knee ", 6, " sore on stairs ", None, TODAY)
    assert row == {"start_date": "2026-11-15", "planned_end": None, "reason": "injury",
                   "body_part": "knee", "pain": 6, "note": "sore on stairs"}


@pytest.mark.parametrize("kwargs, message", [
    ({"reason": "holiday"}, "reason must be one of"),
    ({"reason": "illness", "body_part": "knee"}, "only for an injury"),
    ({"reason": "travel", "pain": 2}, "only for an injury"),
    ({"reason": "injury", "pain": 11}, "pain must be"),
    ({"reason": "injury", "pain": -1}, "pain must be"),
    ({"reason": "other", "note": "x" * 501}, "at most 500"),
    ({"reason": "other", "planned_end": "2026-11-01"}, "before today"),
    ({"reason": "other", "planned_end": "soon"}, "YYYY-MM-DD"),
])
def test_invalid_pauses_are_refused(kwargs, message):
    with pytest.raises(ValueError, match=message):
        pauses.validate_pause(**kwargs, today=TODAY)


# --- Which days are left out ---------------------------------------------------------

def pause(start, ended_on=None, choice=None, reason="injury"):
    return {"start_date": iso(start), "ended_on": ended_on and iso(ended_on),
            "resume_choice": choice, "reason": reason}


def test_a_pause_that_is_on_covers_its_start_to_today():
    days = pauses.excluded_days([pause(TODAY - timedelta(days=2))], TODAY)
    assert days == {TODAY - timedelta(days=2), TODAY - timedelta(days=1), TODAY}


def test_the_day_a_pause_ends_counts_again():
    start, end = TODAY - timedelta(days=10), TODAY - timedelta(days=7)
    days = pauses.excluded_days([pause(start, end, "continue")], TODAY)
    assert days == {start, start + timedelta(days=1), start + timedelta(days=2)}


def test_start_fresh_hides_the_old_baseline_for_four_weeks_only():
    end = TODAY - timedelta(days=3)
    days = pauses.excluded_days([pause(TODAY - timedelta(days=9), end, "fresh")], TODAY)
    assert end - timedelta(days=30) in days and end not in days and TODAY not in days
    later = end + timedelta(days=pauses.FRESH_DAYS)
    assert pauses.excluded_days([pause(TODAY - timedelta(days=9), end, "fresh")], later) == {
        TODAY - timedelta(days=9) + timedelta(days=i) for i in range(6)}


# --- Load ratio and trends --------------------------------------------------------------

def train_daily(store, first: date, last: date, minutes=40, effort=5):
    d = first
    while d <= last:
        tools.log_session(store, "running", iso(d), minutes, effort, distance_km=8.0)
        d += timedelta(days=1)


def test_the_ratio_leaves_paused_days_out_and_is_not_interpreted_while_paused(store):
    train_daily(store, TODAY - timedelta(days=60), TODAY - timedelta(days=5))
    store.start_pause(pauses.validate_pause("illness", today=TODAY - timedelta(days=4)))

    load = tools.get_training_load(store, 4, TODAY)

    assert load["ratio_status"] == "paused"
    assert load["pause"]["reason"] == "illness"
    assert load["paused_days"] == 5
    # The 2 unpaused days of the last 7 averaged on their own: same as usual, not a drop.
    assert load["acute_7d_avg"] == load["chronic_28d_avg"] == 200.0
    assert load["acute_chronic_ratio"] == 1.0


def test_trends_after_a_continued_pause_are_not_read_as_a_drop(store):
    start, end = TODAY - timedelta(days=13), TODAY - timedelta(days=6)
    train_daily(store, TODAY - timedelta(days=60), start - timedelta(days=1))
    train_daily(store, end, TODAY)
    without = tools.calculate_progression(store, 8, TODAY)["running"]["trends"]

    store.start_pause(pauses.validate_pause("travel", today=start))
    store.end_pause(iso(end), "continue")
    result = tools.calculate_progression(store, 8, TODAY)
    paused = result["running"]["trends"]

    assert without["distance_km_per_week"]["trend"] == "declining"  # what a gap looked like
    assert paused["distance_km_per_week"]["trend"] == "flat"
    assert result["paused_days"] == 7


# --- What the coach is told -----------------------------------------------------------

def test_the_coach_always_avoids_diagnosis(store):
    client = FakeClient(make_message("end_turn", [{"type": "text", "text": "Hi."}]))
    chat.run_turn(client, store, [{"role": "user", "content": "My knee hurts"}], "c")
    system = " ".join(client.systems[0].split())
    assert "never diagnose" in system
    assert "physiotherapist" in system


def test_the_coach_knows_about_a_pause_that_is_on(store):
    store.start_pause(pauses.validate_pause("injury", "knee", 6, "sore on stairs",
                                            "2026-11-30", TODAY))
    client = FakeClient(make_message("end_turn", [{"type": "text", "text": "Rest well."}]))
    chat.run_turn(client, store, [{"role": "user", "content": "Hi"}], "c")
    system = " ".join(client.systems[0].split())
    assert "paused tracking on 2026-11-15, planned until 2026-11-30" in system
    assert "an injury (knee, pain 6/10)" in system and '"sore on stairs"' in system
    assert "don't call the gap a decline" in system


def test_no_pause_means_no_pause_context(store):
    assert pauses.coach_context(None) == ""


# --- API -----------------------------------------------------------------------------

@pytest.fixture
def http(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def test_start_read_and_end_a_pause(http):
    assert http.get("/pause").json() == {"active": None, "recent": None}

    res = http.post("/pause", json={"reason": "injury", "body_part": "ankle", "pain": 4,
                                    "note": "rolled it"})
    assert res.status_code == 201
    assert res.json()["start_date"] == iso(date.today()) and res.json()["pain"] == 4
    assert http.get("/pause").json()["active"]["body_part"] == "ankle"
    assert http.post("/pause", json={"reason": "travel"}).status_code == 409  # one at a time

    ended = http.post("/pause/end", json={"resume_choice": "fresh"})
    assert ended.status_code == 200 and ended.json()["resume_choice"] == "fresh"
    body = http.get("/pause").json()
    assert body["active"] is None and body["recent"]["resume_choice"] == "fresh"
    assert http.post("/pause/end", json={"resume_choice": "continue"}).status_code == 404


def test_the_api_refuses_injury_details_on_other_reasons(http):
    res = http.post("/pause", json={"reason": "illness", "pain": 3})
    assert res.status_code == 422 and "only for an injury" in res.json()["detail"]
    assert http.post("/pause", json={"reason": "holiday"}).status_code == 422
