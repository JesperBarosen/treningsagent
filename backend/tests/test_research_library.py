"""Research library files (#168, docs/research-library.md section 5)."""

import research_library as rl

PAPERS_DIR = rl.PAPERS_DIR


def good_paper() -> dict:
    return {
        "key": "damsted-2019", "title": "A title", "authors": ["Damsted C"], "year": 2019,
        "journal": "JOSPT", "pmid": "30526231", "url": "https://pubmed.ncbi.nlm.nih.gov/30526231/",
        "study_type": "prospective_cohort", "evidence": "moderate", "evidence_reason": "Why.",
        "sports": ["running"], "categories": ["load"], "recommended": True,
        "summary": "S.", "why_recommended": "W.", "limits": "L.",
        "claims": [{"id": "c1", "text": "A finding.", "where": "Results",
                    "categories": ["load"], "supports_rules": ["L1b"]}],
    }


def test_good_paper_has_no_errors():
    assert rl.validate_paper(good_paper(), filename="damsted-2019.yaml") == []


def test_missing_required_field():
    p = good_paper()
    del p["title"]
    assert any("title" in e for e in rl.validate_paper(p, filename="damsted-2019.yaml"))


def test_key_must_match_filename():
    errors = rl.validate_paper(good_paper(), filename="other-2020.yaml")
    assert any("filename" in e for e in errors)


def test_unknown_evidence_and_study_type():
    p = good_paper() | {"evidence": "great", "study_type": "blog"}
    errors = rl.validate_paper(p, filename="damsted-2019.yaml")
    assert any("evidence" in e for e in errors)
    assert any("study_type" in e for e in errors)


def test_unknown_category_and_sport():
    p = good_paper() | {"categories": ["vibes"], "sports": ["golf"]}
    errors = rl.validate_paper(p, filename="damsted-2019.yaml")
    assert any("vibes" in e for e in errors)
    assert any("golf" in e for e in errors)


def test_claim_ids_unique_and_rules_known():
    p = good_paper()
    p["claims"] = [
        {"id": "c1", "text": "A.", "where": "R", "categories": ["load"], "supports_rules": ["L1b"]},
        {"id": "c1", "text": "B.", "where": "R", "categories": ["load"], "supports_rules": ["L99"]},
    ]
    errors = rl.validate_paper(p, filename="damsted-2019.yaml")
    assert any("duplicate" in e for e in errors)
    assert any("L99" in e for e in errors)


def test_paper_needs_at_least_one_claim():
    p = good_paper() | {"claims": []}
    assert any("claim" in e for e in rl.validate_paper(p, filename="damsted-2019.yaml"))


def test_every_file_in_the_library_is_valid():
    files = sorted(PAPERS_DIR.glob("*.yaml"))
    assert files, "no papers found"
    for f in files:
        assert rl.validate_paper(rl.read_paper(f), filename=f.name) == [], f.name
