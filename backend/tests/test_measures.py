"""Number fields with several measures (#111): Hangboard = 5 kg, 10 s, 6 sets."""

import json
from datetime import date

import pytest

import forms
import tools

HANGBOARD = {"label": "Hangboard", "type": "number",
             "measures": [{"label": "kg", "decimals": 1}, {"label": "s"}, {"label": "sets"}]}
PULLUPS = {"label": "Pull-ups", "type": "number",
           "measures": [{"label": "kg", "decimals": 1}, {"label": "reps"}, {"label": "sets"}]}


def strength(store, *fields) -> dict:
    return tools.create_template(store, "Board and bar", "strength", list(fields))


# --- Schema ----------------------------------------------------------------------------

def test_measures_get_keys_and_defaults():
    t = forms.validate_template("T", "strength", [HANGBOARD])
    assert t["fields"][0]["measures"] == [
        {"key": "kg", "label": "kg", "decimals": 1}, {"key": "s", "label": "s", "decimals": 0},
        {"key": "sets", "label": "sets", "decimals": 0}]
    assert "unit" not in t["fields"][0] and "decimals" not in t["fields"][0]


@pytest.mark.parametrize("measures, message", [
    ([], "1 to 4 measures"),
    ([{"label": x} for x in "abcde"], "1 to 4 measures"),
    ([{"label": "kg"}, {"label": "KG"}], "two measures are called"),
    ([{"label": "a much too long name"}], "1 to 12 characters"),
    ([{"label": ""}], "1 to 12 characters"),
    ([{"label": "kg", "decimals": 3}], "decimals must be 0, 1 or 2"),
    ([{"label": "kg", "unit": "kg"}], "each measure is"),
    ([{"key": "Bad Key", "label": "kg"}], "unique lower-case keys"),
    ("kg", "1 to 4 measures"),
])
def test_bad_measures_are_refused(measures, message):
    with pytest.raises(ValueError, match=message):
        forms.validate_template("T", "strength", [{"label": "F", "type": "number", "measures": measures}])


def test_a_field_with_measures_has_no_field_unit():
    with pytest.raises(ValueError, match="each measure has its own unit"):
        forms.validate_template("T", "strength", [{**HANGBOARD, "unit": "kg"}])


# --- Values ----------------------------------------------------------------------------

def test_values_text_and_description(store):
    t = strength(store, HANGBOARD)
    s = tools.log_session(store, "strength", "2026-11-10", 30, 6, template_id=t["id"],
                          values={"hangboard": {"kg": 5, "s": 10, "sets": 6}})
    assert s["custom_values"] == {"hangboard": {"kg": 5, "s": 10, "sets": 6}}
    [f] = s["fields"]
    assert f["text"] == "5 kg · 10 s · 6 sets"
    assert f["measures"] == [{"key": "kg", "label": "kg"}, {"key": "s", "label": "s"},
                             {"key": "sets", "label": "sets"}]
    # Only some measures, in the field's order whatever order they came in.
    s = tools.log_session(store, "strength", "2026-11-11", 30, 6, template_id=t["id"],
                          values={"hangboard": {"sets": 6, "kg": 7.5}})
    assert s["fields"][0]["text"] == "7.5 kg · 6 sets"
    assert list(s["custom_values"]["hangboard"]) == ["kg", "sets"]


def test_empty_measures_leave_the_field_out_but_a_required_field_needs_one(store):
    t = strength(store, HANGBOARD, {**PULLUPS, "required": True})
    with pytest.raises(ValueError, match="Pull-ups is required"):
        tools.log_session(store, "strength", "2026-11-10", 30, 6, template_id=t["id"],
                          values={"pull_ups": {"kg": None}, "hangboard": {}})
    s = tools.log_session(store, "strength", "2026-11-10", 30, 6, template_id=t["id"],
                          values={"pull_ups": {"reps": 5}, "hangboard": {}})
    assert s["custom_values"] == {"pull_ups": {"reps": 5}}


# --- Old plain numbers ----------------------------------------------------------------

