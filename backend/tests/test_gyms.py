"""Grade systems, gyms and the difficulty index (#98), without a database."""

import json
import re
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api
import gyms
import grades
import seed
import tools
from conftest import FakeStore

FIXTURES = Path(__file__).parent / "fixtures"
MIGRATION = (Path(__file__).parents[2] / "supabase" / "migrations"
             / "20261116120100_climb_grade_systems.sql")

# The day and goals tests/fixtures/progression_before_gyms.json was recorded
# with, by the code as it was before gyms (seed data, FakeStore).
TODAY = date(2026, 11, 16)
GOALS = [("red", "send", "2026-10-01"), ("black", "send", "2026-10-20"),
         ("blue", "flash", "2026-10-05"), ("purple", "flash", "2026-11-01"),
         ("white", "send", "2026-11-10")]


def snapshot(store) -> dict:
    out = {}
    for weeks in (1, 4, 8, 12):
        climbing = tools.calculate_progression(store, weeks, TODAY)["climbing"]
        # New in #98, not in the recording: which scale and gym the numbers are on.
        climbing.pop("grade_scale_detail"), climbing.pop("grade_scale_gym")
        for week in climbing["weekly"]:  # new in #99: where to plot the week's grades
            for key in ("hardest_sent_level", "flash_level", "hardest_sent_colour", "flash_colour"):
                week.pop(key)
        out[f"progression_{weeks}"] = climbing
    out["goals"] = [{k: g[k] for k in ("grade", "climb_mode", "status", "achieved_on", "progress")}
                    for g in tools.list_goals(store, TODAY)]
    for g in out["goals"]:
        g["progress"].pop("reached_with", None)  # new in #98: where it was reached
    out["tags"] = tools.tag_patterns(store, 56, TODAY)["climbing"]
    out["hardest"] = [s.get("hardest_sent_grade") for s in tools.get_history(store, 70, TODAY)
                      if s["sport"] == "climbing"]
    return json.loads(json.dumps(out))  # tuples -> lists, as in the recording


def golden() -> dict:
    return json.loads((FIXTURES / "progression_before_gyms.json").read_text())


def add_goals(store, migrated: bool) -> None:
    gym = store.gyms()[0] if migrated else None
    for grade, mode, created in GOALS:
        row = {"kind": "climb_grade", "grade": grade, "climb_mode": mode, "band": None,
               "target_pace": None, "target_date": None, "created_on": created}
        if gym:
            g = next(x for x in gym["grades"] if x["name"] == grade)
            row.update(grade_system="gym", gym_id=gym["id"], gym_grade_id=g["id"])
        store.insert_goal(row)


def migrate_like_sql(store: FakeStore) -> None:
    """What 20261116120100_climb_grade_systems.sql does to one user's rows:
    a "My gym" with LEGACY_CIRCUIT, and every climb and grade goal pointed at
    its colour there."""
    gym = gyms.default_gym(store, store.gyms(), create=True)
    by_name = {g["name"]: g for g in gym["grades"]}
    for row in store.climbs + [g for g in store.goal_rows if g["kind"] == "climb_grade"]:
        row.update(grade_system="gym", gym_id=gym["id"], gym_grade_id=by_name[row["grade"]]["id"])


def test_my_gym_migration_leaves_progression_goals_and_history_identical():
    # Rows as they are in the database before the migration: colour and ordinal only.
    store = FakeStore()
    for s in seed.seed_sessions(TODAY):
        climbs = s.pop("climbs", [])
        session_id = store.insert_session(tools.validate_session(**s)[0])
        for c in climbs:
            store.climbs.append({"id": len(store.climbs) + 1, "session_id": session_id,
                                 "grade": c["grade"], "grade_ordinal": tools.GRADES.index(c["grade"]) + 1,
                                 "attempts": c.get("attempts"), "sent": c["sent"],
                                 "style": c["style"], "notes": None})
    add_goals(store, migrated=False)
    migrate_like_sql(store)
    assert store.gyms()[0]["name"] == "My gym" and len(store.gyms()) == 1
    assert snapshot(store) == golden()


