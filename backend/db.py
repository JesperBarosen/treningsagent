"""Postgres (Supabase) storage for training sessions.

Every query runs as the `authenticated` role with the user's id in the JWT
claims, the same way Supabase's own API does it. That makes the Row Level
Security policies apply: the connection's own role (postgres) would bypass them.
"""

import json
import os
from contextlib import contextmanager

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

# Fixed user for tests and dev scripts (seed.py, agent.py). The API takes the
# user id from the verified Supabase JWT instead (auth.py).
TEST_USER_ID = "00000000-0000-0000-0000-000000000001"

SESSION_COLUMNS = ("id", "sport", "date", "duration_min", "effort", "notes", "distance_km",
                   "elevation_m", "climbing_style", "hardest_grade", "routes_count")
CLIMB_COLUMNS = ("id", "session_id", "grade", "grade_ordinal", "attempts", "sent", "style",
                 "notes")


def connect(url: str | None = None) -> psycopg.Connection:
    """Open a connection to DATABASE_URL (or `url`)."""
    url = url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set; see .env.example")
    # autocommit: each `with conn.transaction()` is one real transaction.
    # prepare_threshold=None: Supabase's transaction pooler can't use prepared statements.
    return psycopg.connect(url, autocommit=True, prepare_threshold=None, row_factory=dict_row)


def ensure_auth_user(conn: psycopg.Connection, user_id: str) -> None:
    """Make sure `user_id` exists in auth.users, so rows can reference it.

    For dev scripts and integration tests only (the test user, throwaway eval
    users). It adds a bare row with no email or password, which can't sign in.
    Runs as the connection's own role; real users come from Supabase Auth."""
    conn.execute("insert into auth.users (id, aud, role) values (%s, 'authenticated', "
                 "'authenticated') on conflict (id) do nothing", (user_id,))


def delete_auth_user(conn: psycopg.Connection, user_id: str) -> None:
    """Delete a user made by ensure_auth_user and, by cascade, all their rows."""
    if user_id == TEST_USER_ID:
        raise RuntimeError("refusing to delete the test user")
    conn.execute("delete from auth.users where id = %s and email is null", (user_id,))


class PostgresStore:
    """Session storage for one user. All reads and writes are limited by RLS."""

    def __init__(self, conn: psycopg.Connection, user_id: str):
        self.conn = conn
        self.user_id = user_id

    @contextmanager
    def _as_user(self):
        """A transaction in which RLS sees this store's user as the caller."""
        claims = json.dumps({"sub": self.user_id, "role": "authenticated"})
        with self.conn.transaction():
            self.conn.execute("set local role authenticated")
            self.conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
            yield self.conn

    @staticmethod
    def _insert(conn: psycopg.Connection, table: str, row: dict) -> int:
        query = sql.SQL("insert into public.{} ({}) values ({}) returning id").format(
            sql.Identifier(table),
            sql.SQL(", ").join(map(sql.Identifier, row)),
            sql.SQL(", ").join(sql.Placeholder() * len(row)),
        )
        return conn.execute(query, tuple(row.values())).fetchone()["id"]

    def insert_session(self, row: dict, climbs: list[dict] = ()) -> int:
        """Insert a session and its climbs in one transaction: all or nothing."""
        try:
            with self._as_user() as conn:
                session_id = self._insert(conn, "sessions", row)
                for climb in climbs:
                    self._insert(conn, "climbs", {**climb, "session_id": session_id})
                return session_id
        except psycopg.errors.IntegrityError as e:
            # A check constraint the tool's own validation missed: report it to Claude.
            raise ValueError(e.diag.message_primary) from None

    def sessions_since(self, since: str) -> list[dict]:
        query = sql.SQL(
            "select {} from public.sessions where date >= %s order by date, id"
        ).format(sql.SQL(", ").join(map(sql.Identifier, SESSION_COLUMNS)))
        with self._as_user() as conn:
            rows = conn.execute(query, (since,)).fetchall()
        return [{**r, "date": r["date"].isoformat()} for r in rows]

    def first_session_date(self) -> str | None:
        with self._as_user() as conn:
            row = conn.execute("select min(date) as first from public.sessions").fetchone()
        return row["first"].isoformat() if row["first"] else None

    def climbs_since(self, since: str) -> list[dict]:
        """Climbs in sessions dated on or after `since`, in insertion order."""
        query = sql.SQL(
            "select {} from public.climbs c join public.sessions s on s.id = c.session_id"
            " where s.date >= %s order by c.id"
        ).format(sql.SQL(", ").join(sql.Identifier("c", col) for col in CLIMB_COLUMNS))
        with self._as_user() as conn:
            return conn.execute(query, (since,)).fetchall()

    def get_session(self, session_id: int) -> dict | None:
        query = sql.SQL("select {} from public.sessions where id = %s").format(
            sql.SQL(", ").join(map(sql.Identifier, SESSION_COLUMNS)))
        with self._as_user() as conn:
            row = conn.execute(query, (session_id,)).fetchone()
        return {**row, "date": row["date"].isoformat()} if row else None

    def update_session(self, session_id: int, row: dict, climbs: list[dict] | None) -> bool:
        """Overwrite a session's columns and, unless `climbs` is None, replace its
        climbs, in one transaction. False if RLS hides the session or it's gone."""
        query = sql.SQL("update public.sessions set {} where id = %s returning id").format(
            sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in row))
        try:
            with self._as_user() as conn:
                if conn.execute(query, (*row.values(), session_id)).fetchone() is None:
                    return False
                if climbs is not None:
                    conn.execute("delete from public.climbs where session_id = %s",
                                 (session_id,))
                    for climb in climbs:
                        self._insert(conn, "climbs", {**climb, "session_id": session_id})
                return True
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    def delete_session(self, session_id: int) -> bool:
        """Delete a session (its climbs go by cascade). False if not found."""
        with self._as_user() as conn:
            cur = conn.execute("delete from public.sessions where id = %s returning id",
                               (session_id,))
            return cur.fetchone() is not None

    def claim_chat_request(self, daily_limit: int) -> bool:
        """Record one /chat request unless the user already made `daily_limit`
        in the last 24 hours. True if it was recorded (the request may go ahead)."""
        with self._as_user() as conn:
            # Serialise one user's concurrent requests so two can't both pass the count.
            conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (self.user_id,))
            used = conn.execute(
                "select count(*) as n from public.chat_requests"
                " where created_at > now() - interval '24 hours'").fetchone()["n"]
            if used >= daily_limit:
                return False
            conn.execute("insert into public.chat_requests default values")
            return True

    def log_model_call(self, call: dict) -> None:
        with self._as_user() as conn:
            self._insert(conn, "model_calls", call)
