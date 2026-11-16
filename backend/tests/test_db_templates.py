"""RLS and constraint tests for session templates (#100, docs/custom-log-forms.md section 4).

Against a real Supabase Postgres with migrations
20261116130000_create_session_templates.sql and
20261116130100_session_templates_on_sessions.sql applied (and the earlier
ones). Skipped unless TEST_DATABASE_URL is set, like test_db.py.
"""

import psycopg
import pytest

import tools
from test_db import ROW, URL, conn, make_store  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

HANGS = {"hangs": [{"sets": 6, "reps": 10, "edge_mm": 20, "load": 10}]}


def fingerboard(store) -> dict:
    return tools.add_starters(store, ["Fingerboard"])[0]


def test_users_only_see_their_own_templates(conn):
    alice, bob = make_store(conn), make_store(conn)
    fingerboard(alice)
    assert bob.templates() == []
    with bob._as_user() as c:
        assert c.execute("select count(*) as n from public.session_templates").fetchone()["n"] == 0


def test_cannot_log_a_session_with_another_users_template(conn):
    alice, bob = make_store(conn), make_store(conn)
    t = fingerboard(alice)
    with pytest.raises((ValueError, psycopg.errors.InsufficientPrivilege)):  # RLS refuses it
        bob.insert_session({"sport": "other", "date": "2026-11-10", "duration_min": 40, "effort": 7,
                            "template_id": t["id"], "custom_values": HANGS})
    assert bob.sessions_since("2000-01-01") == []


def test_cannot_move_a_session_onto_another_users_template(conn):
    alice, bob = make_store(conn), make_store(conn)
    t = fingerboard(alice)
    session_id = bob.insert_session({**ROW, "sport": "other", "distance_km": None})
    with pytest.raises((ValueError, psycopg.errors.InsufficientPrivilege)):
        bob.update_session(session_id, {"template_id": t["id"], "custom_values": HANGS}, None)


def test_cannot_change_or_delete_another_users_template(conn):
    alice, bob = make_store(conn), make_store(conn)
    t = fingerboard(alice)
    assert bob.update_template(t["id"], {"name": "Mine now"}) is None
    assert bob.delete_template(t["id"]) is False
    assert alice.templates()[0]["name"] == "Fingerboard"


def test_templated_sessions_round_trip_and_keep_their_template(conn):
    store = make_store(conn)
    t = fingerboard(store)
    s = tools.log_session(store, "other", "2026-11-10", 40, 7, template_id=t["id"], values=HANGS)
    [row] = store.sessions_since("2026-11-10")
    assert row["template_id"] == t["id"] and row["custom_values"] == HANGS
    assert store.template_value_keys(t["id"]) == {"hangs"}
    with pytest.raises(ValueError):  # used: archive, don't delete
        store.delete_template(t["id"])
    tools.update_template(store, t["id"], {"archived": True})
    assert tools.update_session(store, s["id"], {"effort": 8})["custom_values"] == HANGS


def test_strength_and_other_are_sports_now(conn):
    store = make_store(conn)
    store.insert_session({**ROW, "sport": "strength", "distance_km": None})
    store.insert_session({**ROW, "sport": "other", "distance_km": None})
    with pytest.raises(ValueError):
        store.insert_session({**ROW, "sport": "yoga", "distance_km": None})


def test_custom_values_must_be_an_object(conn):
    store = make_store(conn)
    t = fingerboard(store)
    with pytest.raises(ValueError):
        store.insert_session({"sport": "other", "date": "2026-11-10", "duration_min": 40, "effort": 7,
                              "template_id": t["id"], "custom_values": [1, 2]})