def test_new_users_get_the_same_my_gym_and_numbers():
    # Logged through the new code: "My gym" is made on the first climb.
    store = FakeStore()
    for s in seed.seed_sessions(TODAY):
        tools.log_session(store, **s)
    add_goals(store, migrated=True)
    assert snapshot(store) == golden()


def test_migration_sql_has_the_legacy_circuit():
    """The colours and ranges the migration inserts are grades.LEGACY_CIRCUIT."""
    sql = MIGRATION.read_text()
    rows = re.findall(r"\((\d), '(\w+)',\s*'(#[0-9a-f]{6})',\s*(-?[\d.]+),\s*(-?[\d.]+)\)", sql)
    assert [(n, c, float(lo), float(hi)) for _, n, c, lo, hi in rows] == [
        (n, c, float(lo), float(hi)) for n, c, lo, hi in grades.LEGACY_CIRCUIT]
    assert [int(p) for p, *_ in rows] == list(range(1, 8))
    assert "'My gym'" in sql and grades.DEFAULT_GYM_NAME == "My gym"


# --- Grades and the index ----------------------------------------------------------

@pytest.mark.parametrize("system, text, expected", [
    ("v", "v4", "V4"), ("v", " VB ", "VB"), ("font", "6b+", "6B+"), ("font", "f7A", "7A"),
    ("font", "4", "4")])
def test_grades_are_normalised(system, text, expected):
    assert grades.normalise(system, text) == expected


@pytest.mark.parametrize("system, text", [("v", "V18"), ("v", "5.10a"), ("font", "6D"), ("x", "V1")])
def test_unknown_grades_are_refused(system, text):
    with pytest.raises(ValueError):
        grades.normalise(system, text)


def test_index_puts_v_font_and_gym_colours_on_one_scale():
    assert grades.index_of("v", "V4") == grades.index_of("font", "6B") == 4
    assert grades.index_of("font", "7A+") == 7 and grades.index_of("v", "VB") == -1
    assert grades.midpoint(3, 4) == 3.5 and grades.midpoint(None, None) is None
    assert grades.label("font", 4) == "6B" and grades.label("v", 3.5) == "V3"


def test_scale_places_climbs_between_colour_midpoints():
    scale = grades.gym_scale(gyms_with_ids(grades.legacy_gym(1)))
    # My gym's midpoints: yellow -0.5, green 0.5, blue 2, purple 3.5, red 5 ...
    assert scale.level_of_index(2) == 3          # exactly blue
    assert scale.level_of_index(2.75) == 3.5     # halfway blue -> purple
    assert scale.level_of_index(-1.5) == 0       # below yellow, extended
    assert scale.nearest(3.5) == "purple" and scale.nearest(9) == "white"


def gyms_with_ids(gym: dict, start: int = 1) -> dict:
    for i, g in enumerate(gym["grades"]):
        g["id"], g["gym_id"] = start + i, gym["id"]
    return gym


# --- Gyms --------------------------------------------------------------------------

KLATRE = [{"name": "green", "colour": "green", "range": ["V0", "V1"]},
          {"name": "yellow", "colour": "yellow", "range": ["V1", "V2"]},
          {"name": "blue", "colour": "blue", "range": ["V3", "V4"]},
          {"name": "red", "colour": "red", "range": ["V4", "V5"]},
          {"name": "black", "colour": "black"}]


def test_create_gym_orders_colours_and_stores_ranges_as_index(store):
    gym = gyms.create_gym(store, "Klatreverket", "v", KLATRE)
    assert [c["name"] for c in gym["colours"]] == ["green", "yellow", "blue", "red", "black"]
    blue = store.gyms()[0]["grades"][2]
    assert (blue["position"], blue["range_low"], blue["range_high"]) == (3, 3, 4)
    assert gym["colours"][2]["range_text"] == "V3–V4" and gym["colours"][4]["range"] is None


