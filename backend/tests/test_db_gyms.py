"""RLS and constraint tests for gyms (#98, docs/custom-log-forms.md section 4).

Against a real Supabase Postgres with migrations 20261116120000_create_gyms.sql
and 20261116120100_climb_grade_systems.sql applied. Skipped unless
TEST_DATABASE_URL is set, like test_db.py, whose fixtures these reuse.
"""

import psycopg
import pytest

import gyms
from test_db import CLIMBING, URL, climbs_at_my_gym, conn, make_store  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


def my_gym(store) -> dict:
    return gyms.default_gym(store, store.gyms(), create=True)


def test_users_only_see_their_own_gyms(conn):
    alice, bob = make_store(conn), make_store(conn)
    my_gym(alice)
    assert bob.gyms() == []
    with bob._as_user() as c:  # not even through a direct query
        assert c.execute("select count(*) as n from public.gym_grades").fetchone()["n"] == 0


def test_cannot_add_colours_to_another_users_gym(conn):
    alice, bob = make_store(conn), make_store(conn)
    gym = my_gym(alice)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with bob._as_user() as c:
            bob._insert(c, "gym_grades", {"gym_id": gym["id"], "position": 8, "name": "pink",
                                          "colour": "#ffffff"})
    assert len(my_gym(alice)["grades"]) == 7


def test_cannot_log_a_climb_at_another_users_gym(conn):
    alice, bob = make_store(conn), make_store(conn)
    gym = my_gym(alice)
    session_id = bob.insert_session(CLIMBING)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with bob._as_user() as c:  # bob's own session, alice's gym
            bob._insert(c, "climbs", {"grade": "V3", "grade_system": "v", "gym_id": gym["id"],
                                      "sent": True, "style": "boulder", "session_id": session_id})
    blue = next(g for g in gym["grades"] if g["name"] == "blue")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with bob._as_user() as c:
            bob._insert(c, "climbs", {"grade": "blue", "grade_system": "gym", "gym_id": gym["id"],
                                      "gym_grade_id": blue["id"], "sent": True,
                                      "style": "boulder", "session_id": session_id})


def test_cannot_set_a_goal_at_another_users_gym(conn):
    alice, bob = make_store(conn), make_store(conn)
    gym = my_gym(alice)
    red = next(g for g in gym["grades"] if g["name"] == "red")
    with pytest.raises(ValueError):
        bob.insert_goal({"kind": "climb_grade", "grade": "red", "climb_mode": "send",
                         "grade_system": "gym", "gym_id": gym["id"], "gym_grade_id": red["id"],
                         "created_on": "2026-11-16"})
    assert bob.goals() == []


def test_a_colour_must_belong_to_the_climbs_gym(conn):
    store = make_store(conn)
    [blue, _] = climbs_at_my_gym(store)
    other = gyms.create_gym(store, "Klatreverket", "v", [{"name": "green", "colour": "green"}])
    with pytest.raises(ValueError):  # My gym's blue, Klatreverket's id
        store.insert_session(CLIMBING, [{**blue, "gym_id": other["id"]}])


def test_used_colours_and_gyms_are_archived_not_deleted(conn):
    store = make_store(conn)
    climbs = climbs_at_my_gym(store)
    store.insert_session(CLIMBING, climbs)
    gym = gyms.list_gyms(store)["gyms"][0]
    without_blue = [c for c in gym["colours"] if c["name"] != "blue"]
    with pytest.raises(ValueError):
        gyms.update_gym(store, gym["id"], {"colours": without_blue})
    archived = [{**c, "archived": c["name"] == "blue"} for c in gym["colours"]]
    after = gyms.update_gym(store, gym["id"], {"colours": archived})
    assert [c["name"] for c in after["colours"] if not c["archived"]] == [
        "yellow", "green", "purple", "red", "black", "white"]
    with pytest.raises(ValueError):
        gyms.delete_gym(store, gym["id"])
    # An unused gym can go.
    spare = gyms.create_gym(store, "Spare", "v", [{"name": "green", "colour": "green"}])
    gyms.delete_gym(store, spare["id"])


def test_reordering_colours_keeps_one_per_position(conn):
    store = make_store(conn)
    gym = gyms.list_gyms(store)["gyms"] or [gyms.view(my_gym(store))]
    colours = gym[0]["colours"]
    swapped = [colours[1], colours[0], *colours[2:]]
    after = gyms.update_gym(store, gym[0]["id"], {"colours": swapped})
    assert [c["name"] for c in after["colours"]][:2] == ["green", "yellow"]
