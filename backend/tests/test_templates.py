"""Session templates, their values and the Strength and Other sports (#100), without a database."""

import json
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api
import forms
import tools

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "forms.json").read_text())
TEMPLATE = FIXTURE["template"]


# --- Values: the shared fixture --------------------------------------------------------

@pytest.mark.parametrize("case", FIXTURE["valid"], ids=lambda c: c["name"])
def test_valid_values(case):
    out = forms.validate_values(TEMPLATE, case["values"], "other")
    assert set(out) == {k for k, v in case["values"].items() if v is not None}


@pytest.mark.parametrize("case", FIXTURE["invalid"], ids=lambda c: c["name"])
def test_invalid_values(case):
    with pytest.raises(ValueError, match=case["error"]):
        forms.validate_values(TEMPLATE, case["values"], "other")


def test_values_must_match_the_templates_sport():
    with pytest.raises(ValueError, match="is for other, not running"):
        forms.validate_values(TEMPLATE, {"hangs": [{"sets": 1, "reps": 1}]}, "running")


def test_an_edit_keeps_archived_options_and_fields_it_already_has():
    old = {"hangs": [{"sets": 1, "reps": 1}], "protocol": "density", "old_note": "hi"}
    assert forms.validate_values(TEMPLATE, old, "other", previous=old) == old


# --- Schemas -------------------------------------------------------------------------

def test_keys_come_from_labels_and_defaults_are_filled():
    t = forms.validate_template("Strength A", "strength", [
        {"label": "Added load (kg)", "type": "number"},
        {"label": "Exercise", "type": "select", "options": [{"label": "Squat"}, {"label": "Pull-up"}]}])
    assert [f["key"] for f in t["fields"]] == ["added_load_kg", "exercise"]
    assert [o["value"] for o in t["fields"][1]["options"]] == ["squat", "pull_up"]
    assert t["fields"][0]["decimals"] == 0 and t["fields"][0]["required"] is False


@pytest.mark.parametrize("fields, sport, message", [
    ([{"label": "X", "type": "slider"}], "other", "field type"),
    ([{"label": "X", "type": "number", "colour": "red"}], "other", "unknown properties"),
    ([{"label": "X", "type": "select", "options": [{"label": "only"}]}], "other", "2 to 12 options"),
    ([{"label": "X", "type": "number", "min": 5, "max": 1}], "other", "min is above max"),
    ([{"label": "X", "type": "number", "decimals": 3}], "other", "decimals"),
    ([{"label": "Same", "type": "boolean"}, {"label": "same", "type": "text"}], "other", "same key"),
    ([{"label": "C", "type": "climbs"}], "strength", "only for climbing"),
    ([{"label": "C", "type": "climbs"}, {"label": "D", "type": "climbs"}], "climbing", "at most one"),
    ([{"label": "S", "type": "sets", "extras": [{"label": "Reps"}]}], "other", "column keys"),
    ([{"label": "S", "type": "sets", "load_unit": "stone"}], "other", "load_unit"),
    ([{"label": f"F{i}", "type": "boolean"} for i in range(21)], "other", "up to 20"),
])
def test_bad_schemas_are_refused(fields, sport, message):
    with pytest.raises(ValueError, match=message):
        forms.validate_template("T", sport, fields)


def test_core_fields_belong_to_the_sport():
    assert forms.validate_template("I", "running", [], ["distance_km"])["core_fields"] == ["distance_km"]
    with pytest.raises(ValueError, match="core fields"):
        forms.validate_template("I", "other", [], ["distance_km"])


def test_starters_pass_validation():
    for name in forms.STARTERS:
        assert forms.starter(name)["name"] == name


# --- Edit rules ------------------------------------------------------------------------

def edit(fields, used=frozenset(), sport="other"):
    return forms.validate_template("Fingerboard", sport, fields, previous=TEMPLATE, used_keys=set(used))


