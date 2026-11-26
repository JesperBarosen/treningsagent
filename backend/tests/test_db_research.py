"""The research library tables and loader against a real database (#168).

Needs migration 20261126120000_create_research_library.sql. Skipped unless
TEST_DATABASE_URL is set, like test_db.py. Test papers use keys starting
with "test-" and are deleted afterwards; the repo's own papers are left alone.
"""

import copy

import psycopg
import pytest

import research_library as rl
import research_load
from test_db import URL, conn, make_store  # noqa: F401

pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


def paper(key: str = "test-paper-2024", **over) -> dict:
    base = rl.read_paper(rl.PAPERS_DIR / "damsted-2019.yaml")
    return {**copy.deepcopy(base), "key": key, **over}


@pytest.fixture
def db(conn):
    c = conn[0]
    yield conn
    c.execute("delete from public.research_papers where key like 'test-%'")


def claim(c, claim_id: str) -> dict | None:
    return c.execute("select * from public.research_claims where id = %s", (claim_id,)).fetchone()


def test_load_writes_then_skips_unchanged(db):
    c = db[0]
    assert research_load.load(c, [paper()], prune=False)["written"] == 1
    assert research_load.load(c, [paper()], prune=False) == {"written": 0, "unchanged": 1, "deleted": 0}
    row = c.execute("select * from public.research_papers where key = 'test-paper-2024'").fetchone()
    assert row["evidence"] == "moderate" and row["authors"][0] == "Damsted C"
    assert claim(c, "test-paper-2024:c1")["sports"] == ["running"]
    assert c.execute("select rule_key from public.rule_sources where claim_id = 'test-paper-2024:c1'"
                     ).fetchall() == [{"rule_key": "L1b"}]


def test_changed_text_clears_the_embedding_and_removed_claims_go(db):
    c = db[0]
    p = paper()
    p["claims"] = p["claims"] + [{"id": "c2", "text": "Another finding.", "where": "Discussion"}]
    research_load.load(c, [p], prune=False)
    c.execute("update public.research_claims set embedding = array_fill(0.1, array[1024])::extensions.vector,"
              " embedding_model = 'test' where paper_key = 'test-paper-2024'")
    p2 = copy.deepcopy(p)
    p2["claims"] = [p["claims"][0] | {"text": "A reworded finding."}]  # c1 changed, c2 removed
    research_load.load(c, [p2], prune=False)
    assert claim(c, "test-paper-2024:c1")["embedding"] is None
    assert claim(c, "test-paper-2024:c2") is None
    # Only the summary changed: the claim text is the same, so its embedding stays.
    c.execute("update public.research_claims set embedding = array_fill(0.1, array[1024])::extensions.vector"
              " where id = 'test-paper-2024:c1'")
    research_load.load(c, [p2 | {"summary": "New summary."}], prune=False)
    assert claim(c, "test-paper-2024:c1")["embedding"] is not None


def test_full_text_search_column(db):
    c = db[0]
    research_load.load(c, [paper()], prune=False)
    hits = c.execute("select id from public.research_claims where paper_key = 'test-paper-2024'"
                     " and tsv @@ websearch_to_tsquery('english', 'weekly distance injuries')").fetchall()
    assert hits == [{"id": "test-paper-2024:c1"}]


def test_prune_deletes_papers_without_a_file(db):
    c = db[0]
    research_load.load(c, [paper(), paper("test-other-2020")], prune=False)
    with c.transaction(force_rollback=True):  # leave the repo's own papers in place
        counts = research_load.load(c, [paper()], prune=True)
        assert counts["deleted"] >= 1
        assert claim(c, "test-other-2020:c1") is None and claim(c, "test-paper-2024:c1") is not None


def test_signed_in_users_can_read_but_not_write(db):
    c = db[0]
    research_load.load(c, [paper()], prune=False)
    store = make_store(db)
    with store._as_user() as u:
        assert u.execute("select count(*) as n from public.research_claims"
                         " where paper_key = 'test-paper-2024'").fetchone()["n"] == 1
    for query in ("update public.research_papers set title = 'x' where key = 'test-paper-2024'",
                  "delete from public.research_claims where paper_key = 'test-paper-2024'",
                  "insert into public.rule_sources (rule_key, claim_id) values ('L1a', 'test-paper-2024:c1')"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with store._as_user() as u:
                u.execute(query)


def test_anon_cannot_read_the_library(db):
    c = db[0]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with c.transaction():
            c.execute("set local role anon")
            c.execute("select count(*) from public.research_papers")


def test_constraints(db):
    c = db[0]
    bad = paper(evidence="great")
    with pytest.raises(psycopg.errors.CheckViolation):
        research_load.load(c, [bad], prune=False)