def test_font_ranges_convert(store):
    gym = gyms.create_gym(store, "Bloc", "font", [{"name": "blue", "colour": "blue",
                                                   "range": ["6A", "6B"]}])
    assert store.gyms()[0]["grades"][0]["range_low"] == 3
    assert gym["colours"][0]["range"] == ["6A", "6B"]


@pytest.mark.parametrize("colours, message", [
    ([], "1 to 20"),
    ([{"name": "blue", "colour": "blue"}, {"name": "Blue", "colour": "red"}], "two colours"),
    ([{"name": "blue", "colour": "teal"}], "colour must be"),
    ([{"name": "blue", "colour": "blue", "range": ["V4", "V2"]}], "goes down"),
    ([{"name": "blue", "colour": "blue", "range": ["V4"]}], "range must be"),
])
def test_bad_gyms_are_refused(store, colours, message):
    with pytest.raises(ValueError, match=message):
        gyms.create_gym(store, "Gym", "v", colours)


def test_used_colours_can_be_archived_not_deleted(store):
    tools.log_session(store, "climbing", "2026-11-10", 60, 6,
                      climbs=[{"grade": "blue", "style": "boulder", "sent": True}])
    gym = gyms.list_gyms(store)["gyms"][0]
    with pytest.raises(ValueError, match="archive"):
        gyms.update_gym(store, gym["id"], {"colours": [c for c in gym["colours"]
                                                       if c["name"] != "blue"]})
    after = gyms.update_gym(store, gym["id"], {"colours": [
        {**c, "archived": c["name"] == "blue"} for c in gym["colours"]]})
    assert "blue" not in [c["name"] for c in after["colours"] if not c["archived"]]
    # The old climb still reads as blue, and can't be logged anew.
    assert tools.get_history(store, 30, date(2026, 11, 16))[0]["climbs"][0]["grade"] == "blue"
    with pytest.raises(ValueError):
        gyms.delete_gym(store, gym["id"])


# --- Logging at gyms and in V/Font ------------------------------------------------

def test_colour_climbs_go_to_the_last_gym_used(store):
    klatre = gyms.create_gym(store, "Klatreverket", "v", KLATRE)
    tools.log_session(store, "climbing", "2026-11-10", 60, 6, climbs=[
        {"grade": "yellow", "style": "boulder", "sent": True, "gym_id": klatre["id"]}])
    s = tools.log_session(store, "climbing", "2026-11-12", 60, 6, climbs=[
        {"grade": "Blue", "style": "boulder", "sent": True}])
    assert s["climbs"][0]["gym_id"] == klatre["id"] and s["climbs"][0]["grade_ordinal"] == 3


def test_v_and_font_climbs_need_no_gym(store):
    s = tools.log_session(store, "climbing", "2026-11-10", 60, 6, climbs=[
        {"grade": "v4", "grade_system": "v", "style": "boulder", "sent": True},
        {"grade": "6b+", "grade_system": "font", "style": "rope", "sent": False}])
    assert [(c["grade"], c["gym_id"], c["grade_ordinal"]) for c in s["climbs"]] == [
        ("V4", None, None), ("6B+", None, None)]
    assert store.gyms() == []  # no gym was needed


@pytest.mark.parametrize("climb, message", [
    ({"grade": "orange"}, "must be one of"),
    ({"grade": "V4", "grade_system": "v", "gym_id": 99}, "gym 99 not found"),
    ({"grade": "blue", "grade_system": "yds"}, "grade_system"),
    ({"grade": "V19", "grade_system": "v"}, "not a V grade")])
def test_bad_climbs_are_refused(store, climb, message):
    with pytest.raises(ValueError, match=message):
        tools.log_session(store, "climbing", "2026-11-10", 60, 6,
                          climbs=[{"style": "boulder", "sent": True, **climb}])


