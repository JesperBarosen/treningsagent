"""Row Level Security and grants, checked against a real database (#163).

Two users, A and B, each with a row in every table that holds user data. A
works through PostgresStore (role authenticated, A's id in the JWT) and must
not be able to read, change, delete or point at B's rows. anon must reach
nothing. Skipped unless TEST_DATABASE_URL is set, like test_db.py; CI runs it
against a local Supabase database built from supabase/migrations/.

Every attempt runs in a transaction that is rolled back, so a failing check
can't leave rows behind, and the users are deleted (cascading to their rows)
at the end.
"""

import os
import uuid
from contextlib import contextmanager

import psycopg
import pytest

import db

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

# What RLS or a missing grant raises: "new row violates row-level security
# policy" and "permission denied" are both SQLSTATE 42501.
REFUSED = psycopg.errors.InsufficientPrivilege

# Every public table with user data, and a column each user may update on
# their own rows (so a refused update is RLS at work, not a missing grant).
TABLES = {
    "sessions": "notes",
    "climbs": "notes",
    "model_calls": "model",
    "chat_requests": "created_at",
    "ui_events": "event",
    "week_reviews": "note",
    "pauses": "note",
    "goals": "target_date",
    "gyms": "name",
    "gym_grades": "name",
    "session_templates": "name",
    "training_plans": "name",
    "planned_sessions": "title",
    "training_profiles": "goals_note",
}


def seed(conn: psycopg.Connection, uid: str) -> dict[str, int]:
    """One row per table for `uid`, written as the connection's own role (which RLS
    doesn't restrict). Returns the ids that other tables point at."""
    one = lambda q, *p: conn.execute(q, (uid, *p)).fetchone()  # noqa: E731
    ids = {}
    ids["session"] = one("insert into public.sessions (user_id, sport, date, duration_min, effort)"
                         " values (%s, 'climbing', '2026-11-10', 60, 5) returning id")["id"]
    ids["template"] = one("insert into public.session_templates (user_id, name, sport)"
                          " values (%s, 'Hangboard', 'strength') returning id")["id"]
    ids["gym"] = one("insert into public.gyms (user_id, name) values (%s, 'Home gym') returning id")["id"]
    ids["gym_grade"] = one(
        "insert into public.gym_grades (user_id, gym_id, position, name, colour, range_low, range_high)"
        " values (%s, %s, 1, 'green', '#3fae5f', 0, 1) returning id", ids["gym"])["id"]
    one("insert into public.climbs (user_id, session_id, grade, sent, style, grade_system, gym_id,"
        " gym_grade_id) values (%s, %s, 'green', true, 'boulder', 'gym', %s, %s) returning id",
        ids["session"], ids["gym"], ids["gym_grade"])
    ids["goal"] = one("insert into public.goals (user_id, kind, band, target_pace)"
                      " values (%s, 'run_pace', '7_to_15km', 5.5) returning id")["id"]
    ids["plan"] = one("insert into public.training_plans (user_id, name, start_date, weeks, goal_id)"
                      " values (%s, 'Base', '2026-11-23', 4, %s) returning id", ids["goal"])["id"]
    one("insert into public.planned_sessions (user_id, plan_id, date, sport, title)"
        " values (%s, %s, '2026-11-24', 'running', 'Easy run') returning id", ids["plan"])
    one("insert into public.model_calls (user_id, conversation_id, model, input_tokens, output_tokens,"
        " latency_ms) values (%s, gen_random_uuid(), 'test-model', 1, 1, 1) returning id")
    one("insert into public.chat_requests (user_id) values (%s) returning id")
    one("insert into public.ui_events (user_id, event) values (%s, 'rls_test') returning id")
    one("insert into public.week_reviews (user_id, week_start, status)"
        " values (%s, '2026-11-09', 'done') returning user_id")
    one("insert into public.pauses (user_id, start_date, reason)"
        " values (%s, '2026-11-01', 'travel') returning id")
    one("insert into public.training_profiles (user_id, weekly_run_km) values (%s, 20) returning user_id")
    return ids


@pytest.fixture(scope="module")
def world():
    conn = db.connect(URL)
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    for uid in (a, b):
        db.ensure_auth_user(conn, uid)
    try:
        ids = {a: seed(conn, a), b: seed(conn, b)}
        yield conn, db.PostgresStore(conn, a), db.PostgresStore(conn, b), ids
    finally:
        for uid in (a, b):
            db.delete_auth_user(conn, uid)
        conn.close()


class _Rollback(Exception):
    pass


def attempt(context, query: str, params=()) -> int:
    """Run `query` in `context`, return the rows it touched, and roll it back.
    Raises REFUSED when RLS or a grant stops it."""
    try:
        with context() as c:
            raise _Rollback(c.execute(query, params).rowcount)
    except _Rollback as done:
        return done.args[0]


