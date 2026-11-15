"""Context tags on a session (N6): validation, storage through every write
path, co-occurrence patterns for the coach, and coping without the column."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import api
import db
import tools

TODAY = date(2026, 11, 15)
day = lambda n: (TODAY - timedelta(days=n)).isoformat()  # noqa: E731


def test_tags_are_checked_ordered_and_deduplicated():
    row, _ = tools.validate_session("running", day(0), 30, 5,
                                    tags=["hot", "slept_badly", "hot"])
    assert row["tags"] == ["slept_badly", "hot"]  # TAGS order, once each
    with pytest.raises(ValueError, match="unknown tags"):
        tools.validate_session("running", day(0), 30, 5, tags=["hungover"])
    with pytest.raises(ValueError, match="list of strings"):
        tools.validate_session("running", day(0), 30, 5, tags="sore")


def test_no_tags_means_no_tags_key(store):
    s = tools.log_session(store, "running", day(0), 30, 5, distance_km=5.0)
    assert "tags" not in s and "tags" not in store.rows[0]


def test_tags_go_through_log_draft_and_climbing(store):
    s = tools.log_session(store, "climbing", day(0), 90, 7, tags=["sore"],
                          climbs=[{"grade": "blue", "style": "boulder", "sent": True}])
    assert s["tags"] == ["sore"] and store.rows[0]["tags"] == ["sore"]
    d = tools.draft_session(store, "running", day(1), 40, 6, distance_km=8.0, tags=["felt_strong"])
    assert d["tags"] == ["felt_strong"] and len(store.rows) == 1


def test_an_edit_keeps_tags_unless_it_changes_them(store):
    sid = tools.log_session(store, "running", day(2), 30, 5, distance_km=5.0, tags=["tired"])["id"]
    tools.update_session(store, sid, {"effort": 6})
    assert store.rows[0]["tags"] == ["tired"]
    tools.update_session(store, sid, {"tags": ["stressed"]})
    assert store.rows[0]["tags"] == ["stressed"]
    tools.update_session(store, sid, {"tags": []})
    assert store.rows[0]["tags"] == []


def test_the_api_takes_tags_and_refuses_unknown_ones(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    try:
        http = TestClient(api.app)
        ok = http.post("/sessions", json={"sport": "running", "date": day(0), "duration_min": 30,
                                          "effort": 5, "tags": ["hot"]})
        assert ok.status_code == 201 and ok.json()["tags"] == ["hot"]
        bad = http.post("/sessions", json={"sport": "running", "date": day(0), "duration_min": 30,
                                           "effort": 5, "tags": ["windy"]})
        assert bad.status_code == 422
    finally:
        api.app.dependency_overrides.clear()


# --- Patterns for the coach -------------------------------------------------------------

def runs(store, paces_and_tags):
    for i, (minutes_per_km, tags) in enumerate(paces_and_tags):
        tools.log_session(store, "running", day(i + 1), round(minutes_per_km * 8), 5,
                          distance_km=8.0, tags=tags)


def test_a_tag_that_goes_with_the_slowest_runs_is_a_pattern(store):
    runs(store, [(6.4, ["slept_badly"]), (6.3, ["slept_badly"]), (6.2, ["slept_badly", "hot"]),
                 (5.4, []), (5.3, ["hot"]), (5.2, []), (5.1, ["felt_strong"]), (5.0, []),
                 (5.0, ["hot"])])
    result = tools.tag_patterns(store, 56, TODAY)["running"]
    assert result["enough_data"] is True
    assert result["patterns"] == [{"tag": "slept_badly", "in_weakest": 3, "weakest": 3,
                                   "elsewhere": 0, "others": 6}]
    # "hot" is spread across slow and fast runs: not a pattern.
    assert result["tag_counts"]["hot"] == 3


def test_no_pattern_without_enough_sessions(store):
    runs(store, [(6.4, ["slept_badly"]), (6.3, ["slept_badly"]), (6.2, ["slept_badly"]),
                 (5.0, []), (5.0, [])])
    result = tools.tag_patterns(store, 56, TODAY)["running"]
    assert result["enough_data"] is False and result["patterns"] == []


def test_the_coach_is_told_co_occurrence_never_cause():
    by_name = {t["name"]: t for t in tools.tools_for(auto_save=False)}
    text = " ".join(by_name["get_tag_patterns"]["description"].split())
    assert "often go together" in text and "never say one causes the other" in text
    tags_schema = by_name["draft_session"]["input_schema"]["properties"]["tags"]
    assert tags_schema["items"]["enum"] == list(tools.TAGS)
    assert "never infer" in tags_schema["description"]


# --- Before the migration ---------------------------------------------------------------

class NoTagsConn:
    """A connection whose sessions table has no tags column; records SQL."""

    def __init__(self):
        self.sql: list[str] = []

    def execute(self, query, params=()):
        text = query.as_string(None) if hasattr(query, "as_string") else query
        self.sql.append(text)

        class Result:
            def fetchone(self_inner):
                return {"present": False, "id": 1}

            def fetchall(self_inner):
                return []
        return Result()

    def transaction(self):
        import contextlib
        return contextlib.nullcontext()


def test_without_the_column_reads_and_writes_leave_tags_out(monkeypatch):
    monkeypatch.setattr(db.PostgresStore, "_tags_present", False)
    monkeypatch.setattr(db.PostgresStore, "_tags_checked_at", float("-inf"))
    conn = NoTagsConn()
    store = db.PostgresStore(conn, "user-1")

    assert store._session_columns() == db.SESSION_COLUMNS
    assert store._without_missing_columns({"sport": "running", "tags": ["hot"]}) == {"sport": "running"}
    store.sessions_since("2026-11-01")
    select = next(s for s in conn.sql if s.startswith("select") and "public.sessions" in s)
    assert '"tags"' not in select
    checks = sum("information_schema" in s for s in conn.sql)
    store._has_tags()
    assert sum("information_schema" in s for s in conn.sql) == checks  # cached for a minute


def test_with_the_column_tags_are_read(monkeypatch):
    monkeypatch.setattr(db.PostgresStore, "_tags_present", True)
    store = db.PostgresStore(NoTagsConn(), "user-1")
    assert store._session_columns()[-1] == "tags"
