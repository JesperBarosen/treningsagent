"""Postgres (Supabase) storage for training sessions.

Every query runs as the `authenticated` role with the user's id in the JWT
claims, the same way Supabase's own API does it. That makes the Row Level
Security policies apply: the connection's own role (postgres) would bypass them.
"""

import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

# Fixed user for tests and dev scripts (seed.py, agent.py). The API takes the
# user id from the verified Supabase JWT instead (auth.py).
TEST_USER_ID = "00000000-0000-0000-0000-000000000001"

SESSION_COLUMNS = ("id", "sport", "date", "duration_min", "effort", "notes", "distance_km",
                   "elevation_m", "climbing_style", "hardest_grade", "routes_count",
                   "template_id", "custom_values")
TEMPLATE_COLUMNS = ("id", "name", "sport", "core_fields", "fields", "position", "archived_at")
# jsonb columns: psycopg needs their Python values wrapped (text[] lists such as tags are not).
JSON_COLUMNS = {"custom_values", "fields", "week_meta", "target", "injuries"}
PROFILE_COLUMNS = ("longest_run_km", "weekly_run_km", "climbing_level", "injuries", "sessions_per_week",
                   "preferred_days", "other_sports", "goals_note", "onboarding")
PLAN_COLUMNS = ("id", "name", "goal_id", "start_date", "weeks", "week_meta", "status", "ended_on",
                "rationale", "source", "created_at")
PLANNED_COLUMNS = ("id", "plan_id", "date", "slot", "sport", "template_id", "title", "target",
                   "status", "skip_reason", "session_id")
PAUSE_COLUMNS = ("id", "start_date", "planned_end", "ended_on", "reason", "body_part", "pain",
                 "note", "resume_choice")
GOAL_COLUMNS = ("id", "kind", "grade", "climb_mode", "band", "target_pace", "start_pace",
                "target_date", "status", "achieved_on", "created_on",
                "grade_system", "gym_id", "gym_grade_id")
CLIMB_COLUMNS = ("id", "session_id", "grade", "grade_ordinal", "attempts", "sent", "style",
                 "notes", "grade_system", "gym_id", "gym_grade_id")