@contextmanager
def as_anon(conn: psycopg.Connection):
    """A transaction as the anon role, with no user in the JWT (a signed-out caller)."""
    with conn.transaction():
        conn.execute("set local role anon")
        conn.execute("select set_config('request.jwt.claims', '{\"role\": \"anon\"}', true)")
        yield conn


def touched_or_refused(context, query: str, params=()) -> int:
    """The rows `query` touched, with a refusal counted as 0."""
    try:
        return attempt(context, query, params)
    except REFUSED:
        return 0


def count_as(context, table: str, uid: str) -> int:
    try:
        with context() as c:
            return c.execute(f"select count(*) as n from public.{table} where user_id = %s",
                             (uid,)).fetchone()["n"]
    except REFUSED:
        return 0


def has_policy(conn, table: str, command: str) -> bool:
    """Whether users have a policy for `command` on `table` (ui_events has no select
    policy, climbs no update policy): only then can A do it to their own rows."""
    return conn.execute("select exists (select 1 from pg_policies where schemaname = 'public'"
                        " and tablename = %s and cmd in (%s, 'ALL')) as p",
                        (table, command)).fetchone()["p"]


def rows_of(conn, table: str, uid: str) -> int:
    return conn.execute(f"select count(*) as n from public.{table} where user_id = %s",
                        (uid,)).fetchone()["n"]


# --- Every table with user data is covered, and has RLS on ---------------------------

def test_every_table_with_a_user_id_is_covered_here(world):
    conn = world[0]
    found = {r["table_name"] for r in conn.execute(
        "select table_name from information_schema.columns"
        " where table_schema = 'public' and column_name = 'user_id'")}
    assert found == set(TABLES), "add new user-data tables to TABLES and seed() in this file"


def test_every_table_in_public_has_rls_enabled(world):
    conn = world[0]
    missing = [r["relname"] for r in conn.execute(
        "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace"
        " where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity")]
    assert missing == []


def test_app_roles_hold_no_truncate_references_trigger_or_maintain(world):
    """#150 and #163: RLS doesn't apply to TRUNCATE or MAINTAIN, so these must stay revoked."""
    conn = world[0]
    granted = conn.execute(
        "select grantee, table_name, privilege_type from information_schema.role_table_grants"
        " where table_schema = 'public' and grantee in ('anon', 'authenticated')"
        " and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')").fetchall()
    assert granted == []
    # The same through has_table_privilege, which doesn't depend on who granted what.
    held = conn.execute(
        "select r.rolname, c.relname, p.priv from pg_class c"
        " join pg_namespace n on n.oid = c.relnamespace"
        " cross join (values ('anon'), ('authenticated')) as r (rolname)"
        " cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as p (priv)"
        " where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')"
        " and has_table_privilege(r.rolname, c.oid, p.priv)").fetchall()
    assert held == []


# --- A against B's rows -----------------------------------------------------------

@pytest.mark.parametrize("table", sorted(TABLES))
def test_a_reads_only_their_own_rows(world, table):
    conn, a, b, _ = world
    assert count_as(a._as_user, table, b.user_id) == 0
    assert rows_of(conn, table, b.user_id) == 1  # B's row is there to be hidden
    if has_policy(conn, table, "SELECT"):
        assert count_as(a._as_user, table, a.user_id) == 1  # and A's own row isn't hidden


@pytest.mark.parametrize("table", sorted(TABLES))
def test_a_cannot_update_bs_rows(world, table):
    conn, a, b, _ = world
    column = TABLES[table]
    query = f"update public.{table} set {column} = {column} where user_id = %s"
    assert touched_or_refused(a._as_user, query, (b.user_id,)) == 0
    if has_policy(conn, table, "UPDATE"):
        # The same update on A's own row goes through, so the refusal above is RLS.
        assert attempt(a._as_user, query, (a.user_id,)) == 1


@pytest.mark.parametrize("table", sorted(TABLES))
def test_a_cannot_delete_bs_rows(world, table):
    conn, a, b, _ = world
    assert touched_or_refused(a._as_user, f"delete from public.{table} where user_id = %s",
                              (b.user_id,)) == 0
    assert rows_of(conn, table, b.user_id) == 1


