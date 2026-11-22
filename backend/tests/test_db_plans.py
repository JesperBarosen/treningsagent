"""RLS and constraint tests for training plans (#116, docs/training-plans.md section 7).

Against a real Supabase Postgres with migrations
20261118120000_create_training_plans.sql and
20261118120100_create_planned_sessions.sql applied (and the earlier ones).
Skipped unless TEST_DATABASE_URL is set, like test_db.py.
"""

import psycopg
import pytest

import tools
from test_db import ROW, URL, conn, make_store  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

REFUSED = (ValueError, psycopg.errors.InsufficientPrivilege)  # RLS or a check refuses it

PLAN = {"name": "Base", "start_date": "2026-11-23", "weeks": 6,
        "week_meta": [{"index": 1, "kind": "build", "note": None}], "source": "user"}
PLANNED = {"date": "2026-11-24", "slot": 0, "sport": "running", "title": "Easy run",
           "target": {"duration_min": 35, "effort": 4}}


def goal(store) -> dict:
    return store.insert_goal({"kind": "run_pace", "band": "7_to_15km", "target_pace": 5.0,
                              "created_on": "2026-11-18"})


def test_users_only_see_their_own_plans_and_planned_sessions(conn):
    alice, bob = make_store(conn), make_store(conn)
    alice.insert_plan(PLAN, [PLANNED])
    alice.insert_planned({**PLANNED, "date": "2026-11-30"})
    assert bob.plans() == [] and bob.planned_sessions() == []
    with bob._as_user() as c:
        assert c.execute("select count(*) as n from public.planned_sessions").fetchone()["n"] == 0
    [plan] = alice.plans()
    assert plan["week_meta"] == PLAN["week_meta"] and plan["start_date"] == "2026-11-23"
    assert [p["target"] for p in alice.planned_sessions(plan_id=plan["id"])] == [PLANNED["target"]]


def test_a_plan_cannot_serve_another_users_goal(conn):
    alice, bob = make_store(conn), make_store(conn)
    g = goal(alice)
    with pytest.raises(REFUSED):
        bob.insert_plan({**PLAN, "goal_id": g["id"]}, [])
    plan = bob.insert_plan(PLAN, [])
    with pytest.raises(REFUSED):
        bob.update_plan(plan["id"], {"goal_id": g["id"]})


def test_planned_sessions_only_reference_the_users_own_rows(conn):
    alice, bob = make_store(conn), make_store(conn)
    plan = alice.insert_plan(PLAN, [])
    template = tools.add_starters(alice, ["Fingerboard"])[0]
    session_id = alice.insert_session(ROW)
    for ref in ({"plan_id": plan["id"]}, {"template_id": template["id"], "sport": "other"},
                {"session_id": session_id}):
        with pytest.raises(REFUSED):
            bob.insert_planned({**PLANNED, **ref})
    mine = bob.insert_planned(PLANNED)
    for ref in ({"template_id": template["id"], "sport": "other"}, {"session_id": session_id}):
        with pytest.raises(REFUSED):
            bob.update_planned(mine["id"], ref)


def test_cannot_change_or_delete_another_users_rows(conn):
    alice, bob = make_store(conn), make_store(conn)
    plan = alice.insert_plan(PLAN, [PLANNED])
    [planned] = alice.planned_sessions(plan_id=plan["id"])
    assert bob.update_plan(plan["id"], {"name": "Mine now"}) is None
    assert bob.update_planned(planned["id"], {"title": "Mine now"}) is None
    assert bob.delete_planned(planned["id"]) is False
    with bob._as_user() as c:
        assert c.execute("delete from public.training_plans where id = %s returning id",
                         (plan["id"],)).fetchone() is None
    assert alice.plans()[0]["name"] == "Base"