GYM_COLUMNS = ("id", "name", "range_system", "archived_at")
GYM_GRADE_COLUMNS = ("id", "gym_id", "position", "name", "colour", "range_low", "range_high",
                     "archived_at")


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
    def _params(row: dict) -> tuple:
        return tuple(Jsonb(v) if k in JSON_COLUMNS else v for k, v in row.items())

    @staticmethod
    def _insert(conn: psycopg.Connection, table: str, row: dict) -> int:
        query = sql.SQL("insert into public.{} ({}) values ({}) returning id").format(
            sql.Identifier(table),
            sql.SQL(", ").join(map(sql.Identifier, row)),
            sql.SQL(", ").join(sql.Placeholder() * len(row)),
        )
        return conn.execute(query, PostgresStore._params(row)).fetchone()["id"]

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
                if conn.execute(query, (*self._params(row), session_id)).fetchone() is None:
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

    # --- Gyms (#98) -----------------------------------------------------------------
    # Need migrations 20261116120000_create_gyms.sql and ..._climb_grade_systems.sql.

    @staticmethod
    def _gym_grade(row: dict) -> dict:
        out = dict(row)
        for k in ("range_low", "range_high"):  # numeric -> float for JSON
            if out.get(k) is not None:
                out[k] = float(out[k])
        if out.get("archived_at") is not None:
            out["archived_at"] = out["archived_at"].isoformat()
        return out

    def _gyms(self, conn, gym_id: int | None = None) -> list[dict]:
        where = sql.SQL("where id = %s") if gym_id is not None else sql.SQL("")
        gyms = conn.execute(sql.SQL("select {} from public.gyms {} order by id").format(
            sql.SQL(", ").join(map(sql.Identifier, GYM_COLUMNS)), where),
            (gym_id,) if gym_id is not None else ()).fetchall()
        colours = conn.execute(sql.SQL(
            "select {} from public.gym_grades order by gym_id, position, id").format(
            sql.SQL(", ").join(map(sql.Identifier, GYM_GRADE_COLUMNS)))).fetchall()
        out = []
        for g in gyms:
            gym = {**g, "archived_at": g["archived_at"] and g["archived_at"].isoformat()}
            gym["grades"] = [self._gym_grade(c) for c in colours if c["gym_id"] == g["id"]]
            out.append(gym)
        return out

    def gyms(self) -> list[dict]:
        with self._as_user() as conn:
            return self._gyms(conn)

    def _write_colours(self, conn, gym_id: int, colours: list[dict]) -> None:
        """Make the gym's colours match `colours` (gyms.validate_gym's rows):
        update those with an id, add the rest, delete the ones left out."""
        current = {r["id"]: r for r in conn.execute(
            "select id, archived_at from public.gym_grades where gym_id = %s", (gym_id,))}
        keep = {c["id"] for c in colours if c.get("id")}
        unknown = keep - set(current)
        if unknown:
            raise ValueError(f"colours {sorted(unknown)} are not part of this gym")
        for gone in set(current) - keep:
            conn.execute("delete from public.gym_grades where id = %s", (gone,))
        # Move positions out of the way first: the unique index on (gym_id,
        # position) would otherwise trip halfway through a reorder.
        conn.execute("update public.gym_grades set position = position + 1000 where gym_id = %s",
                     (gym_id,))
        for c in colours:
            values = {k: c[k] for k in ("position", "name", "colour", "range_low", "range_high")}
            if c.get("id"):
                was = current[c["id"]]["archived_at"]
                values["archived_at"] = (was or datetime.now(timezone.utc)) if c["archived"] else None
                conn.execute(sql.SQL("update public.gym_grades set {} where id = %s").format(
                    sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in values)),
                    (*values.values(), c["id"]))
            else:
                if c["archived"]:
                    values["archived_at"] = datetime.now(timezone.utc)
                self._insert(conn, "gym_grades", {**values, "gym_id": gym_id})

    def insert_gym(self, row: dict, colours: list[dict]) -> dict:
        try:
            with self._as_user() as conn:
                gym_id = self._insert(conn, "gyms", row)
                self._write_colours(conn, gym_id, colours)
                return self._gyms(conn, gym_id)[0]
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    def update_gym(self, gym_id: int, row: dict, colours: list[dict] | None) -> dict | None:
        """Change a gym (name, range_system, archived) and, unless `colours` is
        None, its colours. None if not found. ValueError if a used colour would
        be deleted (archive it instead)."""
        values = dict(row)
        if "archived" in values:
            values["archived_at"] = datetime.now(timezone.utc) if values.pop("archived") else None
        try:
            with self._as_user() as conn:
                if values:
                    found = conn.execute(sql.SQL(
                        "update public.gyms set {} where id = %s returning id").format(
                        sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in values)),
                        (*values.values(), gym_id)).fetchone()
                else:
                    found = conn.execute("select id from public.gyms where id = %s",
                                         (gym_id,)).fetchone()
                if found is None:
                    return None
                if colours is not None:
                    self._write_colours(conn, gym_id, colours)
                return self._gyms(conn, gym_id)[0]
        except psycopg.errors.ForeignKeyViolation:
            raise ValueError("a colour that climbs or goals use can't be deleted; archive it") from None
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    def delete_gym(self, gym_id: int) -> bool:
        """Delete an unused gym. ValueError if climbs or goals use it."""
        try:
            with self._as_user() as conn:
                return conn.execute("delete from public.gyms where id = %s returning id",
                                    (gym_id,)).fetchone() is not None
        except psycopg.errors.ForeignKeyViolation:
            raise ValueError("a gym that climbs or goals use can't be deleted; archive it") from None

    # --- Session templates (#100) -------------------------------------------------
    # Need migrations 20261116130000_create_session_templates.sql and
    # 20261116130100_session_templates_on_sessions.sql.

    def _template_select(self, where: str = "") -> sql.Composed:
        return sql.SQL("select {} from public.session_templates " + where + " order by position, id").format(
            sql.SQL(", ").join(map(sql.Identifier, TEMPLATE_COLUMNS)))

    @staticmethod
    def _template(row: dict) -> dict:
        return {**row, "archived_at": row["archived_at"] and row["archived_at"].isoformat()}

    def templates(self) -> list[dict]:
        with self._as_user() as conn:
            return [self._template(r) for r in conn.execute(self._template_select()).fetchall()]

    def insert_template(self, row: dict) -> dict:
        try:
            with self._as_user() as conn:
                template_id = self._insert(conn, "session_templates", row)
                return self._template(conn.execute(self._template_select("where id = %s"),
                                                   (template_id,)).fetchone())
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    def update_template(self, template_id: int, row: dict) -> dict | None:
        values = {**row, "updated_at": datetime.now(timezone.utc)}
        if "archived" in values:
            archived = values.pop("archived")
            values["archived_at"] = (sql.SQL("coalesce(archived_at, now())") if archived else None)
        sets = sql.SQL(", ").join(
            sql.SQL("{} = {}").format(sql.Identifier(k), v if isinstance(v, sql.Composable) else sql.Placeholder())
            for k, v in values.items())
        params = [Jsonb(v) if k in JSON_COLUMNS else v for k, v in values.items()
                  if not isinstance(v, sql.Composable)]
        query = sql.SQL("update public.session_templates set {} where id = %s returning {}").format(
            sets, sql.SQL(", ").join(map(sql.Identifier, TEMPLATE_COLUMNS)))
        try:
            with self._as_user() as conn:
                row = conn.execute(query, (*params, template_id)).fetchone()
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None
        return self._template(row) if row else None

    def delete_template(self, template_id: int) -> bool:
        """Delete an unused template. ValueError if sessions or plans use it."""
        try:
            with self._as_user() as conn:
                return conn.execute("delete from public.session_templates where id = %s returning id",
                                    (template_id,)).fetchone() is not None
        except psycopg.errors.ForeignKeyViolation:
            raise ValueError("a template that sessions or plans use can't be deleted; archive it") from None

    def template_value_keys(self, template_id: int) -> set[str]:
        """The field keys that this template's sessions have values for."""
        with self._as_user() as conn:
            rows = conn.execute("select distinct jsonb_object_keys(custom_values) as key"
                                " from public.sessions where template_id = %s", (template_id,)).fetchall()
        return {r["key"] for r in rows}

    # --- Training plans (#116) -------------------------------------------------------
    # Need migrations 20261118120000_create_training_plans.sql and
    # 20261118120100_create_planned_sessions.sql. Before they run, reads return
    # nothing, like goals.

    @staticmethod
    def _iso(row: dict) -> dict:
        return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in row.items()}

    def _select(self, table: str, columns: tuple[str, ...], where: sql.Composable, order: str) -> sql.Composed:
        return sql.SQL("select {} from public.{} {} order by " + order).format(
            sql.SQL(", ").join(map(sql.Identifier, columns)), sql.Identifier(table), where)

    def _update(self, conn, table: str, columns: tuple[str, ...], row_id: int, changes: dict) -> dict | None:
        values = {**changes, "updated_at": datetime.now(timezone.utc)}
        query = sql.SQL("update public.{} set {} where id = %s returning {}").format(
            sql.Identifier(table),
            sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(k)) for k in values),
            sql.SQL(", ").join(map(sql.Identifier, columns)))
        row = conn.execute(query, (*self._params(values), row_id)).fetchone()
        return self._iso(row) if row else None

    def plans(self) -> list[dict]:
        """Every plan, newest first."""
        try:
            with self._as_user() as conn:
                return [self._iso(r) for r in conn.execute(self._select(
                    "training_plans", PLAN_COLUMNS, sql.SQL(""), "start_date desc, id desc")).fetchall()]
        except psycopg.errors.UndefinedTable:
            return []

    def insert_plan(self, row: dict, sessions: list[dict]) -> dict:
        """A plan and its planned sessions in one transaction: all or nothing."""
        try:
            with self._as_user() as conn:
                plan_id = self._insert(conn, "training_plans", row)
                for s in sessions:
                    self._insert(conn, "planned_sessions", {**s, "plan_id": plan_id})
                return self._iso(conn.execute(self._select(
                    "training_plans", PLAN_COLUMNS, sql.SQL("where id = %s"), "id"), (plan_id,)).fetchone())
        except psycopg.errors.UniqueViolation:
            raise RuntimeError("there is already an active plan; leave or finish it first") from None
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    def update_plan(self, plan_id: int, changes: dict) -> dict | None:
        try:
            with self._as_user() as conn:
                return self._update(conn, "training_plans", PLAN_COLUMNS, plan_id, changes)
        except psycopg.errors.UniqueViolation:
            raise RuntimeError("there is already an active plan; leave or finish it first") from None
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    def planned_sessions(self, plan_id: int | None = None, since: str | None = None,
                         until: str | None = None) -> list[dict]:
        """Planned sessions of one plan, or between two dates (plans and one-offs)."""
        conds, params = [], []
        for cond, value in (("plan_id = %s", plan_id), ("date >= %s", since), ("date <= %s", until)):
            if value is not None:
                conds.append(cond)
                params.append(value)
        where = sql.SQL("where " + " and ".join(conds)) if conds else sql.SQL("")
        try:
            with self._as_user() as conn:
                return [self._iso(r) for r in conn.execute(self._select(
                    "planned_sessions", PLANNED_COLUMNS, where, "date, slot, id"), params).fetchall()]
        except psycopg.errors.UndefinedTable:
            return []

    def get_planned(self, planned_id: int) -> dict | None:
        with self._as_user() as conn:
            row = conn.execute(self._select("planned_sessions", PLANNED_COLUMNS,
                                            sql.SQL("where id = %s"), "id"), (planned_id,)).fetchone()
        return self._iso(row) if row else None

    def insert_planned(self, row: dict) -> dict:
        try:
            with self._as_user() as conn:
                planned_id = self._insert(conn, "planned_sessions", row)
                return self._iso(conn.execute(self._select(
                    "planned_sessions", PLANNED_COLUMNS, sql.SQL("where id = %s"), "id"),
                    (planned_id,)).fetchone())
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    def update_planned(self, planned_id: int, changes: dict) -> dict | None:
        try:
            with self._as_user() as conn:
                return self._update(conn, "planned_sessions", PLANNED_COLUMNS, planned_id, changes)
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    def delete_planned(self, planned_id: int) -> bool:
        with self._as_user() as conn:
            return conn.execute("delete from public.planned_sessions where id = %s returning id",
                                (planned_id,)).fetchone() is not None

    def last_gym_id(self) -> int | None:
        """The gym of the most recent climbing session with a gym."""
        with self._as_user() as conn:
            row = conn.execute(
                "select c.gym_id from public.climbs c join public.sessions s on s.id = c.session_id"
                " where c.gym_id is not null order by s.date desc, c.id desc limit 1").fetchone()
        return row["gym_id"] if row else None

    # --- Training profile (#137) ---------------------------------------------------------
    # Needs migration 20261119120000_create_training_profiles.sql.

    @staticmethod
    def _profile(row: dict) -> dict:
        out = dict(row)
        for k in ("longest_run_km", "weekly_run_km"):  # numeric -> float for JSON
            if out.get(k) is not None:
                out[k] = float(out[k])
        return out

    def get_profile(self) -> dict | None:
        """The user's profile row, or None before they have one."""
        try:
            with self._as_user() as conn:
                row = conn.execute(sql.SQL("select {} from public.training_profiles").format(
                    sql.SQL(", ").join(map(sql.Identifier, PROFILE_COLUMNS)))).fetchone()
        except psycopg.errors.UndefinedTable:  # migration not applied yet: no profile
            return None
        return self._profile(row) if row else None

    def save_profile(self, changes: dict) -> dict:
        """Insert or update the user's profile with `changes` (validated by
        training_profile.validate_changes); returns the whole row."""
        cols = list(changes)
        values = self._params(changes)
        updates = [sql.SQL("{} = excluded.{}").format(sql.Identifier(c), sql.Identifier(c)) for c in cols]
        updates.append(sql.SQL("updated_at = now()"))
        query = sql.SQL("insert into public.training_profiles ({}) values ({}) on conflict (user_id) "
                        "do update set {} returning {}").format(
            sql.SQL(", ").join(map(sql.Identifier, cols)) if cols else sql.SQL("onboarding"),
            sql.SQL(", ").join(sql.Placeholder() * len(cols)) if cols else sql.SQL("null"),
            sql.SQL(", ").join(updates),
            sql.SQL(", ").join(map(sql.Identifier, PROFILE_COLUMNS)))
        try:
            with self._as_user() as conn:
                return self._profile(conn.execute(query, values).fetchone())
        except psycopg.errors.IntegrityError as e:
            raise ValueError(e.diag.message_primary) from None

    # --- Usage limits (#129, #130; limits.py) ------------------------------------------
    # Need migration 20261118130000_beta_invites_and_usage_indexes.sql.

    def is_invited(self, email: str) -> bool:
        """Whether `email` (lower-case) is on the closed-beta list. Read with the
        connection's own role: beta_invites has no client access at all."""
        with self.conn.transaction():
            return self.conn.execute("select exists (select 1 from public.beta_invites"
                                     " where email = %s) as invited", (email,)).fetchone()["invited"]

    def global_usage(self, month_start: datetime, day_start: datetime) -> list[dict]:
        """Every user's token sums per model since the start of the month and of
        the day: the global budget. One indexed query (model_calls_created_at_idx),
        with the connection's own role, since RLS would limit it to this user."""
        cols = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
        query = ("select model, "
                 + ", ".join(f"coalesce(sum({c}), 0) as month_{c}" for c in cols) + ", "
                 + ", ".join(f"coalesce(sum({c}) filter (where created_at >= %(day)s), 0) as day_{c}"
                             for c in cols)
                 + " from public.model_calls where created_at >= %(month)s group by model")
        with self.conn.transaction():
            rows = self.conn.execute(query, {"month": month_start, "day": day_start}).fetchall()
        return [{"model": r["model"], "month": {c: int(r[f"month_{c}"]) for c in cols},
                 "day": {c: int(r[f"day_{c}"]) for c in cols}} for r in rows]

    def tokens_since(self, since: datetime) -> int:
        """This user's tokens since `since` for the daily quota
        (model_calls_user_id_created_at_idx): input + output, plus cache writes
        and reads weighted like their price (limits.CACHE_WRITE, limits.CACHE_READ),
        so a cached turn uses less of the quota (#142)."""
        import limits  # the weights live with the budget's prices
        with self._as_user() as conn:
            return int(round(float(conn.execute(
                "select coalesce(sum(input_tokens + output_tokens"
                " + %s * cache_creation_input_tokens + %s * cache_read_input_tokens), 0) as n"
                " from public.model_calls where created_at >= %s",
                (limits.CACHE_WRITE, limits.CACHE_READ, since)).fetchone()["n"])))

    def claim_chat_request(self, limit: int, since: datetime) -> datetime | None:
        """Record one /chat request unless the user already made `limit` since
        `since`. None if it was recorded (the request may go ahead); otherwise
        the oldest request in the window, so the caller can say when a slot frees."""
        with self._as_user() as conn:
            # Serialise one user's concurrent requests so two can't both pass the count.
            conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (self.user_id,))
            row = conn.execute(
                "select count(*) as n, min(created_at) as oldest from public.chat_requests"
                " where created_at > %s", (since,)).fetchone()
            if row["n"] >= limit:
                return row["oldest"]
            conn.execute("insert into public.chat_requests default values")
            return None

    def log_model_call(self, call: dict) -> None:
        with self._as_user() as conn:
            self._insert(conn, "model_calls", call)
