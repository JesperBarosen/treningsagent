"""RLS and constraint tests for the training profile (#137).

Against a real Supabase Postgres with migration
20261119120000_create_training_profiles.sql applied. Skipped unless
TEST_DATABASE_URL is set, like test_db.py.
"""

import psycopg
import pytest

import training_profile as tp
from test_db import URL, conn, make_store  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


def test_save_and_read_back_and_update_only_the_given_fields(conn):
    store = make_store(conn)
    assert store.get_profile() is None
    store.save_profile(tp.validate_changes({"sessions_per_week": 3, "preferred_days": ["tue", "sat"],
                                            "injuries": [{"body_part": "calf", "pain": 3}]}))
    store.save_profile({"onboarding": "done"})
    p = store.get_profile()
    assert p["sessions_per_week"] == 3 and p["preferred_days"] == ["tuesday", "saturday"]
    assert p["injuries"] == [{"body_part": "calf", "pain": 3, "note": None}] and p["onboarding"] == "done"


def test_users_only_see_and_change_their_own_profile(conn):
    alice, bob = make_store(conn), make_store(conn)
    alice.save_profile({"goals_note": "alice's"})
    assert bob.get_profile() is None
    bob.save_profile({"goals_note": "bob's"})  # bob's own row, not alice's
    assert alice.get_profile()["goals_note"] == "alice's"
    with bob._as_user() as c:
        assert c.execute("select count(*) as n from public.training_profiles").fetchone()["n"] == 1


def test_constraints(conn):
    store = make_store(conn)
    for bad in ({"sessions_per_week": 20}, {"preferred_days": ["someday"]}, {"onboarding": "maybe"},
                {"longest_run_km": 0}):
        with pytest.raises(ValueError):
            store.save_profile(bad)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):  # user_id can't be changed
        with store._as_user() as c:
            c.execute("update public.training_profiles set user_id = gen_random_uuid()")