def test_labels_limits_and_new_options_can_change():
    fields = json.loads(json.dumps(TEMPLATE["fields"]))
    fields[3]["label"], fields[3]["max"] = "Rest between sets", 900
    fields[0]["options"].append({"label": "Campus"})
    assert edit(fields, used={"protocol", "rest_s"})["fields"][3]["label"] == "Rest between sets"


@pytest.mark.parametrize("change, message", [
    (lambda f: f[3].update(unit="min"), "unit can't change"),
    (lambda f: f.__setitem__(3, {"key": "rest_s", "label": "Rest", "type": "text"}), "type can't change"),
    (lambda f: f[2].update(reps_unit="reps"), "reps_unit can't change"),
    (lambda f: f[1].update(multiple=False), "multiple can't change"),
    (lambda f: f.pop(3), "archive it instead"),
    (lambda f: f[0]["options"].pop(0), "archive options"),
    (lambda f: f[2]["extras"][0].update(unit="cm"), "unit can't change"),
])
def test_used_fields_keep_their_meaning(change, message):
    fields = json.loads(json.dumps(TEMPLATE["fields"]))
    change(fields)
    with pytest.raises(ValueError, match=message):
        edit(fields, used={"protocol", "grip", "hangs", "rest_s"})


def test_unused_fields_can_be_removed_and_used_templates_keep_their_sport():
    fields = [f for f in TEMPLATE["fields"] if f["key"] != "board"]
    assert len(edit(fields, used={"hangs"})["fields"]) == len(TEMPLATE["fields"]) - 1
    with pytest.raises(ValueError, match="keeps its sport"):
        edit(TEMPLATE["fields"], used={"hangs"}, sport="strength")


# --- Sessions with templates -------------------------------------------------------------

HANGS = {"hangs": [{"sets": 6, "reps": 10, "edge_mm": 20, "load": 10}]}


def fingerboard(store) -> dict:
    return tools.add_starters(store, ["Fingerboard"])[0]


def test_log_a_templated_session_and_read_it_back(store):
    t = fingerboard(store)
    s = tools.log_session(store, "other", "2026-11-10", 40, 7, template_id=t["id"],
                          values={**HANGS, "protocol": "max_hangs", "grip": ["half_crimp"]})
    assert s["template_id"] == t["id"] and s["template"] == "Fingerboard"
    assert [(f["label"], f["text"]) for f in s["fields"]] == [
        ("Protocol", "Max hangs"), ("Grip", "Half crimp"), ("Hangs", "6 × 10 s · 20 mm · +10 kg")]
    [h] = tools.get_history(store, 30, date(2026, 11, 16))
    assert h["template"] == "Fingerboard" and h["custom_values"]["hangs"] == HANGS["hangs"]
    assert h["load"] == 280  # duration x effort, unchanged by the template


def test_drafts_check_values_too(store):
    t = fingerboard(store)
    d = tools.draft_session(store, "other", "2026-11-10", 40, 7, template_id=t["id"], values=HANGS)
    assert d["draft"] is True and d["fields"][0]["text"] == "6 × 10 s · 20 mm · +10 kg"
    assert store.rows == []
    with pytest.raises(ValueError, match="Hangs is required"):
        tools.draft_session(store, "other", "2026-11-10", 40, 7, template_id=t["id"], values={})


def test_template_rules_on_sessions(store):
    t = fingerboard(store)
    with pytest.raises(ValueError, match="template 99 not found"):
        tools.log_session(store, "other", "2026-11-10", 40, 7, template_id=99, values=HANGS)
    with pytest.raises(ValueError, match="need a template_id"):
        tools.log_session(store, "other", "2026-11-10", 40, 7, values=HANGS)
    with pytest.raises(ValueError, match="is for other, not strength"):
        tools.log_session(store, "strength", "2026-11-10", 40, 7, template_id=t["id"], values=HANGS)
    tools.update_template(store, t["id"], {"archived": True})
    with pytest.raises(ValueError, match="archived"):
        tools.log_session(store, "other", "2026-11-10", 40, 7, template_id=t["id"], values=HANGS)


