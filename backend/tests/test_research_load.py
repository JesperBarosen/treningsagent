"""Turning paper files into library rows (#168, docs/research-library.md section 5.3).

Offline: reading a folder of papers, refusing invalid ones, and the rows a
paper becomes. Loading into a real database is in test_db_research.py.
"""

import shutil

import research_library as rl
import research_load


def test_the_library_in_the_repo_is_valid():
    papers, errors = research_load.read_all()
    assert errors == [] and papers


def test_an_invalid_file_is_reported_with_its_name(tmp_path):
    shutil.copy(rl.PAPERS_DIR / "damsted-2019.yaml", tmp_path / "wrong-name-2019.yaml")
    _, errors = research_load.read_all(tmp_path)
    assert errors and all(e.startswith("wrong-name-2019.yaml: ") for e in errors)


def test_main_refuses_to_load_an_invalid_library(tmp_path, capsys):
    (tmp_path / "broken-2020.yaml").write_text("key: broken-2020\n", encoding="utf-8")
    assert research_load.main(["--check"], tmp_path) == 1
    assert "Not loaded" in capsys.readouterr().out


def test_paper_rows():
    paper = rl.read_paper(rl.PAPERS_DIR / "damsted-2019.yaml")
    row, claims, sources = research_load.paper_rows(paper)
    assert row["key"] == "damsted-2019" and row["open_access"] is False and len(row["content_hash"]) == 64
    [claim] = claims
    assert claim["id"] == "damsted-2019:c1" and claim["location"] == "Results"
    assert claim["sports"] == ["running"] and claim["evidence"] == "moderate"  # taken from the paper
    assert sources == [{"rule_key": "L1b", "claim_id": "damsted-2019:c1", "role": "supports"}]


def test_the_hash_changes_with_the_content():
    paper = rl.read_paper(rl.PAPERS_DIR / "damsted-2019.yaml")
    before = research_load.paper_rows(paper)[0]["content_hash"]
    paper["summary"] += " More."
    assert research_load.paper_rows(paper)[0]["content_hash"] != before
