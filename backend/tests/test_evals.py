"""Offline checks of the eval runner and cases; the runner itself calls real APIs."""

import json
from datetime import date

import pytest

import db
import tools
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


def test_every_case_has_a_known_bad_answer_aimed_at_a_real_check():
    for path in sorted(run.CASES_DIR.glob("*.json")):
        case = run.load_case(path)
        bad = case["known_bad"]
        assert bad["answer"] and bad["why"] and bad["source"]
        kind, _, number = bad["should_fail"].partition("-")
        assert kind in ("must", "must_not")
        assert 1 <= int(number) <= len(case["expect"][kind]), path.stem


def test_judge_check_computes_tool_results_from_the_seed_without_a_database():
    case = run.load_case(run.CASES_DIR / "progression_grade_names.json")
    store = run.MemoryStore()
    run.seed(store, case["seed"], date.today())  # run_tool measures from today
    out = json.loads(tools.run_tool(store, "calculate_progression", {}))
    hardest = out["climbing"]["trends"]["avg_session_hardest_sent"]
    assert (hardest["recent_grade"], hardest["baseline_grade"]) == ("red", "purple")
    assert out["running"]["days_since_last_session"] == 2


def test_repeat_must_be_positive():
    with pytest.raises(SystemExit):
        run.main(["--repeat", "0"])


UNDO_CASE = run.CASES_DIR / "log_after_undo_not_duplicate.json"


def test_today_placeholder_becomes_the_run_date():
    case = run.load_case(UNDO_CASE, date(2026, 11, 14))
    assert "{today}" not in json.dumps(case)
    assert case["history"][1]["content"][0]["input"]["date"] == "2026-11-14"
    assert "on 2026-11-14 (id 9001)" in case["history"][-1]["content"]


def test_case_histories_are_valid_conversations():
    """Starts with the user, and every tool_use is answered by a tool_result."""
    for path in sorted(run.CASES_DIR.glob("*.json")):
        history = run.load_case(path).get("history", [])
        if not history:
            continue
        assert history[0]["role"] == "user", path.stem
        blocks = [b for m in history if isinstance(m["content"], list) for b in m["content"]]
        uses = {b["id"] for b in blocks if b["type"] == "tool_use"}
        results = {b["tool_use_id"] for b in blocks if b["type"] == "tool_result"}
        assert uses == results, path.stem


def test_undo_case_ends_with_the_removal_note_the_app_sends():
    note = run.load_case(UNDO_CASE)["history"][-1]
    assert note["role"] == "user"
    assert note["content"].startswith("[User removed the session: ")


@pytest.mark.parametrize("path", sorted(run.CASES_DIR.glob("*.json")), ids=lambda p: p.stem)
def test_judge_check_runs_every_expected_tool_offline(path):
    """--judge-check runs each expected tool on an in-memory store with the
    case's tool_inputs (or none); every case must be able to do that."""
    case = run.load_case(path)
    store = run.MemoryStore()
    run.seed(store, case["seed"], date.today())
    inputs = case["expect"].get("tool_inputs", {})
    for name in case["expect"]["tools_called"]:
        json.loads(tools.run_tool(store, name, inputs.get(name, {})))


def test_draft_cases_expect_a_draft_dated_today():
    for path in (UNDO_CASE, run.CASES_DIR / "chat_drafts_instead_of_logging.json"):
        case = run.load_case(path)
        draft = json.loads(tools.run_tool(None, "draft_session",
                                          case["expect"]["tool_inputs"]["draft_session"]))
        assert draft["draft"] is True and draft["date"] == date.today().isoformat()


def test_plan_change_cases_seed_a_plan_and_propose_only_the_asked_change():
    for case_id, kind in (("plan_change_only_diff", "move"), ("plan_change_lighter_week", "lighter")):
        case = run.load_case(run.CASES_DIR / f"{case_id}.json")
        store = run.MemoryStore()
        run.seed(store, case["seed"], date.today())
        near = json.loads(tools.run_tool(store, "get_plan", {}))["this_and_next_week"]
        assert [s["title"] for s in near[:3]] == ["Easy run", "Tempo run", "Long run"]  # ids 1-3, week 1
        out = json.loads(tools.run_tool(store, "propose_plan_change",
                                        case["expect"]["tool_inputs"]["propose_plan_change"]))
        assert [c["type"] for c in out["changes"]] == case["expect"]["change_types"] == [kind]


def test_structural_checks_catch_a_new_plan_and_extra_changes():
    case = {"expect": {"tools_not_called": ["propose_program"], "change_types": ["move"]}}

    def blocks(name, types):
        return [{"type": "tool_use", "id": "t1", "name": name, "input": {}},
                {"type": "tool_result", "tool_use_id": "t1",
                 "content": json.dumps({"changes": [{"type": t} for t in types]})}]

    assert run.structural_checks(case, blocks("propose_plan_change", ["move"])) == []
    [extra] = run.structural_checks(case, blocks("propose_plan_change", ["move", "remove"]))
    assert extra.id == "change_types" and not extra.passed
    ids = {c.id for c in run.structural_checks(case, blocks("propose_program", []))}
    assert ids == {"tools_not_called", "change_types"}