def test_drafts_do_not_create_a_gym(store):
    d = tools.draft_session(store, "climbing", "2026-11-10", 60, 6,
                            climbs=[{"grade": "red", "style": "boulder", "sent": True}])
    assert d["climbs"][0]["grade_ordinal"] == 5 and store.gyms() == []


def test_v4_font_6b_and_a_gym_blue_share_one_progression_chart(store):
    klatre = gyms.create_gym(store, "Klatreverket", "v", KLATRE)
    tools.log_session(store, "climbing", "2026-11-09", 60, 6, climbs=[
        {"grade": "blue", "style": "boulder", "sent": True, "gym_id": klatre["id"]},
        {"grade": "blue", "style": "boulder", "sent": True, "gym_id": klatre["id"]}])
    tools.log_session(store, "climbing", "2026-11-10", 60, 6, climbs=[
        {"grade": "V4", "grade_system": "v", "style": "boulder", "sent": True}])
    tools.log_session(store, "climbing", "2026-11-11", 60, 6, climbs=[
        {"grade": "6B", "grade_system": "font", "style": "boulder", "sent": True}])
    p = tools.calculate_progression(store, 2, date(2026, 11, 16))["climbing"]
    # Klatreverket has the most climbs, so its colours are the scale.
    assert p["grade_scale"] == ["green", "yellow", "blue", "red", "black"]
    assert p["grade_scale_gym"] == "Klatreverket"
    assert set(p["trends"]["send_rate_by_grade"]) == {"blue", "V4", "6B"}
    week = p["weekly"][0]
    assert week["climbs"] == 4 and week["hardest_sent"] in ("V4", "6B")


def test_a_colour_without_a_range_elsewhere_still_counts_as_a_climb(store):
    tools.log_session(store, "climbing", "2026-11-09", 60, 6, climbs=[
        {"grade": "red", "style": "boulder", "sent": True},
        {"grade": "blue", "style": "boulder", "sent": True}])  # My gym, made now: the scale
    klatre = gyms.create_gym(store, "Klatreverket", "v", KLATRE)
    tools.log_session(store, "climbing", "2026-11-10", 60, 6, climbs=[
        {"grade": "black", "style": "boulder", "sent": True, "gym_id": klatre["id"]}])
    p = tools.calculate_progression(store, 2, date(2026, 11, 16))["climbing"]
    week = p["weekly"][0]
    # Klatreverket's black has no range: counted, but not placed on My gym's scale.
    assert week["climbs"] == 3 and week["hardest_sent"] == "red"
    assert "black (Klatreverket)" in p["trends"]["send_rate_by_grade"]


# --- Goals ---------------------------------------------------------------------------

def test_a_goal_is_reached_by_an_equally_hard_climb_anywhere(store):
    tools.log_session(store, "climbing", "2026-11-01", 60, 6, climbs=[
        {"grade": "blue", "style": "boulder", "sent": True}])  # My gym
    tools.set_goal(store, "climb_grade", grade="red", climb_mode="send", today=date(2026, 11, 2))
    klatre = gyms.create_gym(store, "Klatreverket", "v", KLATRE)
    # Klatreverket's blue is V3-V4 (3.5): easier than My gym's red (V4-V6, 5).
    tools.log_session(store, "climbing", "2026-11-05", 60, 6, climbs=[
        {"grade": "blue", "style": "boulder", "sent": True, "gym_id": klatre["id"]}])
    [goal] = tools.list_goals(store, date(2026, 11, 6))
    assert goal["status"] == "active" and goal["progress"]["best_grade"] == "purple"
    # V5 outdoors is index 5, as hard as red's midpoint.
    tools.log_session(store, "climbing", "2026-11-08", 60, 6, climbs=[
        {"grade": "V5", "grade_system": "v", "style": "boulder", "sent": True}])
    [goal] = tools.list_goals(store, date(2026, 11, 9))
    assert goal["status"] == "achieved" and goal["achieved_on"] == "2026-11-08"
    assert goal["progress"]["reached_with"] == {"grade": "V5", "grade_system": "v",
                                                "gym": None, "about": "V5"}


