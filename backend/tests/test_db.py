"""Integration tests against a real Supabase Postgres with the migrations applied.

Skipped unless TEST_DATABASE_URL is set, so the default test run stays offline.
Rows are written under random user ids and deleted afterwards.
"""

import os
import uuid

import psycopg
import pytest

import db

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


@pytest.fixture
def conn():
    conn = db.connect(URL)
    user_ids = []
    yield conn, user_ids
    # Clean up as the connection's own role, which RLS doesn't restrict.
    # Deleting the users cascades to all their rows.
    for user_id in user_ids:
        db.delete_auth_user(conn, user_id)
    conn.close()


def make_store(conn_and_ids):
    conn, user_ids = conn_and_ids
    user_ids.append(str(uuid.uuid4()))
    db.ensure_auth_user(conn, user_ids[-1])
    return db.PostgresStore(conn, user_ids[-1])


ROW = {"sport": "running", "date": "2026-11-10", "duration_min": 30, "effort": 5,
       "notes": None, "distance_km": 6.0}


def test_insert_and_read_back(conn):
    store = make_store(conn)
    session_id = store.insert_session(ROW)
    [row] = store.sessions_since("2026-11-01")
    assert row["id"] == session_id
    assert row["date"] == "2026-11-10" and row["distance_km"] == 6.0


def test_first_session_date(conn):
    store = make_store(conn)
    assert store.first_session_date() is None
    store.insert_session(ROW)
    store.insert_session({**ROW, "date": "2026-09-01"})
    assert store.first_session_date() == "2026-09-01"
    assert make_store(conn).first_session_date() is None  # another user's rows are hidden


def test_chat_requests_are_limited_per_user(conn):
    alice, bob = make_store(conn), make_store(conn)
    assert alice.claim_chat_request(2) and alice.claim_chat_request(2)
    assert not alice.claim_chat_request(2)
    assert bob.claim_chat_request(2)  # alice's requests don't count for bob


def test_rows_need_a_real_auth_user(conn):
    ghost = db.PostgresStore(conn[0], str(uuid.uuid4()))  # not in auth.users
    with pytest.raises(ValueError):
        ghost.insert_session(ROW)


def test_users_only_see_their_own_rows(conn):
    alice, bob = make_store(conn), make_store(conn)
    alice.insert_session(ROW)
    assert bob.sessions_since("2000-01-01") == []
    assert len(alice.sessions_since("2000-01-01")) == 1


def test_constraint_violation_becomes_value_error(conn):
    with pytest.raises(ValueError):
        make_store(conn).insert_session({**ROW, "effort": 11})


def test_model_calls_are_private_too(conn):
    alice, bob = make_store(conn), make_store(conn)
    alice.log_model_call({"conversation_id": str(uuid.uuid4()), "model": "claude-haiku-5-5",
                          "input_tokens": 100, "output_tokens": 20, "latency_ms": 900,
                          "stop_reason": "end_turn"})
    with bob._as_user() as c:
        assert c.execute("select count(*) as n from public.model_calls").fetchone()["n"] == 0
    with alice._as_user() as c:
        assert c.execute("select count(*) as n from public.model_calls").fetchone()["n"] == 1


CLIMBING = {"sport": "climbing", "date": "2026-11-10", "duration_min": 90, "effort": 7}
CLIMBS = [
    {"grade": "blue", "grade_ordinal": 3, "attempts": 2, "sent": True, "style": "boulder"},
    {"grade": "red", "grade_ordinal": 5, "attempts": None, "sent": False, "style": "kilter",
     "notes": "crimpy"},
]


def test_session_with_climbs_round_trip(conn):
    store = make_store(conn)
    session_id = store.insert_session(CLIMBING, CLIMBS)
    climbs = store.climbs_since("2026-11-10")
    assert [c["session_id"] for c in climbs] == [session_id, session_id]
    assert [(c["grade"], c["grade_ordinal"], c["sent"]) for c in climbs] == [
        ("blue", 3, True), ("red", 5, False)]
    assert store.climbs_since("2026-11-11") == []


def test_users_only_see_their_own_climbs(conn):
    alice, bob = make_store(conn), make_store(conn)
    alice.insert_session(CLIMBING, CLIMBS)
    assert bob.climbs_since("2000-01-01") == []
    with bob._as_user() as c:  # not even through a direct query
        assert c.execute("select count(*) as n from public.climbs").fetchone()["n"] == 0


def test_cannot_add_climbs_to_another_users_session(conn):
    alice, bob = make_store(conn), make_store(conn)
    session_id = alice.insert_session(CLIMBING)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with bob._as_user() as c:
            bob._insert(c, "climbs", {**CLIMBS[0], "session_id": session_id})
    assert alice.climbs_since("2000-01-01") == []


def test_grade_ordinal_must_match_colour(conn):
    store = make_store(conn)
    with pytest.raises(ValueError):
        store.insert_session(CLIMBING, [{**CLIMBS[0], "grade_ordinal": 4}])
    # The session and its climbs are one transaction: nothing was stored.
    assert store.sessions_since("2000-01-01") == []
