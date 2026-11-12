"""Tests for POST, PATCH and DELETE /sessions with a fake store (no database)."""

import pytest
from fastapi.testclient import TestClient

import api

RUN = {"sport": "running", "date": "2026-11-10", "duration_min": 30, "effort": 5,
       "distance_km": 6.0, "notes": "Easy"}
CLIMB = {"sport": "climbing", "date": "2026-11-11", "duration_min": 90, "effort": 7,
         "climbs": [{"grade": "blue", "style": "boulder", "sent": True, "attempts": 1},
                    {"grade": "red", "style": "boulder", "sent": False}]}


@pytest.fixture
def http(store):
    api.app.dependency_overrides[api.get_store] = lambda: store
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def test_post_stores_a_run(http, store):
    res = http.post("/sessions", json=RUN)

    assert res.status_code == 201
    assert res.json()["id"] == 1
    assert store.rows[0]["distance_km"] == 6.0


def test_post_stores_climbs_with_ordinals(http, store):
    res = http.post("/sessions", json=CLIMB)

    assert res.status_code == 201
    assert [(c["grade"], c["grade_ordinal"]) for c in store.climbs] == [("blue", 3), ("red", 5)]


@pytest.mark.parametrize("change", [
    {"effort": 11},
    {"duration_min": 0},
    {"date": "10/11/2026"},
    {"sport": "swimming"},
    {"climbs": [{"grade": "blue", "style": "boulder", "sent": True}]},  # climbs on a run
])
def test_post_uses_log_session_rules(http, store, change):
    res = http.post("/sessions", json={**RUN, **change})

    assert res.status_code == 422
    assert store.rows == []


def test_post_rejects_unknown_fields(http):
    assert http.post("/sessions", json={**RUN, "pace": 5}).status_code == 422


def test_patch_changes_only_given_fields(http, store):
    http.post("/sessions", json=RUN)

    res = http.patch("/sessions/1", json={"effort": 8, "notes": None})

    assert res.status_code == 200
    row = store.rows[0]
    assert (row["effort"], row["notes"], row["distance_km"], row["duration_min"]) == \
        (8, None, 6.0, 30)


def test_patch_validates_the_merged_session(http, store):
    http.post("/sessions", json=CLIMB)

    assert http.patch("/sessions/1", json={"distance_km": 5}).status_code == 422
    assert http.patch("/sessions/1", json={"effort": 0}).status_code == 422
    assert store.rows[0]["effort"] == 7


def test_patch_replaces_climbs_only_when_given(http, store):
    http.post("/sessions", json=CLIMB)

    http.patch("/sessions/1", json={"effort": 6})
    assert len(store.climbs) == 2

    http.patch("/sessions/1", json={"climbs": [{"grade": "black", "style": "kilter",
                                                "sent": True}]})
    assert [c["grade"] for c in store.climbs] == ["black"]


def test_patch_from_run_to_climb_clears_running_fields(http, store):
    http.post("/sessions", json=RUN)

    res = http.patch("/sessions/1", json={"sport": "climbing"})

    assert res.status_code == 200
    assert store.rows[0]["sport"] == "climbing"
    assert store.rows[0]["distance_km"] is None


def test_patch_and_delete_of_missing_session_is_404(http):
    assert http.patch("/sessions/9", json={"effort": 5}).status_code == 404
    assert http.delete("/sessions/9").status_code == 404


def test_delete_removes_session_and_climbs(http, store):
    http.post("/sessions", json=CLIMB)

    assert http.delete("/sessions/1").status_code == 204
    assert store.rows == [] and store.climbs == []


@pytest.mark.parametrize("method", ["post", "patch", "delete"])
def test_writes_need_a_token(method):
    client = TestClient(api.app)
    url = "/sessions" if method == "post" else "/sessions/1"
    kwargs = {"json": RUN} if method != "delete" else {}
    assert getattr(client, method)(url, **kwargs).status_code == 401
