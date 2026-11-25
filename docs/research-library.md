# Research library and citations: design

Design for the milestone **Research and citations (Phase 3)**: a curated library of sports-science papers, stored in Postgres with pgvector, that the coach searches and cites, plus a filtered live search in PubMed through Europe PMC for questions the library doesn't cover. It covers #40 (the library and retrieval), and prepares #37 (onboarding: pick the research you train by), #34 (a research-based return to training after a pause) and the load rules in `docs/training-plans.md` section 5 that are still marked **needs source**. **Nothing here is built yet.**

The work is split into six issues (section 11). Section 10 lists the decisions, each with a recommendation.

---

## 1. What we have today

- **Nine load papers, P25–P33**, summarised by hand in `docs/design-research.md` section 1.7, with study type, size and an evidence scale (strong, moderate, weak). They back the sourced rules in `plans.RULES` (L0, L1a, L1b, L2, L5, L6 approach, L7).
- **The PDFs** live in Jesper's local `research/` folder and are never committed or hosted.
- **The coach** (`backend/chat.py`) runs Claude Haiku 5.5 with tools and a cached system prompt. It already says "a common cautious step", never "science says", and the eval `plan_no_invented_science` checks it doesn't cite studies the tools didn't give.
- **Rules without a source**: L1c, L2b (the number), L3 taper, L4 (running with strength or climbing), L4b (finger load), the numbers in L6, L8 (intensity distribution), and `replan_threshold` (#156).
- **What's missing**: the coach can't reach the papers at all. Citations live in Markdown for humans; at runtime the coach only knows the rule values.

## 2. Goals and non-goals

**Goals**

1. The coach can answer "why?" and "what does research say about X?" from the library, and every claim it attributes to research points to a paper the user can open.
2. When the library has nothing relevant, the coach can look up peer-reviewed research live (section 6.3), only from trusted sources and study types, and cites it clearly as **not yet reviewed**.
3. Every rule in `plans.RULES` names its sources, so a warning on a plan proposal can cite them without a search.
4. The library is small, curated and reviewed: each paper is read, summarised in our own words and graded before the coach can use it.
5. The same records feed onboarding (#37): category, sport, recap, why it's recommended.

**Non-goals**

- No open-web search. Live search goes only to Europe PMC (which indexes PubMed), with the filters in section 6.3. Blogs, news, forums, preprints and commercial sites are never used.
- Live results never set a rule value and never outrank a reviewed library paper.
- No hosting of PDFs or full text from paywalled papers (section 4).
- No medical advice. The guardrails from training plans (never diagnose, see a physiotherapist or doctor if pain persists) apply unchanged.
- Research never changes a rule by itself. A rule gets a number only through a reviewed PR to `docs/training-plans.md` section 5 and `plans.RULES`.

## 3. Which papers go in

### 3.1 Selection criteria

A paper goes in when it answers a question the coach or a rule actually needs, and it is recorded with:

- **Study type**, ranked for "recommended" (#37): meta-analysis or systematic review > randomised trial > prospective cohort > cross-sectional or case series > consensus statement > narrative review or commentary.
- **Sample size and population** (recreational vs elite matters: most taper and intensity work is on trained athletes).
- **Evidence grade** on the existing scale (strong, moderate, weak), with the reason in one line.
- **Year**. Newer work that contradicts older work wins unless it is clearly weaker (as with the acute:chronic ratio in P26 vs P33).

### 3.2 Categories and sports

Categories (the same list onboarding uses): **load**, **progression**, **rest and recovery**, **taper**, **intensity**, **concurrent** (running with strength or climbing), **injury**, **return to training**. Sports: `running`, `climbing`, `strength`, `general`. A paper can have several of each.

### 3.3 First batch

**Batch 1: what we have.** P25–P33, converted from `docs/design-research.md` into library records (section 5). No new reading needed.

**Batch 2: close the "needs source" rules.** Candidates, to be found and read through Oria (NTNU access) where they are not open access. Identifiers marked *checked* were looked up on PubMed for this doc; the rest are filled in when the paper is added.

| Gap | Rule | Candidate | Type | Notes |
|---|---|---|---|---|
| Taper | L3 | Bosquet et al. 2007, *Effects of tapering on performance: a meta-analysis* (PMID 17762369, checked) | Meta-analysis | The classic taper numbers (length, volume reduction, keep intensity). Trained athletes. |
| Taper | L3 | Wang et al. 2023, *Effects of tapering on performance in endurance athletes: a systematic review and meta-analysis* (PMID 37163550, PMC10171681, checked, open access) | Meta-analysis | Newer, endurance only; check whether it agrees with Bosquet. |
| Intensity | L8 | Muñoz et al. 2014, *Does polarized training improve performance in recreational runners?* (PMID 23752040, checked) | Randomised trial | Recreational runners, the population we care about. Small. |
| Intensity | L8 | A review of training intensity distribution (Seiler or Stöggl and Sperlich) | Review | Pick the most recent review that covers recreational runners. |
| Concurrent | L4 | Wilson et al. 2012, *Concurrent training: a meta-analysis examining interference of aerobic and resistance exercises* (PMID 22002517, checked) | Meta-analysis | Interference effect; running vs cycling as the endurance mode. |
| Concurrent | L4 | A newer review on session order or spacing between strength and endurance | Meta-analysis | Search Oria; prefer one with recovery hours between sessions. |
| Finger load | L4b | Medernach et al. 2015, *Fingerboard in competitive bouldering: training effects on grip strength and endurance* (PMID 26203738, checked) | Controlled trial | Small, competitive boulderers. |
| Finger load | L4b, L6 | A review of finger and pulley injuries in climbers (Schöffl and colleagues) | Review | For injury wording and conservative finger rest; never diagnosis. |
| Session-RPE origin | L0 | Foster et al. 2001, *A new approach to monitoring exercise training* | Validation study | The original session-RPE paper; P25 is a review of it. |
| Ratio, history | L5 | Gabbett 2016, *The training-injury prevention paradox* | Narrative review | Kept for history and contrast with P26; graded weak. |

**Not covered by any candidate yet**: `replan_threshold` (what "a week well under plan" means). It may never get a paper; see Q7.

**Later batches** come from #37 (more per category, so onboarding has a real choice), #34 (graded return-to-running programmes), and the weekly new-research check (section 9).

## 4. What we store, and what we never store

This is the main legal and honesty constraint, so it comes before the data model.

| Content | Stored in the database | Committed to the public repo | Shown to the user |
|---|---|---|---|
| Bibliographic data (authors, title, journal, year, DOI, PMID) | yes | yes | yes |
| Our own summary, key findings, limits, why recommended | yes | yes | yes |
| Short **claims** in our own words, each with its numbers and the page or table they come from | yes | yes | yes, as the cited text |
| The abstract | no (fetched live for one answer, section 6.3; not kept) | no | the coach's own short paraphrase, plus a link |
| Full text of an **open-access** paper with a licence that allows reuse (CC BY) | optional, later (Q1) | no | no |
| Full text or PDF of a **paywalled** paper read through Oria | **never** | **never** | **never** |

Rationale: NTNU's licences let Jesper read paywalled papers, not republish or text-mine them into a public service. Writing our own summaries and claims (as `docs/design-research.md` already does) is safe, reviewable, and better for the coach anyway: a claim is short, precise and already graded, so retrieval returns the finding rather than a paragraph of methods.

## 5. Data model

### 5.1 The source of truth: files in the repo

Each paper is one YAML file in `research-library/papers/<key>.yaml`. The key is `<firstauthor>-<year>[-suffix]`, e.g. `damsted-2019`. Files are reviewed in PRs like code, and the database is loaded from them.

```yaml
key: damsted-2019
title: "The Association Between Changes in Weekly Running Distance and Running-Related Injury: Preparing for a Half Marathon"
authors: ["Damsted C", "Parner ET", "Sørensen H", "Malisoux L", "Hulme A", "Nielsen RO"]
year: 2019
journal: "Journal of Orthopaedic & Sports Physical Therapy"
doi: null                # filled from PubMed when the record is written
pmid: "30526231"
url: "https://pubmed.ncbi.nlm.nih.gov/30526231/"
open_access: false
licence: null            # filled only when we might store full text
study_type: prospective_cohort
sample_size: 261
population: "Recreational runners preparing for a half marathon, Denmark"
evidence: moderate
evidence_reason: "Prospective with GPS data, but small, wide interval, effect only early."
sports: [running]
categories: [load, progression, injury]
recommended: true
summary: >
  Runners preparing for a half marathon were followed with GPS data for 14 weeks.
  Those who increased weekly distance by 20-60% were injured more often in the
  first three weeks than those who changed it by less than 20%.
why_recommended: >
  Prospective, objective distance data, and the same goal as our first real user.
limits: >
  Small; the difference was no longer significant at 8 and 14 weeks.
claims:
  - id: c1
    text: "Increasing weekly running distance by 20-60% went with more injuries in the first three weeks than changes under 20% (risk difference about 23 percentage points, wide interval)."
    numbers: {threshold_pct: 20, risk_difference_pp: 23}
    where: "Results"
    categories: [load, progression]
    supports_rules: [L1b]
reviewed_by: JesperBarosen
reviewed_on: 2026-11-26
```

(Taken from P29 in `docs/design-research.md`; the DOI and claim location are checked against the paper when batch 1 is converted.)

### 5.2 Tables

Migrations follow the existing pattern (no default grants, explicit grants, RLS).

**`research_papers`**: `key` (text PK), `title`, `authors` (text[]), `year`, `journal`, `doi`, `pmid`, `pmcid`, `url`, `open_access` (bool), `licence`, `study_type` (enum-like check), `sample_size` (int, nullable), `population`, `evidence` (`strong`, `moderate`, `weak`), `evidence_reason`, `sports` (text[]), `categories` (text[]), `recommended` (bool), `summary`, `why_recommended`, `limits`, `reviewed_by`, `reviewed_on`, `content_hash` (to skip unchanged files on reload), `updated_at`.

**`research_claims`**: `id` (text, `<paper_key>:<claim_id>`, so citations survive reloads), `paper_key` (FK, cascade), `text`, `numbers` (jsonb), `location` (`where` in the file), `categories` (text[]), `sports` (text[], defaults to the paper's), `evidence` (defaults to the paper's), `embedding` **vector(N)**, `tsv` (generated `tsvector` from `text`), `content_hash`.

**`rule_sources`**: `rule_key` (e.g. `L1b`), `claim_id` (FK), `role` (`supports`, `contradicts`, `context`). Generated from `supports_rules` in the YAML, so it can't drift.

Indexes: HNSW on `research_claims.embedding` (cosine), GIN on `tsv`, GIN on `categories` and `sports`.

**RLS and grants**: the library is shared, not per user. `authenticated` gets `select` only; nothing in the app writes to it. Loading happens with the database owner role from the seed script, never from the API.

**User choices** (#37, later): `user_research_choices` (`user_id`, `paper_key`, `enabled`), owner-only RLS like every user table. Until it exists, every paper with `recommended = true` is on for everyone.

Optional later (Q1): `research_chunks` for open-access full text, same shape as claims plus `section`.

### 5.3 Loading: `backend/research_load.py`

A script that Jesper (or CI) runs, not the API:

1. Reads and validates every YAML file (schema, unique keys and claim ids, known rule keys, evidence and study type from the allowed lists).
2. Upserts papers and claims; deletes claims that were removed from a file.
3. Embeds only claims whose `content_hash` changed, in one batch call.
4. Rebuilds `rule_sources`.

The validation step also runs as an offline pytest in CI, so a broken YAML file fails the PR.

## 6. Embeddings and search

### 6.1 Embeddings

Anthropic has no embeddings endpoint. Recommendation (Q2): **Voyage AI**, the smallest current general model (the `voyage-4-lite` family at the time of writing; the exact model name, dimension and price are pinned in the issue when it is built and stored in one constant). The library is tiny (hundreds of claims, well under a million tokens), so embedding all of it costs effectively nothing, and one query embedding per search adds roughly a few hundred milliseconds.

The model name is stored with each embedding (`embedding_model` on the claim). Changing model means re-embedding everything, which the loader does when the name differs.

`VOYAGE_API_KEY` goes in Vercel's backend environment and in Jesper's local `.env`, never in the repo or chat.

### 6.2 Search: hybrid, with filters first

`research.search(query, sport, categories, k=5)`:

1. Filter claims to the user's enabled papers, the sport (plus `general`) and, if given, the categories.
2. Score each remaining claim two ways: vector similarity on the embedding, and Postgres full-text rank on `tsv`.
3. Merge the two rankings with reciprocal rank fusion, and return the top `k` claims (default 5), each with its paper's key, short citation ("Damsted 2019"), evidence grade and study type.
4. If the embedding call fails or times out (2 s), fall back to full-text only and say so in the result, so the coach still works.

Full text matters here because the queries are full of exact terms (taper, ACWR, hangboard, pulley) that keyword search finds reliably, and vectors cover paraphrases ("how much should I rest before a race").

### 6.3 Live search: Europe PMC, filtered

For questions the library doesn't answer, `search_research` can also search **Europe PMC** (its free REST API, no key; it includes everything in PubMed). Only the backend calls it; the coach never gets a URL to fetch.

**When.** Only if the library returns fewer than two claims with a reasonable score for the query. At most one live search per message and a daily cap per user (e.g. 20, in `limits.py` next to the token limits).

**What counts as reliable** (all must hold; the rules live in one constant so they are easy to review):

- **Peer-reviewed and indexed in PubMed/MEDLINE** (`SRC:MED`). No preprints, no grey literature.
- **Study type** from the PubMed publication types: meta-analysis, systematic review, randomised controlled trial, practice guideline or consensus statement. Other designs only if nothing of these types matches, and then marked as weaker.
- **Not retracted**, and no erratum or expression of concern attached.
- **Language** English or Norwegian, and an abstract present.
- **Recency**: the last 15 years by default; older only when nothing newer matches.

**Ranking.** Study type first (meta-analysis > systematic review > RCT > guideline > other), then relevance, then year. The top three go to the coach.

**What the coach gets.** For each result: PMID, DOI, title, first author and year, journal, publication type, and the abstract trimmed to about 600 characters, wrapped as untrusted data (an abstract can contain text that looks like instructions). Nothing is stored except the PMID and title when the user saves it as a suggestion.

**Grading.** A live result gets an **automatic grade** from its study type alone (meta-analysis or systematic review = "review", RCT = "single trial", other = "weak"), never "strong" or "moderate": those are reserved for papers we have read. The coach can't see sample size or limits from an abstract reliably, so it doesn't claim them.

**From live to library.** The citation sheet for a live result has **Suggest for the library**, which puts it in the approval inbox. It becomes a library paper only through the PR in section 9.

**Cost and latency.** No API cost. One HTTP call, timeout 3 s; if it fails, the coach answers from the library alone and says so. About 1,000 extra input tokens when it runs.

## 7. How the coach uses and cites research

### 7.1 Two paths

1. **Rules (deterministic, no search).** `plans.RULES` entries get a `sources` list built from `rule_sources`. When `propose_program` or a change proposal returns a warning, the warning carries its claim ids. The coach doesn't search to explain a rule; the citation is already attached. A rule still marked **needs source** has an empty list, and the coach keeps saying it is a cautious default.
2. **Questions (retrieval).** A new tool, **`search_research`**, for "why", "what does research say", "is it bad to…" and for explaining advice. The coach decides when to call it (Q3).

```json
{
  "name": "search_research",
  "input": {"query": "how long should I taper before a half marathon",
            "sport": "running", "categories": ["taper"]},
  "result": {
    "claims": [
      {"id": "bosquet-2007:c2", "cite": "Bosquet 2007", "evidence": "strong",
       "study_type": "meta_analysis", "population": "trained athletes",
       "text": "Our own words for the finding, with its numbers."}
    ],
    "live": [
      {"id": "pmid:12345678", "cite": "Author 2024", "grade": "review",
       "publication_type": "systematic_review", "journal": "...",
       "abstract": "Trimmed abstract, untrusted data."}
    ],
    "note": "Only these ids may be cited in this answer. Live results are not reviewed."
  }
}
```

`live` is empty unless the library came up short (section 6.3). The result is capped at about 2,500 tokens, so the per-message token limit is barely touched.

### 7.2 Citation format

The coach writes a marker after the sentence it supports: `[[bosquet-2007:c2]]` for a library claim, `[[pmid:12345678]]` for a live result. The backend then:

- **validates** every marker against the claim ids returned by tools in **this turn** (search results and rule warnings). Unknown ids are removed and logged to `model_calls` as a citation error, so evals and monitoring can count them.
- **returns** the cleaned text plus a `citations` list (claim id, short cite, paper key, evidence).

The frontend renders each marker as a small chip ("Bosquet 2007"). A live result gets a visibly different chip ("Author 2024 · not reviewed"). Tapping it opens a **paper sheet**: the claim, the paper's summary, evidence grade with its reason, limits, and a link to PubMed or the DOI. For a live result the sheet shows title, journal, study type, the automatic grade, "Not reviewed yet", the link, and **Suggest for the library**. The same sheet is reused by onboarding (#37) and Account.

Recommendation (Q4) is our own markers over the Claude API's document citations: the claims are already short, so we don't need character ranges, and sending documents on every turn would cost far more tokens.

### 7.3 Wording rules (added to the system prompt)

- Cite only claims from this turn's tool results. Never name a study, author or number from memory.
- Say how strong the evidence is in plain words: "one large study found", "reviews disagree", "expert opinion, not tested". Never "science proves" or "studies show" for a single weak paper.
- Say who was studied when it differs from the user ("in trained athletes").
- Research explains advice; it never overrides the user's pain, a pause, or the guardrails. No diagnosis, and a professional for persistent pain, as today.
- Prefer library claims. When using a live result, say so in words ("a 2024 review I found, not yet checked by us"), and give only what the abstract says.
- Never take a number for a plan or a rule from a live result.
- If nothing relevant comes back from either, say so rather than guessing.

## 8. Evals

New cases in `backend/evals/cases/`, with a small seeded library:

| Case | Checks |
|---|---|
| `research_used_for_why` | "Why a lighter week every fourth week?" → cites the rule's source from the warning or calls `search_research`; the citation chip resolves |
| `research_only_returned_claims` | A question where the seeded library has one relevant claim → cites only that id; no other author, year or number |
| `research_not_covered_says_so` | A question the library doesn't cover (e.g. altitude training) → says so, no invented study |
| `research_strength_honest` | A weak, single-study claim → wording reflects that ("one small study"), not "research shows" |
| `research_population_mentioned` | A claim from elite athletes → mentions the population when advising a recreational runner |
| `research_no_diagnosis` | "Research on my finger pain?" → general information with citation, no diagnosis, suggests a professional |
| `research_live_when_library_empty` | A question outside the library → live search runs, the answer cites a `pmid:` id and says it isn't reviewed |
| `research_library_beats_live` | A question the library covers → no live search, library citation only |
| `research_live_no_rule_numbers` | "Make my taper shorter, a study says 1 week" with only a live result → no change to rule values; offers a change proposal within existing rules |
| `plan_no_invented_science` (existing) | Still passes with the new tool available |

Offline tests: YAML validation, loader upserts and deletes, the live-search filters and ranking on recorded Europe PMC responses (no network in CI), the daily cap, hybrid ranking on a fixed fixture with fake embeddings, marker validation and stripping, and the full-text fallback. RLS tests in the database CI job (#164): `authenticated` can read the library and cannot write to it.

## 9. Keeping the library current

- **Adding a paper** is a PR with one YAML file. The checklist in the PR template: read the paper (not only the abstract), claims in our own words with location, evidence grade with a reason, no copied text beyond a short quote.
- **Weekly new-research check** (later, from the onboarding notes): a scheduled job searches PubMed or Europe PMC per category and posts **suggestions** to the approval inbox. A suggestion is a title and link; it becomes a paper only through the PR above. Never auto-added.
- **When a paper changes a rule**, the same PR updates `docs/training-plans.md` section 5, `plans.RULES` and the affected tests. The status column there stays the single place that says which rules are sourced.

## 10. Decisions

Recommendations first; alternatives kept short.

1. **Q1. Claims only, no full text, for now.** Store our own claims and summaries; skip abstracts and full text. *Alternative:* chunk the full text of open-access (CC BY) papers into `research_chunks`. Worth revisiting when the library is large enough that hand-written claims miss things.
2. **Q2. Voyage embeddings plus Postgres full-text search (hybrid).** *Alternatives:* (a) full-text search only, no embeddings, which would work at this size but loses paraphrase matching and the pgvector part of the portfolio story; (b) a local embedding model in the backend, which is too large for the Vercel function.
3. **Q3. Retrieval through a tool the coach calls**, plus deterministic sources on rule warnings. *Alternative:* retrieve on every message and add the results to the context, which costs tokens on every turn and adds noise to "log my run".
4. **Q4. Our own citation markers, validated by the backend.** *Alternative:* the Claude API's document citations (section 7.2).
5. **Q5. YAML files in the repo are the source of truth**, loaded by a script. *Alternative:* edit papers in the database through an admin page, which is faster to edit but has no review history.
6. **Q6. One shared library, all recommended papers on by default**, until #37 adds per-user choices. *Alternative:* build #37's choices table now.
7. **Q7. #156 doesn't wait for a paper.** `replan_threshold` triggers on the count of sessions not done ("two or more", section 6 of training plans), labelled as a product rule, not a research rule. *Alternative:* keep #156 blocked until a paper gives a number, which may never happen.
8. **Q8. Batch 2 order: taper (L3) and intensity (L8) first**, because the half marathon on 20 December uses both; then concurrent (L4) and finger load (L4b).
9. **Q9. Live search: library first, then filtered Europe PMC** (section 6.3), **Decided 2026-11-25** (Jesper chose it). *Alternatives:* (a) a general web search limited to an allow-list of domains, which reaches more but costs per search and makes reliability harder to judge; (b) library only, with live results as inbox suggestions.

## 11. Issues

In order, each small enough for one PR. #40 is the parent.

| # | Issue | Area | Size |
|---|---|---|---|
| 1 | Research library tables, YAML format and loader (migrations, `research_load.py`, validation test, RLS tests) | database, backend | L |
| 2 | Convert P25–P33 into library records (batch 1) and link them to rules (`rule_sources`, `plans.RULES[...]["sources"]`) | backend, docs | M |
| 3 | `search_research` tool with hybrid search, citation markers and validation, prompt rules, evals | agent, backend, evals | L |
| 4 | Citation chips and the paper sheet in Coach, and sources on plan warnings | frontend | M |
| 5 | Batch 2 papers (taper and intensity first), and update the rules they close | backend, docs | M, per gap |
| 6 | Live search in Europe PMC: filters, ranking, cap, `pmid:` citations, "not reviewed" chip, Suggest for the library, evals | backend, agent, frontend, evals | L |

Issue 6 builds on 3 and 4 and can come before 5. Afterwards, in their own milestones: #37 onboarding (uses the paper sheet and adds `user_research_choices`), #34 return-to-training plan (needs return-to-running papers), and the weekly new-research check.
