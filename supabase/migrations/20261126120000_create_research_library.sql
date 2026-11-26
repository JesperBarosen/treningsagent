-- The research library (#168, docs/research-library.md section 5): papers,
-- the claims the coach searches and cites, and which claims back which load
-- rule. One shared, read-only library: no user_id, nothing in the app writes
-- to it. backend/research_load.py fills it from research-library/papers/*.yaml
-- as the connection's own role (postgres), which RLS doesn't restrict.
--
-- Only our own words are stored: summaries and short claims. Never abstracts,
-- full text or PDFs (section 4).

create extension if not exists vector with schema extensions;

create table public.research_papers (
    key              text        primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title            text        not null check (char_length(title) between 1 and 400),
    authors          text[]      not null check (cardinality(authors) between 1 and 50),
    year             smallint    not null check (year between 1950 and 2100),
    journal          text        not null,
    doi              text,
    pmid             text        check (pmid ~ '^[0-9]+$'),
    pmcid            text,
    url              text        not null check (url ~ '^https://'),
    open_access      boolean     not null default false,
    licence          text,
    study_type       text        not null check (study_type in (
                         'meta_analysis', 'systematic_review', 'rct', 'controlled_trial',
                         'prospective_cohort', 'validation_study', 'cross_sectional',
                         'case_series', 'consensus', 'narrative_review')),
    sample_size      integer     check (sample_size > 0),
    population       text,
    evidence         text        not null check (evidence in ('strong', 'moderate', 'weak')),
    evidence_reason  text        not null,
    sports           text[]      not null check (cardinality(sports) >= 1 and sports <@ array[
                         'running', 'climbing', 'strength', 'general']::text[]),
    categories       text[]      not null check (cardinality(categories) >= 1 and categories <@ array[
                         'load', 'progression', 'rest_recovery', 'taper', 'intensity',
                         'concurrent', 'injury', 'return_to_training']::text[]),
    recommended      boolean     not null default false,
    summary          text        not null,
    why_recommended  text        not null,
    limits           text        not null,
    reviewed_by      text,
    reviewed_on      date,
    -- Hash of the whole file, so an unchanged paper is skipped on reload.
    content_hash     text        not null,
    updated_at       timestamptz not null default now()
);

create table public.research_claims (
    -- '<paper key>:<claim id>', e.g. 'damsted-2019:c1'. Stable across reloads,
    -- so citations stored in chat history keep pointing at the same claim.
    id               text        primary key check (id ~ '^[a-z0-9-]+:[a-z0-9_-]+$'),
    paper_key        text        not null references public.research_papers (key) on delete cascade,
    text             text        not null check (char_length(text) between 1 and 600),
    numbers          jsonb       not null default '{}' check (jsonb_typeof(numbers) = 'object'),
    location         text        not null,
    categories       text[]      not null default '{}',
    sports           text[]      not null default '{}',
    evidence         text        not null check (evidence in ('strong', 'moderate', 'weak')),
    -- Filled by #170 (Voyage). Null until embedded, and set back to null when
    -- the text changes, so a stale vector is never searched.
    embedding        extensions.vector(1024),
    embedding_model  text,
    tsv              tsvector    generated always as (to_tsvector('english', text)) stored,
    content_hash     text        not null
);

create index research_claims_paper_key on public.research_claims (paper_key);
create index research_claims_tsv on public.research_claims using gin (tsv);
create index research_claims_categories on public.research_claims using gin (categories);
create index research_claims_sports on public.research_claims using gin (sports);
create index research_claims_embedding on public.research_claims
    using hnsw (embedding extensions.vector_cosine_ops);

-- Rule codes from docs/training-plans.md section 5.
create table public.rule_sources (
    rule_key   text not null check (rule_key in ('L0', 'L1a', 'L1b', 'L1c', 'L2', 'L2b', 'L3',
                                                 'L4', 'L4b', 'L5', 'L6', 'L7', 'L8')),
    claim_id   text not null references public.research_claims (id) on delete cascade,
    role       text not null default 'supports' check (role in ('supports', 'contradicts', 'context')),
    primary key (rule_key, claim_id)
);

create index rule_sources_claim_id on public.rule_sources (claim_id);

-- Signed-in users can read the library; nobody writes to it through the API.
alter table public.research_papers enable row level security;
alter table public.research_claims enable row level security;
alter table public.rule_sources enable row level security;

create policy "Signed-in users can read the research library"
    on public.research_papers for select to authenticated using (true);
create policy "Signed-in users can read research claims"
    on public.research_claims for select to authenticated using (true);
create policy "Signed-in users can read rule sources"
    on public.rule_sources for select to authenticated using (true);

grant select on public.research_papers, public.research_claims, public.rule_sources to authenticated;