def test_edits_keep_the_template_and_can_drop_it(store):
    t = fingerboard(store)
    s = tools.log_session(store, "other", "2026-11-10", 40, 7, template_id=t["id"], values=HANGS)
    tools.update_template(store, t["id"], {"archived": True})
    # An archived template stays on its sessions, and they can still be edited.
    edited = tools.update_session(store, s["id"], {"effort": 8})
    assert edited["template_id"] == t["id"] and edited["custom_values"] == HANGS
    plain = tools.update_session(store, s["id"], {"template_id": None})
    assert "template_id" not in plain
    assert store.rows[0]["template_id"] is None and store.rows[0]["custom_values"] == {}


def test_used_templates_are_archived_not_deleted(store):
    t = fingerboard(store)
    tools.log_session(store, "other", "2026-11-10", 40, 7, template_id=t["id"], values=HANGS)
    with pytest.raises(ValueError, match="archive"):
        tools.delete_template(store, t["id"])
    spare = tools.create_template(store, "Spare", "other", [])
    tools.delete_template(store, spare["id"])
    assert [x["name"] for x in tools.list_templates(store)] == ["Fingerboard"]


def test_names_are_unique_among_live_templates(store):
    fingerboard(store)
    with pytest.raises(ValueError, match="already have"):
        tools.create_template(store, "fingerboard", "other", [])


# --- Strength and Other in load ------------------------------------------------------------

def test_strength_and_other_count_in_load_per_sport(store):
    tools.log_session(store, "strength", "2026-11-14", 60, 7)
    tools.log_session(store, "other", "2026-11-15", 30, 3)
    tools.log_session(store, "running", "2026-11-15", 40, 5)
    load = tools.get_training_load(store, 1, date(2026, 11, 16))
    assert load["weekly"][0]["load"] == 0  # the current week (from Monday 16th) is empty
    week = tools.get_training_load(store, 2, date(2026, 11, 16))["weekly"][0]
    assert week["load_by_sport"] == {"strength": 420, "other": 90, "running": 200}
    only = tools.get_training_load(store, 2, date(2026, 11, 16), sport="strength")
    assert only["weekly"][0]["load"] == 420
    with pytest.raises(ValueError, match="fields not valid for strength"):
        tools.log_session(store, "strength", "2026-11-14", 60, 7, distance_km=5)


# --- API ---------------------------------------------------------------------------------

@pytest.fixture
def http(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def test_template_endpoints(http):
    listed = http.get("/templates").json()
    assert listed["templates"] == []
    assert [s["name"] for s in listed["starters"]] == ["Fingerboard", "Strength", "Intervals", "Mobility"]
    [fb] = http.post("/templates/starters", json={"names": ["Fingerboard"]}).json()
    res = http.post("/templates", json={"name": "Yoga", "sport": "other",
                                        "fields": [{"label": "Style", "type": "text"}]})
    assert res.status_code == 201
    assert http.post("/templates", json={"name": "Bad", "sport": "other",
                                         "fields": [{"label": "X", "type": "slider"}]}).status_code == 422
    res = http.post("/sessions", json={"sport": "other", "date": "2026-11-10", "duration_min": 40,
                                       "effort": 7, "template_id": fb["id"], "values": HANGS})
    assert res.status_code == 201 and res.json()["template"] == "Fingerboard"
    bad = http.post("/sessions", json={"sport": "other", "date": "2026-11-10", "duration_min": 40,
                                       "effort": 7, "template_id": fb["id"],
                                       "values": {"hangs": [{"sets": 1, "reps": 10, "edge_mm": 200}]}})
    assert bad.status_code == 422 and "edge must be between 4 and 60 mm" in bad.json()["detail"]
    assert http.delete(f"/templates/{fb['id']}").status_code == 409
    assert http.patch(f"/templates/{fb['id']}", json={"archived": True}).json()["archived"] is True
    assert http.patch(f"/templates/{fb['id']}", json={}).status_code == 422
    assert http.patch("/templates/99", json={"name": "x"}).status_code == 404
    assert http.get("/training-load?weeks=2&sport=strength").status_code == 200
