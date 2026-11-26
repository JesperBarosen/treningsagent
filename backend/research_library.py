"""The research library's paper files (#168, docs/research-library.md section 5).

Each paper is one YAML file in `research-library/papers/<key>.yaml`, written in
our own words and reviewed in a PR. This module reads a file and lists what is
wrong with it. Loading into the database comes later.
"""

from pathlib import Path

import yaml

PAPERS_DIR = Path(__file__).resolve().parent.parent / "research-library" / "papers"

REQUIRED = ("key", "title", "authors", "year", "journal", "url", "study_type",
            "evidence", "evidence_reason", "sports", "categories", "recommended",
            "summary", "why_recommended", "limits", "claims")
CLAIM_REQUIRED = ("id", "text", "where")

# Ranked strongest first (section 3.1); the order is used for "recommended".
STUDY_TYPES = ("meta_analysis", "systematic_review", "rct", "controlled_trial",
               "prospective_cohort", "validation_study", "cross_sectional",
               "case_series", "consensus", "narrative_review")
EVIDENCE = ("strong", "moderate", "weak")
CATEGORIES = ("load", "progression", "rest_recovery", "taper", "intensity",
              "concurrent", "injury", "return_to_training")
SPORTS = ("running", "climbing", "strength", "general")
# The rule codes in docs/training-plans.md section 5. plans.RULES is keyed by
# parameter name, so the link to it is made in #169.
RULE_KEYS = ("L0", "L1a", "L1b", "L1c", "L2", "L2b", "L3", "L4", "L4b",
             "L5", "L6", "L7", "L8")


def read_paper(path: Path) -> dict:
    """One paper file as a dict. safe_load never runs code from the file, and
    utf-8 keeps names like Sørensen intact on Windows."""
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def validate_paper(paper: dict, filename: str) -> list[str]:
    """Every problem with one paper, as readable messages. An empty list means
    the paper is valid. Collects all errors instead of stopping at the first."""
    errors = [f"missing field: {f}" for f in REQUIRED if f not in paper]

    if paper.get("key") != filename.removesuffix(".yaml"):
        errors.append(f"key {paper.get('key')!r} does not match filename {filename}")
    if "evidence" in paper and paper["evidence"] not in EVIDENCE:
        errors.append(f"unknown evidence: {paper['evidence']}")
    if "study_type" in paper and paper["study_type"] not in STUDY_TYPES:
        errors.append(f"unknown study_type: {paper['study_type']}")
    errors += _unknown(paper.get("categories", []), CATEGORIES, "category")
    errors += _unknown(paper.get("sports", []), SPORTS, "sport")

    claims = paper.get("claims") or []
    if not claims:
        errors.append("a paper needs at least one claim")
    seen: set[str] = set()
    for claim in claims:
        cid = claim.get("id")
        errors += [f"claim {cid}: missing field: {f}" for f in CLAIM_REQUIRED if f not in claim]
        if cid in seen:
            errors.append(f"duplicate claim id: {cid}")
        seen.add(cid)
        errors += _unknown(claim.get("categories", []), CATEGORIES, f"claim {cid}: category")
        errors += _unknown(claim.get("supports_rules", []), RULE_KEYS, f"claim {cid}: rule")
    return errors


def _unknown(values: list, allowed: tuple, what: str) -> list[str]:
    return [f"unknown {what}: {v}" for v in values if v not in allowed]
