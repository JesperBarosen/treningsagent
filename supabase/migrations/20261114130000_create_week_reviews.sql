-- The weekly review (docs/design-proposals-2.md, N1): one row per user and
-- reviewed week, holding the "Note for next week" and whether the review
-- was finished or skipped. A skipped week's card stays quiet on Coach.
create table public.week_reviews (
    user_id    uuid        not null default auth.uid()
               references auth.users (id) on delete cascade,
    -- Monday of the reviewed week (weeks start on Monday, like /training-load).
    week_start date        not null check (extract(isodow from week_start) = 1),
    status     text        not null check (status in ('done', 'skipped')),
    note       text        check (char_length(note) <= 500),
    updated_at timestamptz not null default now(),
    primary key (user_id, week_start)
);

alter table public.week_reviews enable row level security;

create policy "Users can read their own week reviews"
    on public.week_reviews for select to authenticated
    using (user_id = (select auth.uid()));

create policy "Users can insert their own week reviews"
    on public.week_reviews for insert to authenticated
    with check (user_id = (select auth.uid()));

create policy "Users can update their own week reviews"
    on public.week_reviews for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

-- user_id always comes from the default (auth.uid()), never from the client.
-- Upserts set every sent column on conflict, so week_start needs update too.
grant select on public.week_reviews to authenticated;
grant insert (week_start, status, note, updated_at) on public.week_reviews to authenticated;
grant update (week_start, status, note, updated_at) on public.week_reviews to authenticated;
