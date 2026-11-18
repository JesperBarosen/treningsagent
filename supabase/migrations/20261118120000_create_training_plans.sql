-- Training plans (#116, docs/training-plans.md sections 3 and 7): 4 to 12
-- weeks from a Monday, optionally serving one goal. Week kinds (build,
-- deload, taper, test) are a small jsonb array read with the plan; everything
-- the server filters on is a column. The backend (plans.py) validates the
-- plan; the database checks shape, size and ownership.
--
-- A plan is never deleted by the app: leaving it sets status 'left' (P23), so
-- its planned sessions stay as a record.

create table public.training_plans (
    id          bigint generated always as identity primary key,
    user_id     uuid        not null default auth.uid()
                references auth.users (id) on delete cascade,
    name        text        not null check (char_length(name) between 1 and 60),
    -- Deleting the goal keeps the plan, without a goal.
    goal_id     bigint      references public.goals (id) on delete set null,
    start_date  date        not null check (extract(isodow from start_date) = 1),
    weeks       smallint    not null check (weeks between 4 and 12),
    -- [{"index": 1, "kind": "build", "note": null}, ...]; plans.py checks the items.
    week_meta   jsonb       not null default '[]'
                check (jsonb_typeof(week_meta) = 'array' and jsonb_array_length(week_meta) <= 12
                       and pg_column_size(week_meta) <= 4096),
    status      text        not null default 'active'
                check (status in ('active', 'paused', 'finished', 'left')),
    ended_on    date,
    rationale   text        check (char_length(rationale) <= 300),
    source      text        not null default 'user' check (source in ('coach', 'user')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    -- Finished and left plans have an end date; active and paused ones don't.
    constraint training_plans_ended_on check ((status in ('finished', 'left')) = (ended_on is not null))
);

create index training_plans_user_id_idx on public.training_plans (user_id);
create index training_plans_goal_id_idx on public.training_plans (goal_id);
-- One current plan per user (Q3): active, or paused for a break. One-off
-- planned sessions (no plan) can sit next to it.
create unique index training_plans_one_current_idx
    on public.training_plans (user_id) where status in ('active', 'paused');

alter table public.training_plans enable row level security;

create policy "Users can read their own plans"
    on public.training_plans for select to authenticated
    using (user_id = (select auth.uid()));

-- Foreign key checks bypass RLS, so the goal must be the caller's own.
create policy "Users can add their own plans"
    on public.training_plans for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and (goal_id is null
             or exists (select 1 from public.goals g
                        where g.id = goal_id and g.user_id = (select auth.uid()))));

create policy "Users can change their own plans"
    on public.training_plans for update to authenticated
    using (user_id = (select auth.uid()))
    with check (
        user_id = (select auth.uid())
        and (goal_id is null
             or exists (select 1 from public.goals g
                        where g.id = goal_id and g.user_id = (select auth.uid()))));

create policy "Users can delete their own plans"
    on public.training_plans for delete to authenticated
    using (user_id = (select auth.uid()));

-- user_id comes from the default.
grant select, delete on public.training_plans to authenticated;
grant insert (name, goal_id, start_date, weeks, week_meta, status, ended_on, rationale, source)
    on public.training_plans to authenticated;
grant update (name, goal_id, start_date, weeks, week_meta, status, ended_on, rationale, updated_at)
    on public.training_plans to authenticated;
