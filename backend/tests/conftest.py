import json

import pytest
from anthropic.types import Message

import chat


class FakeStore:
    """In-memory stand-in for db.PostgresStore, so tests need no database."""

    def __init__(self):
        self.rows: list[dict] = []
        self.climbs: list[dict] = []
        self.model_calls: list[dict] = []
        self.chat_requests = 0
        self.pauses: list[dict] = []

    def insert_session(self, row: dict, climbs: list[dict] = ()) -> int:
        session_id = len(self.rows) + 1
        self.rows.append({"id": session_id, **row})
        for climb in climbs:
            self.climbs.append({"id": len(self.climbs) + 1, "session_id": session_id, **climb})
        return session_id

    def sessions_since(self, since: str) -> list[dict]:
        rows = [r for r in self.rows if r["date"] >= since]  # ISO dates sort as strings
        return sorted(rows, key=lambda r: (r["date"], r["id"]))

    def first_session_date(self) -> str | None:
        return min((r["date"] for r in self.rows), default=None)

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

    def end_pause(self, ended_on: str, resume_choice: str) -> dict | None:
        for p in self.pauses:
            if not p["ended_on"]:
                p.update(ended_on=ended_on, resume_choice=resume_choice)
                return dict(p)
        return None

    def claim_chat_request(self, daily_limit: int) -> bool:
        if self.chat_requests >= daily_limit:
            return False
        self.chat_requests += 1
        return True

    def log_model_call(self, call: dict) -> None:
        self.model_calls.append(call)


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