# Inserts and updates that point at another row through a foreign key. Foreign key
# checks bypass RLS, so each policy must check the row pointed at is the caller's
# own. Each case is a query and a function from an owner's ids to its parameters.
POINTING = {
    "climb in B's session": (
        "insert into public.climbs (session_id, grade, sent, style, grade_system)"
        " values (%s, '6a', true, 'boulder', 'font')",
        lambda own, other: (other["session"],)),
    "climb at B's gym": (
        "insert into public.climbs (session_id, grade, sent, style, grade_system, gym_id, gym_grade_id)"
        " values (%s, 'green', true, 'boulder', 'gym', %s, %s)",
        lambda own, other: (own["session"], other["gym"], other["gym_grade"])),
    "goal at B's gym": (
        "insert into public.goals (kind, grade, climb_mode, grade_system, gym_id, gym_grade_id)"
        " values ('climb_grade', 'green', 'send', 'gym', %s, %s)",
        lambda own, other: (other["gym"], other["gym_grade"])),
    "colour in B's gym": (
        "insert into public.gym_grades (gym_id, position, name, colour) values (%s, 2, 'blue', '#2f6fd6')",
        lambda own, other: (other["gym"],)),
    "session from B's template": (
        "insert into public.sessions (sport, date, duration_min, effort, template_id)"
        " values ('climbing', '2026-11-11', 30, 4, %s)",
        lambda own, other: (other["template"],)),
    "session moved to B's template": (
        "update public.sessions set template_id = %s where id = %s",
        lambda own, other: (other["template"], own["session"])),
    "plan for B's goal": (
        "insert into public.training_plans (name, start_date, weeks, goal_id, status, ended_on)"
        " values ('Copy', '2026-11-30', 4, %s, 'left', '2026-11-30')",
        lambda own, other: (other["goal"],)),
    "plan moved to B's goal": (
        "update public.training_plans set goal_id = %s where id = %s",
        lambda own, other: (other["goal"], own["plan"])),
    "planned session in B's plan": (
        "insert into public.planned_sessions (plan_id, date, sport, title)"
        " values (%s, '2026-11-25', 'running', 'Easy run')",
        lambda own, other: (other["plan"],)),
    "planned session from B's template": (
        "insert into public.planned_sessions (plan_id, date, sport, title, template_id)"
        " values (%s, '2026-11-25', 'strength', 'Hangboard', %s)",
        lambda own, other: (own["plan"], other["template"])),
    "planned session linked to B's session": (
        "insert into public.planned_sessions (plan_id, date, sport, title, session_id)"
        " values (%s, '2026-11-26', 'climbing', 'Bouldering', %s)",
        lambda own, other: (own["plan"], other["session"])),
    "planned session relinked to B's session": (
        "update public.planned_sessions set session_id = %s where plan_id = %s",
        lambda own, other: (other["session"], own["plan"])),
}


@pytest.mark.parametrize("case", sorted(POINTING))
def test_a_cannot_point_at_bs_rows_through_a_foreign_key(world, case):
    conn, a, b, ids = world
    query, params = POINTING[case]
    mine, theirs = ids[a.user_id], ids[b.user_id]
    # Pointing at A's own row works, so the refusal below is about whose row it is.
    assert attempt(a._as_user, query, params(mine, mine)) == 1
    try:
        touched = attempt(a._as_user, query, params(mine, theirs))
    except REFUSED:
        return
    pytest.fail(f"{case}: {touched} row(s) written pointing at another user's row")


# --- anon -------------------------------------------------------------------------

@pytest.mark.parametrize("table", sorted(TABLES))
def test_anon_reads_and_changes_nothing(world, table):
    conn, a, b, _ = world
    anon = lambda: as_anon(conn)  # noqa: E731
    try:
        with anon() as c:
            assert c.execute(f"select count(*) as n from public.{table}").fetchone()["n"] == 0
    except REFUSED:
        pass
    column = TABLES[table]
    assert touched_or_refused(anon, f"update public.{table} set {column} = {column}") == 0
    assert touched_or_refused(anon, f"delete from public.{table}") == 0
    assert rows_of(conn, table, a.user_id) == 1 and rows_of(conn, table, b.user_id) == 1


ANON_INSERTS = {
    "sessions": ("insert into public.sessions (user_id, sport, date, duration_min, effort)"
                 " values (%s, 'running', '2026-11-12', 30, 4)"),
    "chat_requests": "insert into public.chat_requests (user_id) values (%s)",
    "ui_events": "insert into public.ui_events (user_id, event) values (%s, 'anon_test')",
    "gyms": "insert into public.gyms (user_id, name) values (%s, 'Anon gym')",
    "training_profiles": "insert into public.training_profiles (user_id) values (%s)",
}


@pytest.mark.parametrize("table", sorted(ANON_INSERTS))
def test_anon_inserts_nothing(world, table):
    conn, a, b, _ = world
    # Even naming a real user: anon has no insert policy anywhere.
    with pytest.raises(REFUSED):
        attempt(lambda: as_anon(conn), ANON_INSERTS[table], (a.user_id,))