def test_a_plain_field_gets_measures_and_old_numbers_stay_readable(store):
    t = strength(store, {"label": "Hang", "type": "number", "unit": "kg", "decimals": 1})
    old = tools.log_session(store, "strength", "2026-11-01", 30, 6, template_id=t["id"],
                            values={"hang": 5})
    assert old["fields"][0]["text"] == "5 kg"  # one unit: unchanged on screen
    # The field gets a second measure; the old unit stays as the measure "value".
    hang = {"key": "hang", "label": "Hang", "type": "number",
            "measures": [{"key": "value", "label": "kg", "decimals": 1}, {"label": "s"}]}
    tools.update_template(store, t["id"], {"fields": [hang]})
    [h] = tools.get_history(store, 30, date(2026, 11, 16))
    assert h["custom_values"] == {"hang": 5}  # stored as it was
    assert h["fields"][0]["text"] == "5 kg" and h["fields"][0]["value"] == {"value": 5}
    # An edit keeps the old number valid, and a new session uses the new shape.
    edited = tools.update_session(store, old["id"], {"effort": 7})
    assert edited["custom_values"] == {"hang": {"value": 5}}
    new = tools.log_session(store, "strength", "2026-11-12", 30, 6, template_id=t["id"],
                            values={"hang": {"value": 6, "s": 10}})
    assert new["fields"][0]["text"] == "6 kg · 10 s"


@pytest.mark.parametrize("measures, message", [
    ([{"key": "value", "label": "lb"}, {"label": "s"}], "unit can't change"),
    ([{"label": "kg"}, {"label": "s"}], "has logged values"),
])
def test_a_used_plain_field_keeps_its_unit_as_a_measure(store, measures, message):
    t = strength(store, {"label": "Hang", "type": "number", "unit": "kg", "decimals": 1})
    tools.log_session(store, "strength", "2026-11-01", 30, 6, template_id=t["id"], values={"hang": 5})
    with pytest.raises(ValueError, match=message):
        tools.update_template(store, t["id"], {"fields": [
            {"key": "hang", "label": "Hang", "type": "number", "measures": measures}]})


def test_used_measures_stay_and_keep_their_unit(store):
    t = strength(store, PULLUPS)
    tools.log_session(store, "strength", "2026-11-01", 30, 6, template_id=t["id"],
                      values={"pull_ups": {"reps": 5}})
    field = json.loads(json.dumps(store.templates()[0]["fields"][0]))
    # Reordering, renaming nothing and adding a measure are fine.
    added = {**field, "measures": [field["measures"][2], field["measures"][0], field["measures"][1],
                                   {"label": "s"}]}
    assert len(tools.update_template(store, t["id"], {"fields": [added]})["fields"][0]["measures"]) == 4
    with pytest.raises(ValueError, match="can't be removed"):
        tools.update_template(store, t["id"], {"fields": [{**field, "measures": field["measures"][:2]}]})
    renamed = {**field, "measures": [{**field["measures"][0], "label": "lb"}, *field["measures"][1:]]}
    with pytest.raises(ValueError, match="unit can't change"):
        tools.update_template(store, t["id"], {"fields": [renamed]})
    with pytest.raises(ValueError, match="keeps them"):
        tools.update_template(store, t["id"], {"fields": [{k: v for k, v in field.items() if k != "measures"}]})


def test_unused_fields_can_change_their_measures_freely(store):
    t = strength(store, PULLUPS)
    field = store.templates()[0]["fields"][0]
    out = tools.update_template(store, t["id"], {"fields": [{**field, "measures": [{"label": "lb"}]}]})
    assert out["fields"][0]["measures"] == [{"key": "lb", "label": "lb", "decimals": 0}]


# --- The coach --------------------------------------------------------------------------

def test_the_coach_sees_measures_and_logs_them(store):
    t = strength(store, PULLUPS)
    out = json.loads(tools.run_tool(store, "list_templates", {}))
    assert out["templates"][0]["fields"][0]["measures"] == [
        {"key": "kg", "label": "kg"}, {"key": "reps", "label": "reps"}, {"key": "sets", "label": "sets"}]
    d = json.loads(tools.run_tool(store, "draft_session", {
        "sport": "strength", "date": "2026-11-16", "duration_min": 40, "effort": 7,
        "template_id": t["id"], "values": {"pull_ups": {"kg": 10, "reps": 5, "sets": 3}}}))
    assert d["fields"][0]["text"] == "10 kg · 5 reps · 3 sets"
    with pytest.raises(ValueError, match="takes a value per measure"):
        tools.run_tool(store, "draft_session", {
            "sport": "strength", "date": "2026-11-16", "duration_min": 40, "effort": 7,
            "template_id": t["id"], "values": {"pull_ups": 10}})
    assert "measure key" in tools.TOOLS[0]["input_schema"]["properties"]["values"]["description"]
