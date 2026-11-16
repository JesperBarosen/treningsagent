"""The coach and templates or gyms (#102), without Claude or a database."""

import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

import api
import gyms
import tools
from conftest import FakeClient, make_message
from evals import run

TODAY = date.today().isoformat()


def tool_use(id_: str, name: str, tool_input: dict) -> dict:
    return {"type": "tool_use", "id": id_, "name": name, "input": tool_input}


def test_list_templates_gives_the_coach_fields_and_gyms(store):
    fb = tools.add_starters(store, ["Fingerboard"])[0]
    tools.update_template(store, fb["id"], {"fields": [
        {**f, "archived": f["key"] == "rest_s"} for f in fb["fields"]]})
    spare = tools.create_template(store, "Old", "other", [])
    tools.update_template(store, spare["id"], {"archived": True})
    gyms.create_gym(store, "Klatreverket", "v", [{"name": "blue", "colour": "blue", "range": ["V3", "V4"]},
                                                 {"name": "black", "colour": "black"}])
    out = json.loads(tools.run_tool(store, "list_templates", {}))
    [t] = out["templates"]  # the archived template is left out
    assert (t["id"], t["name"], t["sport"]) == (fb["id"], "Fingerboard", "other")
    keys = [f["key"] for f in t["fields"]]
    assert "rest_s" not in keys and "hangs" in keys  # archived fields too
    hangs = next(f for f in t["fields"] if f["key"] == "hangs")
    assert hangs == {"key": "hangs", "label": "Hangs", "type": "sets", "required": True, "reps_unit": "s",
                     "load_unit": "kg", "load_signed": True,
                     "extras": [{"key": "edge_mm", "label": "Edge", "unit": "mm"}]}
    protocol = next(f for f in t["fields"] if f["key"] == "protocol")
    assert protocol["options"][0] == {"value": "max_hangs", "label": "Max hangs"}
    assert out["gyms"] == [{"id": 1, "name": "Klatreverket", "colours": [
        {"name": "blue", "range": "V3–V4"}, {"name": "black", "range": None}]}]
    assert out["last_gym_id"] is None and "grade_system v" in out["grades"]


def test_tool_schemas_take_templates_values_and_grade_systems():
    log = tools.TOOLS[0]["input_schema"]["properties"]
    assert {"template_id", "values"} <= set(log)
    assert log["sport"]["enum"] == ["running", "climbing", "strength", "other"]
    climb = log["climbs"]["items"]["properties"]
    assert climb["grade_system"]["enum"] == ["gym", "v", "font"] and "enum" not in climb["grade"]
    assert "gym_id" in climb
    goal = tools.SET_GOAL["input_schema"]["properties"]
    assert {"grade_system", "gym_id"} <= set(goal) and "enum" not in goal["grade"]
    for auto_save in (True, False):
        assert "list_templates" in [t["name"] for t in tools.tools_for(auto_save)]
    assert tools.DRAFT_SESSION["input_schema"] is tools.TOOLS[0]["input_schema"]


def test_a_bad_value_comes_back_as_an_error_that_names_the_field(store):
    fb = tools.add_starters(store, ["Fingerboard"])[0]
    with pytest.raises(ValueError, match="Hangs, row 1: edge must be between 4 and 60 mm"):
        tools.run_tool(store, "draft_session", {
            "sport": "other", "date": TODAY, "duration_min": 30, "effort": 6, "template_id": fb["id"],
            "values": {"protocol": "max_hangs", "hangs": [{"sets": 4, "reps": 10, "edge_mm": 200}]}})


def test_chat_drafts_a_templated_session_with_its_values_described(store):
    fb = tools.add_starters(store, ["Fingerboard"])[0]
    draft = {"sport": "other", "date": TODAY, "duration_min": 40, "effort": 7, "template_id": fb["id"],
             "values": {"protocol": "max_hangs", "hangs": [{"sets": 6, "reps": 10, "edge_mm": 20, "load": 10}]}}
    fake = FakeClient(
        make_message("tool_use", [tool_use("t1", "list_templates", {})]),
        make_message("tool_use", [tool_use("t2", "draft_session", draft)]),
        make_message("end_turn", [{"type": "text", "text": "Ready to save in your Fingerboard form."}]),
    )
    api.app.dependency_overrides[api.get_client] = lambda: fake
    api.app.dependency_overrides[api.get_store] = lambda: store
    try:
        body = TestClient(api.app).post("/chat", json={"message": "Fingerboard today..."}).json()
    finally:
        api.app.dependency_overrides.clear()
    [d] = body["drafts"]
    assert d["template"] == "Fingerboard" and d["custom_values"] == draft["values"]
    assert [(f["label"], f["text"]) for f in d["fields"]] == [
        ("Protocol", "Max hangs"), ("Hangs", "6 × 10 s · 20 mm · +10 kg")]
    assert store.rows == []  # a draft stores nothing
    assert "list_templates" in fake.tools[0]


def test_the_cross_gym_eval_seed_reads_purple_now_and_blue_before():
    case = run.load_case(run.CASES_DIR / "progression_across_gyms.json")
    store = run.MemoryStore()
    run.seed(store, case["seed"], date.today())
    out = json.loads(tools.run_tool(store, "calculate_progression", {}))["climbing"]
    hardest = out["trends"]["avg_session_hardest_sent"]
    assert out["grade_scale_gym"] == "My gym"
    assert (hardest["recent_grade"], hardest["baseline_grade"], hardest["trend"]) == ("purple", "blue", "improving")


def test_eval_seeds_put_named_gyms_and_templates_in_place():
    case = run.load_case(run.CASES_DIR / "gym_named_colours.json")
    store = run.MemoryStore()
    run.seed(store, case["seed"], date.today())
    assert [g["name"] for g in store.gyms()] == ["My gym", "Klatreverket"]
    assert store.climbs[0]["gym_id"] == 1  # a climb without a gym goes to the first gym
    case = run.load_case(run.CASES_DIR / "template_fingerboard_draft.json")
    store = run.MemoryStore()
    run.seed(store, case["seed"], date.today())
    assert store.templates()[0]["name"] == "Fingerboard"
    assert next(r for r in store.rows if r["sport"] == "other")["template_id"] == 1
