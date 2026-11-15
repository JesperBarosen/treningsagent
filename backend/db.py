"""Postgres (Supabase) storage for training sessions.

Every query runs as the `authenticated` role with the user's id in the JWT
claims, the same way Supabase's own API does it. That makes the Row Level
Security policies apply: the connection's own role (postgres) would bypass them.
"""

import json
import os
import time
from contextlib import contextmanager

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

# Fixed user for tests and dev scripts (seed.py, agent.py). The API takes the
# user id from the verified Supabase JWT instead (auth.py).
TEST_USER_ID = "00000000-0000-0000-0000-000000000001"

SESSION_COLUMNS = ("id", "sport", "date", "duration_min", "effort", "notes", "distance_km",
                   "elevation_m", "climbing_style", "hardest_grade", "routes_count")
PAUSE_COLUMNS = ("id", "start_date", "planned_end", "ended_on", "reason", "body_part", "pain",
                 "note", "resume_choice")
GOAL_COLUMNS = ("id", "kind", "grade", "climb_mode", "band", "target_pace", "start_pace",
                "target_date", "status", "achieved_on", "created_on")
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

    # Context tags (N6) need migration 20261115140000_add_session_tags.sql. Until it
    # runs, reads leave tags out and writes drop them, so nothing breaks. "Present"
    # is cached for good; "missing" is checked again after a minute, so a running
    # server sees the column soon after the migration.
    _tags_present = False
    _tags_checked_at = float("-inf")

    def _has_tags(self) -> bool:
        cls = PostgresStore
        if not cls._tags_present and time.monotonic() - cls._tags_checked_at > 60:
            cls._tags_present = bool(self.conn.execute(
                "select exists (select 1 from information_schema.columns where table_schema ="
                " 'public' and table_name = 'sessions' and column_name = 'tags') as present"
            ).fetchone()["present"])
            cls._tags_checked_at = time.monotonic()
        return cls._tags_present

    def _session_columns(self) -> tuple[str, ...]:
        return SESSION_COLUMNS + (("tags",) if self._has_tags() else ())

    def _without_missing_columns(self, row: dict) -> dict:
        return row if self._has_tags() else {k: v for k, v in row.items() if k != "tags"}

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
        row = self._without_missing_columns(row)
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
        ).format(sql.SQL(", ").join(map(sql.Identifier, self._session_columns())))
        with self._as_user() as conn:
            rows = conn.execute(query, (since,)).fetchall()
        return [{**r, "date": r["date"].isoformat()} for r in rows]

    def first_session_date(self, sport: str | None = None) -> str | None:
        """The date of the first session, of `sport` only when given."""
        with self._as_user() as conn:
            row = conn.execute("select min(date) as first from public.sessions"
                               " where %(sport)s::text is null or sport = %(sport)s",
                               {"sport": sport}).fetchone()
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
            sql.SQL(", ").join(map(sql.Identifier, self._session_columns())))
        with self._as_user() as conn:
            row = conn.execute(query, (session_id,)).fetchone()
        return {**row, "date": row["date"].isoformat()} if row else None

    def update_session(self, session_id: int, row: dict, climbs: list[dict] | None) -> bool:
        """Overwrite a session's columns and, unless `climbs` is None, replace its
        climbs, in one transaction. False if RLS hides the session or it's gone."""
        row = self._without_missing_columns(row)
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

    # --- Pauses (N5) -------------------------------------------------------------

    @staticmethod
    def _pause(row: dict) -> dict:
        return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in row.items()
                if k in PAUSE_COLUMNS}

    def pauses_since(self, since: str) -> list[dict]:
        """Pauses still on, or that ended on or after `since`, oldest first."""
        query = sql.SQL("select {} from public.pauses where ended_on is null or ended_on >= %s"
                        " order by start_date, id").format(
            sql.SQL(", ").join(map(sql.Identifier, PAUSE_COLUMNS)))
        try:
            with self._as_user() as conn:
                return [self._pause(r) for r in conn.execute(query, (since,)).fetchall()]
        except psycopg.errors.UndefinedTable:  # migration not applied yet: no pauses
            return []

    def active_pause(self) -> dict | None:
        query = sql.SQL("select {} from public.pauses where ended_on is null").format(
            sql.SQL(", ").join(map(sql.Identifier, PAUSE_COLUMNS)))
        try:
            with self._as_user() as conn:
                row = conn.execute(query).fetchone()
        except psycopg.errors.UndefinedTable:  # migration not applied yet: no pause
            return None
        return self._pause(row) if row else None

    def start_pause(self, row: dict) -> dict:
        """Insert a pause (pauses.validate_pause's row). ValueError if one is on."""
        try:
            with self._as_user() as conn:
                pause_id = self._insert(conn, "pauses", row)
        except psycopg.errors.UniqueViolation:
            raise ValueError("a pause is already on") from None
        except psycopg.errors.IntegrityError as e:  # a check the validation missed
            raise ValueError(e.diag.message_primary) from None
        return {"id": pause_id, **row, "ended_on": None, "resume_choice": None}

    def update_pause(self, changes: dict) -> dict | None:
        """Change the details of the pause that is on (pauses.validate_edit's
        dict). None if there is none. Needs migration 20261115150000_edit_pauses.sql
        (the column grants); without it, RuntimeError."""
        query = sql.SQL("update public.pauses set {} where ended_on is null returning {}").format(
            sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in changes),
            sql.SQL(", ").join(map(sql.Identifier, PAUSE_COLUMNS)))
        try:
            with self._as_user() as conn:
                row = conn.execute(query, list(changes.values())).fetchone()
        except psycopg.errors.InsufficientPrivilege:
            raise RuntimeError("editing breaks needs migration 20261115150000_edit_pauses.sql") from None
        except psycopg.errors.IntegrityError as e:  # a check the validation missed
            raise ValueError(e.diag.message_primary) from None
        return self._pause(row) if row else None

    def end_pause(self, ended_on: str, resume_choice: str) -> dict | None:
        """End the pause that is on. None if there is none."""
        query = sql.SQL("update public.pauses set ended_on = %s, resume_choice = %s"
                        " where ended_on is null returning {}").format(
            sql.SQL(", ").join(map(sql.Identifier, PAUSE_COLUMNS)))
        with self._as_user() as conn:
            row = conn.execute(query, (ended_on, resume_choice)).fetchone()
        return self._pause(row) if row else None

    # --- Goals (N2) --------------------------------------------------------------

    def _goal_select(self, where: str = "") -> sql.Composed:
        return sql.SQL("select {} from public.goals " + where + " order by created_on, id").format(
            sql.SQL(", ").join(map(sql.Identifier, GOAL_COLUMNS)))

    @staticmethod
    def _goal(row: dict) -> dict:
        out = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in row.items()}
        for k in ("target_pace", "start_pace"):  # numeric -> float for JSON
            if out.get(k) is not None:
                out[k] = float(out[k])
        return out

    def goals(self) -> list[dict]:
        try:
            with self._as_user() as conn:
                return [self._goal(r) for r in conn.execute(self._goal_select()).fetchall()]
        except psycopg.errors.UndefinedTable:  # migration not applied yet: no goals
            return []

    def insert_goal(self, row: dict) -> dict:
        try:
            with self._as_user() as conn:
                goal_id = self._insert(conn, "goals", row)
                return self._goal(conn.execute(
                    self._goal_select("where id = %s"), (goal_id,)).fetchone())
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    def update_goal(self, goal_id: int, changes: dict) -> dict | None:
        """Change a goal's target_date, status or achieved_on. None if not found."""
        query = sql.SQL("update public.goals set {} where id = %s returning {}").format(
            sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in changes),
            sql.SQL(", ").join(map(sql.Identifier, GOAL_COLUMNS)))
        try:
            with self._as_user() as conn:
                row = conn.execute(query, (*changes.values(), goal_id)).fetchone()
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None
        return self._goal(row) if row else None

    def delete_goal(self, goal_id: int) -> bool:
        with self._as_user() as conn:
            return conn.execute("delete from public.goals where id = %s returning id",
                                (goal_id,)).fetchone() is not None

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
