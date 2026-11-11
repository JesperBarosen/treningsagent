"""Offline checks of the eval runner and cases; the runner itself calls real APIs."""

from datetime import date

import pytest

import db
from evals import run


def test_every_case_loads_with_a_seed_question_and_checks():
    paths = sorted(run.CASES_DIR.glob("*.json"))
    assert paths
    for path in paths:
        case = run.load_case(path)
        assert case["id"] == path.stem
        assert case["question"] and case["note"]
        assert case["seed"]["running"] or case["seed"]["climbing"]
        assert case["expect"]["must"] or case["expect"]["must_not"]


def test_seed_from_reuses_another_cases_seed():
    shared = run.load_case(run.CASES_DIR / "progression_no_false_gap.json")["seed"]
    case = run.load_case(run.CASES_DIR / "progression_grade_names.json")
    assert case["seed"] == shared


def test_seed_dates_are_relative_to_today(store):
    seed = {"running": [{"days_ago": 2, "distance_km": 8, "duration_min": 42, "effort": 6}],
            "climbing": [{"days_ago": 0, "duration_min": 90, "effort": 7,
                          "climbs": [{"grade": "red", "style": "boulder", "sent": True}]}]}
    run.seed(store, seed, date(2026, 11, 11))
    assert [(r["sport"], r["date"]) for r in store.rows] == [
        ("running", "2026-11-09"), ("climbing", "2026-11-11")]
    assert store.climbs[0]["grade_ordinal"] == 5


def test_cost_uses_list_prices_and_cache_multipliers():
    usage = {"model": "claude-haiku-5-5", "input_tokens": 1_000_000, "output_tokens": 1_000_000,
             "cache_creation_input_tokens": 0, "cache_read_input_tokens": 1_000_000}
    assert run.cost(usage) == pytest.approx(0.10 + 0.50 + 0.01)
    assert run.cost({**usage, "model": "some-other-model"}) is None


def test_cleanup_refuses_the_real_test_user():
    with pytest.raises(RuntimeError):
        run.delete_user(conn=None, user_id=db.TEST_USER_ID)
