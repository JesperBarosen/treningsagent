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

# Fixed user until real login exists. Replace with the id from the user's JWT.
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

    def climbs_since(self, since: str) -> list[dict]:
        """Climbs in sessions dated on or after `since`, in insertion order."""
        query = sql.SQL(
            "select {} from public.climbs c join public.sessions s on s.id = c.session_id"
            " where s.date >= %s order by c.id"
        ).format(sql.SQL(", ").join(sql.Identifier("c", col) for col in CLIMB_COLUMNS))
        with self._as_user() as conn:
            return conn.execute(query, (since,)).fetchall()

    def log_model_call(self, call: dict) -> None:
        with self._as_user() as conn:
            self._insert(conn, "model_calls", call)
