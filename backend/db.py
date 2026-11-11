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

    def insert_session(self, row: dict) -> int:
        query = sql.SQL("insert into public.sessions ({}) values ({}) returning id").format(
            sql.SQL(", ").join(map(sql.Identifier, row)),
            sql.SQL(", ").join(sql.Placeholder() * len(row)),
        )
        try:
            with self._as_user() as conn:
                return conn.execute(query, tuple(row.values())).fetchone()["id"]
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