def test_a_goal_without_a_range_counts_only_its_own_gym(store):
    klatre = gyms.create_gym(store, "Klatreverket", "v", KLATRE)
    tools.set_goal(store, "climb_grade", grade="black", climb_mode="send", gym_id=klatre["id"],
                   today=date(2026, 11, 1))
    tools.log_session(store, "climbing", "2026-11-05", 60, 6, climbs=[
        {"grade": "V12", "grade_system": "v", "style": "boulder", "sent": True}])
    [goal] = tools.list_goals(store, date(2026, 11, 6))
    assert goal["status"] == "active"
    tools.log_session(store, "climbing", "2026-11-07", 60, 6, climbs=[
        {"grade": "black", "style": "boulder", "sent": True, "gym_id": klatre["id"]}])
    [goal] = tools.list_goals(store, date(2026, 11, 8))
    assert goal["status"] == "achieved"
    assert goal["progress"]["reached_with"]["gym"] == "Klatreverket"


def test_v_goals(store):
    g = tools.set_goal(store, "climb_grade", grade="v6", climb_mode="flash", grade_system="v",
                       today=date(2026, 11, 1))
    assert (g["grade"], g["grade_system"], g["gym_id"]) == ("V6", "v", None)
    tools.log_session(store, "climbing", "2026-11-05", 60, 6, climbs=[
        {"grade": "7A", "grade_system": "font", "style": "boulder", "sent": True, "attempts": 1}])
    [goal] = tools.list_goals(store, date(2026, 11, 6))
    assert goal["status"] == "achieved"


# --- API -------------------------------------------------------------------------------

@pytest.fixture
def http(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def test_gym_endpoints(http):
    res = http.post("/gyms", json={"name": "Klatreverket", "colours": KLATRE})
    assert res.status_code == 201
    gym = res.json()
    listed = http.get("/gyms").json()
    assert listed["gyms"] == [gym] and listed["last_gym_id"] is None

    colours = gym["colours"]
    res = http.patch(f"/gyms/{gym['id']}", json={"name": "KV", "colours": colours[::-1]})
    assert res.status_code == 200
    assert res.json()["name"] == "KV" and res.json()["colours"][0]["name"] == "black"

    assert http.patch(f"/gyms/{gym['id']}", json={}).status_code == 422
    assert http.patch("/gyms/99", json={"name": "x"}).status_code == 404
    assert http.post("/gyms", json={"name": "X", "colours": [{"name": "a", "colour": "teal"}]}
                     ).status_code == 422
    http.post("/sessions", json={"sport": "climbing", "date": "2026-11-10", "duration_min": 60,
                                 "effort": 6, "climbs": [{"grade": "blue", "style": "boulder",
                                                          "sent": True, "gym_id": gym["id"]}]})
    assert http.delete(f"/gyms/{gym['id']}").status_code == 409
    assert http.patch(f"/gyms/{gym['id']}", json={"archived": True}).json()["archived"] is True


def test_post_session_with_v_grades(http):
    res = http.post("/sessions", json={
        "sport": "climbing", "date": "2026-11-10", "duration_min": 60, "effort": 6,
        "climbs": [{"grade": "V5", "grade_system": "v", "style": "boulder", "sent": True}]})
    assert res.status_code == 201 and res.json()["climbs"][0]["grade"] == "V5"
    bad = http.post("/sessions", json={
        "sport": "climbing", "date": "2026-11-10", "duration_min": 60, "effort": 6,
        "climbs": [{"grade": "V5", "grade_system": "yds", "style": "boulder", "sent": True}]})
    assert bad.status_code == 422
