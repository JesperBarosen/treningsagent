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
        self.messages = self  # so client.messages.create(...) works

    def create(self, **kwargs):
        self.requests.append(json.loads(json.dumps(kwargs["messages"])))  # snapshot
        return self.responses.pop(0)