def test_one_active_or_paused_plan_per_user(conn):
    store, other = make_store(conn), make_store(conn)
    plan = store.insert_plan(PLAN, [])
    with pytest.raises(RuntimeError):
        store.insert_plan(PLAN, [])
    store.update_plan(plan["id"], {"status": "paused"})
    with pytest.raises(RuntimeError):
        store.insert_plan(PLAN, [])
    store.update_plan(plan["id"], {"status": "left", "ended_on": "2026-11-18"})
    store.insert_plan(PLAN, [])
    other.insert_plan(PLAN, [])  # per user, not global


def test_a_session_links_to_one_planned_session_and_unlinks_on_delete(conn):
    store = make_store(conn)
    session_id = store.insert_session(ROW)
    a = store.insert_planned(PLANNED)
    b = store.insert_planned({**PLANNED, "slot": 1})
    store.update_planned(a["id"], {"session_id": session_id})
    with pytest.raises(ValueError):  # unique
        store.update_planned(b["id"], {"session_id": session_id})
    store.delete_session(session_id)
    assert store.get_planned(a["id"])["session_id"] is None


def test_constraints(conn):
    store = make_store(conn)
    for bad in ({"start_date": "2026-11-24"}, {"weeks": 13}, {"weeks": 3}, {"name": ""},
                {"status": "left"},  # left without ended_on
                {"week_meta": {"index": 1}}):
        with pytest.raises(ValueError):
            store.insert_plan({**PLAN, **bad}, [])
    for bad in ({"slot": 2}, {"title": ""}, {"sport": "yoga"}, {"target": []},
                {"skip_reason": "Sick"},  # only when skipped
                {"status": "done"}):
        with pytest.raises(ValueError):
            store.insert_planned({**PLANNED, **bad})
    p = store.insert_planned({**PLANNED, "status": "skipped", "skip_reason": "Sick"})
    assert p["skip_reason"] == "Sick"


def test_column_grants_keep_owner_and_plan_fixed(conn):
    store = make_store(conn)
    plan = store.insert_plan(PLAN, [PLANNED])
    [planned] = store.planned_sessions(plan_id=plan["id"])
    other = store.insert_plan({**PLAN, "status": "left", "ended_on": "2026-11-18"}, [])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        store.update_planned(planned["id"], {"plan_id": other["id"]})
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        store.update_plan(plan["id"], {"user_id": make_store(conn).user_id})


def test_deleting_the_goal_keeps_the_plan(conn):
    store = make_store(conn)
    g = goal(store)
    plan = store.insert_plan({**PLAN, "goal_id": g["id"]}, [])
    store.delete_goal(g["id"])
    assert store.plans()[0]["id"] == plan["id"] and store.plans()[0]["goal_id"] is None


def test_a_change_proposal_is_applied_in_one_transaction_and_refused_when_stale(conn):
    """#131: apply_plan_changes locks the plan, checks its fingerprint again
    and writes everything or nothing."""
    import plans
    store = make_store(conn)
    plan = store.insert_plan(PLAN, [PLANNED])
    [p] = store.planned_sessions(plan_id=plan["id"])
    version = plans.plan_version(plan, [p])
    store.apply_plan_changes(plan["id"], version, plans.plan_version, {"weeks": 7},
                             [(p["id"], {"date": "2026-11-25"})],
                             [{**PLANNED, "date": "2026-11-26", "slot": 0}])
    assert [r["date"] for r in store.planned_sessions(plan_id=plan["id"])] == ["2026-11-25", "2026-11-26"]
    assert store.plans()[0]["weeks"] == 7
    with pytest.raises(RuntimeError, match="changed since"):
        store.apply_plan_changes(plan["id"], version, plans.plan_version, {}, [(p["id"], {"date": "2026-11-27"})], [])
    # A failing write rolls back the whole change.
    fresh = plans.plan_version(store.plans()[0], store.planned_sessions(plan_id=plan["id"]))
    with pytest.raises(ValueError):
        store.apply_plan_changes(plan["id"], fresh, plans.plan_version, {},
                                 [(p["id"], {"date": "2026-11-28"})], [{**PLANNED, "title": ""}])
    assert store.planned_sessions(plan_id=plan["id"])[0]["date"] == "2026-11-25"
