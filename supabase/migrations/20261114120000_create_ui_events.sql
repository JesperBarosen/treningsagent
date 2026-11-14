-- Privacy-respecting UI events for measuring design changes (see
-- docs/design-proposals-2.md, "Measurement"): who, which event and when.
-- No content, no free text: the event name is a short slug such as
-- 'weekly_review_opened'. The app only inserts; reading is for analysis
-- with the database's own role, which RLS doesn't restrict.
create table public.ui_events (
    id         bigint generated always as identity primary key,
    user_id    uuid        not null default auth.uid()
               references auth.users (id) on delete cascade,
    event      text        not null check (event ~ '^[a-z][a-z0-9_]{0,63}$'),
    created_at timestamptz not null default now()
);

create index ui_events_event_created_at_idx on public.ui_events (event, created_at);
create index ui_events_user_id_idx on public.ui_events (user_id);

alter table public.ui_events enable row level security;

create policy "Users can insert their own UI events"
    on public.ui_events for insert to authenticated
    with check (user_id = (select auth.uid()));

-- Only the columns the client may set: user_id defaults to the caller and
-- created_at to now(), so neither can be forged.
grant insert (event) on public.ui_events to authenticated;
