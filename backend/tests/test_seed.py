"""The seed data is valid and realistic; unseed refuses other users. No database."""

from datetime import date, timedelta

import pytest

import seed
import tools
import unseed

TODAY = date(2026, 11, 11)  # a Wednesday


def test_every_seed_session_passes_log_session(store):
    for s in seed.seed_sessions(TODAY):
        tools.log_session(store, **s)
    assert {r["sport"] for r in store.rows} == {"running", "climbing"}
    assert store.climbs


def test_seed_covers_eight_weeks_and_never_the_future():
    dates = [date.fromisoformat(s["date"]) for s in seed.seed_sessions(TODAY)]
    assert max(dates) <= TODAY
    assert min(dates) >= TODAY - timedelta(days=TODAY.weekday() + 7 * 7)


def test_seed_has_a_lighter_week(store):
    for s in seed.seed_sessions(TODAY):
        tools.log_session(store, **s)
    weekly = tools.get_training_load(store, 8, today=TODAY)["weekly"]
    full_weeks = [w["load"] for w in weekly[:-1]]  # the current week is partial
    light = weekly[-1 - seed.LIGHT_WEEK]["load"]
    assert light == min(full_weeks) and light < 0.5 * max(full_weeks)


def test_unseed_refuses_another_user():
    with pytest.raises(RuntimeError):
        unseed.unseed(None, "00000000-0000-0000-0000-000000000002", [1])
