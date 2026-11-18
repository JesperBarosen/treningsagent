import json
from datetime import datetime, timezone

import pytest
from anthropic.types import Message

import chat


class FakeStore:
    """In-memory stand-in for db.PostgresStore, so tests need no database."""

    def __init__(self):
        self.rows: list[dict] = []
        self.climbs: list[dict] = []
        self.model_calls: list[dict] = []
        # Usage limits (#129, #130): request times, everyone else's calls, the
        # invite list, and the clock the fake stamps rows with.
        self.chat_requests: list = []
        self.other_users_calls: list[dict] = []
        self.invited: set[str] = {"me@example.com"}
        self.now = datetime.now(timezone.utc)
        self.pauses: list[dict] = []
        self.goal_rows: list[dict] = []
        self.gym_rows: list[dict] = []
        self.gym_grades: list[dict] = []
        self.template_rows: list[dict] = []
        self.plan_rows: list[dict] = []
        self.planned_rows: list[dict] = []

    def insert_session(self, row: dict, climbs: list[dict] = ()) -> int:
        session_id = len(self.rows) + 1
        self.rows.append({"id": session_id, **row})
        for climb in climbs:
            self.climbs.append({"id": len(self.climbs) + 1, "session_id": session_id, **climb})
        return session_id

    def sessions_since(self, since: str) -> list[dict]:
        rows = [r for r in self.rows if r["date"] >= since]  # ISO dates sort as strings
        return sorted(rows, key=lambda r: (r["date"], r["id"]))

    def first_session_date(self, sport: str | None = None) -> str | None:
        return min((r["date"] for r in self.rows if sport is None or r["sport"] == sport), default=None)

    def climbs_since(self, since: str) -> list[dict]:
        ids = {r["id"] for r in self.sessions_since(since)}
        return [c for c in self.climbs if c["session_id"] in ids]

    def get_session(self, session_id: int) -> dict | None:
        return next((dict(r) for r in self.rows if r["id"] == session_id), None)

    def update_session(self, session_id: int, row: dict, climbs: list[dict] | None) -> bool:
        current = next((r for r in self.rows if r["id"] == session_id), None)
        if current is None:
            return False
        current.update(row)
        if climbs is not None:
            self.climbs = [c for c in self.climbs if c["session_id"] != session_id]
            for climb in climbs:
                self.climbs.append({"id": len(self.climbs) + 1, "session_id": session_id,
                                    **climb})
        return True

    def delete_session(self, session_id: int) -> bool:
        before = len(self.rows)
        self.rows = [r for r in self.rows if r["id"] != session_id]
        self.climbs = [c for c in self.climbs if c["session_id"] != session_id]
        return len(self.rows) < before

    def pauses_since(self, since: str) -> list[dict]:
        return [dict(p) for p in self.pauses if not p["ended_on"] or p["ended_on"] >= since]

    def active_pause(self) -> dict | None:
        return next((dict(p) for p in self.pauses if not p["ended_on"]), None)

    def start_pause(self, row: dict) -> dict:
        if self.active_pause():
            raise ValueError("a pause is already on")
        pause = {"id": len(self.pauses) + 1, **row, "ended_on": None, "resume_choice": None}
        self.pauses.append(pause)
        return dict(pause)

    def update_pause(self, changes: dict) -> dict | None:
        for p in self.pauses:
            if not p["ended_on"]:
                p.update(changes)
                return dict(p)
        return None

    def end_pause(self, ended_on: str, resume_choice: str) -> dict | None:
        for p in self.pauses:
            if not p["ended_on"]:
                p.update(ended_on=ended_on, resume_choice=resume_choice)
                return dict(p)
        return None

    def goals(self) -> list[dict]:
        return [dict(g) for g in self.goal_rows]

    def insert_goal(self, row: dict) -> dict:
        goal = {"id": len(self.goal_rows) + 1, "status": "active", "achieved_on": None,
                "start_pace": None, **row}
        self.goal_rows.append(goal)
        return dict(goal)

    def update_goal(self, goal_id: int, changes: dict) -> dict | None:
        goal = next((g for g in self.goal_rows if g["id"] == goal_id), None)
        if goal is None:
            return None
        goal.update(changes)
        return dict(goal)

    def delete_goal(self, goal_id: int) -> bool:
        before = len(self.goal_rows)
        self.goal_rows = [g for g in self.goal_rows if g["id"] != goal_id]
        return len(self.goal_rows) < before

    # --- Gyms (#98) ---
    def gyms(self) -> list[dict]:
        return [{**g, "grades": [dict(x) for x in self.gym_grades if x["gym_id"] == g["id"]]}
                for g in self.gym_rows]

    def _gym(self, gym_id: int) -> dict | None:
        return next((g for g in self.gyms() if g["id"] == gym_id), None)

    def _write_colours(self, gym_id: int, colours: list[dict]) -> None:
        keep = {c["id"] for c in colours if c.get("id")}
        for x in [x for x in self.gym_grades if x["gym_id"] == gym_id and x["id"] not in keep]:
            if any(c.get("gym_grade_id") == x["id"] for c in self.climbs) or any(
                    g.get("gym_grade_id") == x["id"] for g in self.goal_rows):
                raise ValueError("a colour that climbs or goals use can't be deleted; archive it")
            self.gym_grades.remove(x)
        for c in colours:
            row = {k: c[k] for k in ("position", "name", "colour", "range_low", "range_high")}
            existing = next((x for x in self.gym_grades if x["id"] == c.get("id")), None)
            if c.get("id") and (existing is None or existing["gym_id"] != gym_id):
                raise ValueError(f"colour {c['id']} is not part of this gym")
            archived_at = (existing or {}).get("archived_at") or "2026-11-16T00:00:00Z" \
                if c.get("archived") else None
            if existing:
                existing.update(row, archived_at=archived_at)
            else:
                self.gym_grades.append({"id": len(self.gym_grades) + 1000, "gym_id": gym_id,
                                        **row, "archived_at": archived_at})

    def insert_gym(self, row: dict, colours: list[dict]) -> dict:
        gym_id = len(self.gym_rows) + 1
        self.gym_rows.append({"id": gym_id, **row, "archived_at": None})
        self._write_colours(gym_id, colours)
        return self._gym(gym_id)

    def update_gym(self, gym_id: int, row: dict, colours: list[dict] | None) -> dict | None:
        gym = next((g for g in self.gym_rows if g["id"] == gym_id), None)
        if gym is None:
            return None
        row = dict(row)
        if "archived" in row:
            row["archived_at"] = "2026-11-16T00:00:00Z" if row.pop("archived") else None
        gym.update(row)
        if colours is not None:
            self._write_colours(gym_id, colours)
        return self._gym(gym_id)

    def delete_gym(self, gym_id: int) -> bool:
        if any(c.get("gym_id") == gym_id for c in self.climbs) or any(
                g.get("gym_id") == gym_id for g in self.goal_rows):
            raise ValueError("a gym that climbs or goals use can't be deleted; archive it")
        before = len(self.gym_rows)
        self.gym_rows = [g for g in self.gym_rows if g["id"] != gym_id]
        self.gym_grades = [x for x in self.gym_grades if x["gym_id"] != gym_id]
        return len(self.gym_rows) < before

    def last_gym_id(self) -> int | None:
        dated = [(next(r["date"] for r in self.rows if r["id"] == c["session_id"]), c["id"], c["gym_id"])
                 for c in self.climbs if c.get("gym_id") is not None]
        return max(dated)[2] if dated else None

    # --- Session templates (#100) ---
    def templates(self) -> list[dict]:
        return [json.loads(json.dumps(t)) for t in self.template_rows]

    def insert_template(self, row: dict) -> dict:
        t = {"id": len(self.template_rows) + 1, "archived_at": None, "position": 0, **row}
        self.template_rows.append(t)
        return json.loads(json.dumps(t))

    def update_template(self, template_id: int, row: dict) -> dict | None:
        t = next((t for t in self.template_rows if t["id"] == template_id), None)
        if t is None:
            return None
        row = dict(row)
        if "archived" in row:
            t["archived_at"] = (t["archived_at"] or "2026-11-16T00:00:00Z") if row.pop("archived") else None
        t.update(row)
        return json.loads(json.dumps(t))

    def delete_template(self, template_id: int) -> bool:
        if any(r.get("template_id") == template_id for r in self.rows + self.planned_rows):
            raise ValueError("a template that sessions or plans use can't be deleted; archive it")
        before = len(self.template_rows)
        self.template_rows = [t for t in self.template_rows if t["id"] != template_id]
        return len(self.template_rows) < before

    def template_value_keys(self, template_id: int) -> set[str]:
        return {k for r in self.rows if r.get("template_id") == template_id
                for k in (r.get("custom_values") or {})}

    # --- Training plans (#116) ---
    # Mirrors the database: one active or paused plan per user, at most one
    # planned session per logged session, rows copied in and out.
    def plans(self) -> list[dict]:
        return sorted((json.loads(json.dumps(p)) for p in self.plan_rows),
                      key=lambda p: (p["start_date"], p["id"]), reverse=True)

    def _one_current(self, plan_id: int | None, status: str) -> None:
        if status in ("active", "paused") and any(
                p["status"] in ("active", "paused") and p["id"] != plan_id for p in self.plan_rows):
            raise RuntimeError("there is already an active plan; leave or finish it first")

    def insert_plan(self, row: dict, sessions: list[dict]) -> dict:
        plan = {"id": len(self.plan_rows) + 1, "status": "active", "ended_on": None,
                "created_at": "2026-11-18T00:00:00+00:00", **json.loads(json.dumps(row))}
        self._one_current(None, plan["status"])
        self.plan_rows.append(plan)
        for s in sessions:
            self.insert_planned({**s, "plan_id": plan["id"]})
        return json.loads(json.dumps(plan))

    def update_plan(self, plan_id: int, changes: dict) -> dict | None:
        plan = next((p for p in self.plan_rows if p["id"] == plan_id), None)
        if plan is None:
            return None
        self._one_current(plan_id, changes.get("status", plan["status"]))
        plan.update(json.loads(json.dumps(changes)))
        return json.loads(json.dumps(plan))

    def planned_sessions(self, plan_id: int | None = None, since: str | None = None,
                         until: str | None = None) -> list[dict]:
        rows = [p for p in self.planned_rows if (plan_id is None or p["plan_id"] == plan_id)
                and (since is None or p["date"] >= since) and (until is None or p["date"] <= until)]
        return [json.loads(json.dumps(p)) for p in sorted(rows, key=lambda p: (p["date"], p["slot"], p["id"]))]

    def get_planned(self, planned_id: int) -> dict | None:
        p = next((p for p in self.planned_rows if p["id"] == planned_id), None)
        return json.loads(json.dumps(p)) if p else None

    def insert_planned(self, row: dict) -> dict:
        p = {"id": len(self.planned_rows) + 1, "plan_id": None, "slot": 0, "status": "planned",
             "skip_reason": None, "session_id": None, "target": {}, **json.loads(json.dumps(row))}
        if any(x["date"] == p["date"] and x["slot"] == p["slot"] for x in self.planned_rows):
            raise AssertionError("two planned sessions in one slot")  # plans.slots must prevent it
        self.planned_rows.append(p)
        return json.loads(json.dumps(p))

    def update_planned(self, planned_id: int, changes: dict) -> dict | None:
        p = next((p for p in self.planned_rows if p["id"] == planned_id), None)
        if p is None:
            return None
        p.update(json.loads(json.dumps(changes)))
        return json.loads(json.dumps(p))

    def delete_planned(self, planned_id: int) -> bool:
        before = len(self.planned_rows)
        self.planned_rows = [p for p in self.planned_rows if p["id"] != planned_id]
        return len(self.planned_rows) < before

    # --- Usage limits (#129, #130) ---
    # Counted like the database does: requests and calls carry a time (`now`,
    # which tests move forward), and `other_users_calls` stands in for
    # everyone else's model calls in the global budget.
    def is_invited(self, email: str) -> bool:
        return email in self.invited

    def _calls_since(self, calls: list[dict], since):
        return [c for c in calls if c.get("created_at", self.now) >= since]

    def global_usage(self, month_start, day_start) -> list[dict]:
        cols = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
        everyone = self.model_calls + self.other_users_calls
        out = []
        for model in sorted({c["model"] for c in everyone}):
            mine = [c for c in everyone if c["model"] == model]
            out.append({"model": model,
                        "month": {k: sum(c.get(k, 0) for c in self._calls_since(mine, month_start)) for k in cols},
                        "day": {k: sum(c.get(k, 0) for c in self._calls_since(mine, day_start)) for k in cols}})
        return out

    def tokens_since(self, since) -> int:
        return sum(c["input_tokens"] + c["output_tokens"] for c in self._calls_since(self.model_calls, since))

    def claim_chat_request(self, limit: int, since):
        recent = sorted(t for t in self.chat_requests if t > since)
        if len(recent) >= limit:
            return recent[0]
        self.chat_requests.append(self.now)
        return None

    def log_model_call(self, call: dict) -> None:
        self.model_calls.append({"created_at": self.now, **call})


@pytest.fixture
def store():
    return FakeStore()


def make_message(stop_reason: str, content: list[dict]) -> Message:
    return Message.model_validate({
        "id": "msg_test", "type": "message", "role": "assistant", "model": chat.MODEL,
        "content": content, "stop_reason": stop_reason, "stop_sequence": None,
        "usage": {"input_tokens": 100, "output_tokens": 20},
    })


class FakeClient:
    """Returns canned responses in order and records each request."""

    def __init__(self, *responses: Message):
        self.responses = list(responses)
        self.requests: list[dict] = []
        self.systems: list[str] = []
        self.tools: list[list[str]] = []
        self.messages = self  # so client.messages.create(...) works

    def create(self, **kwargs):
        self.requests.append(json.loads(json.dumps(kwargs["messages"])))  # snapshot
        self.systems.append(kwargs["system"])
        self.tools.append([t["name"] for t in kwargs["tools"]])
        return self.responses.pop(0)
