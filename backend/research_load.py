"""Load the research library into the database (#168, docs/research-library.md section 5.3).

    cd backend && uv run python research_load.py           # validate, then load
    cd backend && uv run python research_load.py --check   # validate only

Reads every research-library/papers/*.yaml, refuses to load anything if one
file is invalid, then makes the database match the files: new and changed
papers are written, unchanged ones skipped, and papers whose file was removed
deleted. Runs as the connection's own role, so RLS doesn't apply; the app
itself can only read these tables. Embeddings come later (#170): a claim
whose text changes gets its embedding cleared, so a stale vector is never used.
"""

import hashlib
import json
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

import research_library as rl

PAPER_COLUMNS = ("key", "title", "authors", "year", "journal", "doi", "pmid", "pmcid", "url",
                 "open_access", "licence", "study_type", "sample_size", "population", "evidence",
                 "evidence_reason", "sports", "categories", "recommended", "summary",
                 "why_recommended", "limits", "reviewed_by", "reviewed_on", "content_hash")


def _hash(value) -> str:
    """A stable hash of a YAML value (dates become strings, keys are sorted)."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def read_all(papers_dir: Path = rl.PAPERS_DIR) -> tuple[list[dict], list[str]]:
    """Every paper file, and every problem found in them (empty when all are valid)."""
    papers, errors = [], []
    for path in sorted(papers_dir.glob("*.yaml")):
        paper = rl.read_paper(path)
        errors += [f"{path.name}: {e}" for e in rl.validate_paper(paper, filename=path.name)]
        papers.append(paper)
    return papers, errors


def paper_rows(paper: dict) -> tuple[dict, list[dict], list[dict]]:
    """One valid paper as rows for research_papers, research_claims and rule_sources.
    Claims without their own categories, sports or evidence take the paper's."""
    row = {c: paper.get(c) for c in PAPER_COLUMNS if c != "content_hash"}
    row["open_access"] = bool(paper.get("open_access", False))
    row["content_hash"] = _hash(paper)
    claims, sources = [], []
    for c in paper["claims"]:
        claim_id = f"{paper['key']}:{c['id']}"
        claims.append({
            "id": claim_id, "paper_key": paper["key"], "text": c["text"].strip(),
            "numbers": c.get("numbers") or {}, "location": c["where"],
            "categories": c.get("categories") or paper["categories"],
            "sports": c.get("sports") or paper["sports"],
            "evidence": c.get("evidence") or paper["evidence"],
            "content_hash": _hash(c["text"].strip()),
        })
        sources += [{"rule_key": r, "claim_id": claim_id, "role": "supports"}
                    for r in c.get("supports_rules", [])]
    return row, claims, sources


def load(conn: psycopg.Connection, papers: list[dict], prune: bool = True) -> dict:
    """Make the library tables match `papers` (all already valid), in one
    transaction. With prune, papers that aren't in `papers` are deleted.
    Returns counts of what changed."""
    counts = {"written": 0, "unchanged": 0, "deleted": 0}
    with conn.transaction():
        current = {r["key"]: r["content_hash"] for r in
                   conn.execute("select key, content_hash from public.research_papers")}
        for paper in papers:
            row, claims, sources = paper_rows(paper)
            if current.get(row["key"]) == row["content_hash"]:
                counts["unchanged"] += 1
                continue
            _write_paper(conn, row, claims, sources)
            counts["written"] += 1
        if prune:
            gone = sorted(set(current) - {p["key"] for p in papers})
            if gone:
                conn.execute("delete from public.research_papers where key = any(%s)", (gone,))
            counts["deleted"] = len(gone)
    return counts


def _write_paper(conn, row: dict, claims: list[dict], sources: list[dict]) -> None:
    cols = ", ".join(row)
    updates = ", ".join(f"{c} = excluded.{c}" for c in row if c != "key")
    conn.execute(f"insert into public.research_papers ({cols}, updated_at)"
                 f" values ({', '.join(['%s'] * len(row))}, now())"
                 f" on conflict (key) do update set {updates}, updated_at = now()",
                 tuple(row.values()))
    keep = [c["id"] for c in claims]
    conn.execute("delete from public.research_claims where paper_key = %s and id <> all(%s)",
                 (row["key"], keep))
    for c in claims:
        # A changed text clears the embedding; an unchanged one keeps it.
        conn.execute(
            "insert into public.research_claims (id, paper_key, text, numbers, location,"
            " categories, sports, evidence, content_hash) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
            " on conflict (id) do update set text = excluded.text, numbers = excluded.numbers,"
            " location = excluded.location, categories = excluded.categories,"
            " sports = excluded.sports, evidence = excluded.evidence,"
            " embedding = case when research_claims.content_hash = excluded.content_hash"
            "             then research_claims.embedding end,"
            " embedding_model = case when research_claims.content_hash = excluded.content_hash"
            "                   then research_claims.embedding_model end,"
            " content_hash = excluded.content_hash",
            (c["id"], c["paper_key"], c["text"], Jsonb(c["numbers"]), c["location"],
             c["categories"], c["sports"], c["evidence"], c["content_hash"]))
    conn.execute("delete from public.rule_sources where claim_id = any(%s)", (keep,))
    for s in sources:
        conn.execute("insert into public.rule_sources (rule_key, claim_id, role) values (%s, %s, %s)",
                     (s["rule_key"], s["claim_id"], s["role"]))


def main(argv: list[str], papers_dir: Path = rl.PAPERS_DIR) -> int:
    papers, errors = read_all(papers_dir)
    if errors:
        print("Not loaded; fix these first:", *errors, sep="\n  ")
        return 1
    print(f"{len(papers)} paper(s) valid.")
    if "--check" in argv:
        return 0
    import db
    import env
    env.load()
    with db.connect() as conn:
        counts = load(conn, papers)
    print(f"Written {counts['written']}, unchanged {counts['unchanged']}, deleted {counts['deleted']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
