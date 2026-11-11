"""Integration tests against a real Supabase Postgres with the migrations applied.

Skipped unless TEST_DATABASE_URL is set, so the default test run stays offline.
Rows are written under random user ids and deleted afterwards.
"""

import os
import uuid

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
    conn.execute("delete from public.sessions where user_id = any(%s)", (user_ids,))
    conn.close()


def make_store(conn_and_ids):
    conn, user_ids = conn_and_ids
    user_ids.append(str(uuid.uuid4()))
    return db.PostgresStore(conn, user_ids[-1])


ROW = {"sport": "running", "date": "2026-11-10", "duration_min": 30, "effort": 5,
       "notes": None, "distance_km": 6.0}


def test_insert_and_read_back(conn):
    store = make_store(conn)
    session_id = store.insert_session(ROW)
    [row] = store.sessions_since("2026-11-01")
    assert row["id"] == session_id
    assert row["date"] == "2026-11-10" and row["distance_km"] == 6.0


def test_users_only_see_their_own_rows(conn):
    alice, bob = make_store(conn), make_store(conn)
    alice.insert_session(ROW)
    assert bob.sessions_since("2000-01-01") == []
    assert len(alice.sessions_since("2000-01-01")) == 1


def test_constraint_violation_becomes_value_error(conn):
    with pytest.raises(ValueError):
        make_store(conn).insert_session({**ROW, "effort": 11})
