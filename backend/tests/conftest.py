import pytest


class FakeStore:
    """In-memory stand-in for db.PostgresStore, so tests need no database."""

    def __init__(self):
        self.rows: list[dict] = []
        self.model_calls: list[dict] = []

    def insert_session(self, row: dict) -> int:
        self.rows.append({"id": len(self.rows) + 1, **row})
        return len(self.rows)

    def sessions_since(self, since: str) -> list[dict]:
        rows = [r for r in self.rows if r["date"] >= since]  # ISO dates sort as strings
        return sorted(rows, key=lambda r: (r["date"], r["id"]))

    def log_model_call(self, call: dict) -> None:
        self.model_calls.append(call)


@pytest.fixture
def store():
    return FakeStore()
