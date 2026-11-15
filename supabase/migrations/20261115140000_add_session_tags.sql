-- Context tags on a session (docs/design-proposals-2.md, N6): optional,
-- tap-to-toggle notes such as "slept badly" or "felt strong", so the coach and
-- the weekly review can notice what often goes together. Never required; an
-- untagged session has an empty array.
alter table public.sessions
    add column tags text[] not null default '{}'
        check (tags <@ array['slept_badly', 'sore', 'tired', 'felt_strong', 'hot', 'stressed']::text[]
               and cardinality(tags) <= 6);

-- Sessions are inserted and edited by their owner (RLS policies already exist);
-- the new column needs the same column grants as the others.
grant insert (tags), update (tags) on public.sessions to authenticated;
