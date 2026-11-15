-- Pausing tracking on purpose (docs/design-proposals-2.md, N5): a break with a
-- reason, so trends and the load ratio leave the paused days out and the coach
-- knows. The injury fields are kept structured (body part, pain 0-10) so a
-- later return-to-training feature (#34) can use them. Nothing here is a
-- diagnosis: it is what the user chose to note.
create table public.pauses (
    id            bigint generated always as identity primary key,
    user_id       uuid        not null default auth.uid()
                  references auth.users (id) on delete cascade,
    start_date    date        not null default current_date,
    -- The day the user expects to be back; optional.
    planned_end   date        check (planned_end is null or planned_end >= start_date),
    -- The day the pause actually ended; null while it is on.
    ended_on      date        check (ended_on is null or ended_on >= start_date),
    reason        text        not null check (reason in ('injury', 'illness', 'travel', 'other')),
    body_part     text        check (char_length(body_part) <= 60),
    pain          smallint    check (pain between 0 and 10),
    note          text        check (char_length(note) <= 500),
    -- How the user came back: keep the history as the baseline, or start fresh
    -- (the old baseline is left out of trends for four weeks).
    resume_choice text        check (resume_choice in ('continue', 'fresh')),
    created_at    timestamptz not null default now(),
    -- Body part and pain belong to an injury only.
    constraint pauses_injury_fields check (
        reason = 'injury' or (body_part is null and pain is null)),
    constraint pauses_resume_when_ended check (
        (ended_on is null) = (resume_choice is null))
);

-- At most one pause on at a time per user.
create unique index pauses_one_active_per_user on public.pauses (user_id) where ended_on is null;
create index pauses_user_id_start_date_idx on public.pauses (user_id, start_date);

alter table public.pauses enable row level security;

create policy "Users can read their own pauses"
    on public.pauses for select to authenticated
    using (user_id = (select auth.uid()));

create policy "Users can start their own pauses"
    on public.pauses for insert to authenticated
    with check (user_id = (select auth.uid()));

create policy "Users can end their own pauses"
    on public.pauses for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

-- user_id comes from the default; only these columns are written by the API.
grant select on public.pauses to authenticated;
grant insert (start_date, planned_end, reason, body_part, pain, note) on public.pauses to authenticated;
grant update (ended_on, resume_choice) on public.pauses to authenticated;
