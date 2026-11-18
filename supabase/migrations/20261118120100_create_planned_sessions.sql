-- Planned sessions (#116, docs/training-plans.md sections 3, 6 and 7). Needs
-- 20261118120000_create_training_plans.sql.
--
-- A planned session belongs to a plan, or to no plan (a one-off suggestion,
-- #38, Q3). Its target varies by sport and template, so it is jsonb, checked
-- by the backend (plans.py) and here only for shape and size. Only the user's
-- own choices are stored (planned or skipped); done, not done and paused are
-- derived when read (#117). The link to the logged session lives here, and a
-- session can be linked to one planned session at most.

create table public.planned_sessions (
    id           bigint generated always as identity primary key,
    user_id      uuid        not null default auth.uid()
                 references auth.users (id) on delete cascade,
    plan_id      bigint      references public.training_plans (id) on delete cascade,
    date         date        not null,
    -- Order within the day; at most 2 planned sessions a day (plans.py).
    slot         smallint    not null default 0 check (slot between 0 and 1),
    sport        text        not null check (sport in ('running', 'climbing', 'strength', 'other')),
    -- NO ACTION, as for sessions: a template that plans use is archived, not deleted.
    template_id  bigint      references public.session_templates (id),
    title        text        not null check (char_length(title) between 1 and 60),
    target       jsonb       not null default '{}'
                 check (jsonb_typeof(target) = 'object' and pg_column_size(target) <= 8192),
    status       text        not null default 'planned' check (status in ('planned', 'skipped')),
    skip_reason  text        check (char_length(skip_reason) <= 200),
    -- Deleting the session unlinks it, and the planned session is open again.
    session_id   bigint      unique references public.sessions (id) on delete set null,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    constraint planned_sessions_skip_reason check (status = 'skipped' or skip_reason is null)
);

create index planned_sessions_user_date_idx on public.planned_sessions (user_id, date);
create index planned_sessions_plan_id_idx on public.planned_sessions (plan_id);
create index planned_sessions_template_id_idx on public.planned_sessions (template_id);

alter table public.planned_sessions enable row level security;

create policy "Users can read their own planned sessions"
    on public.planned_sessions for select to authenticated
    using (user_id = (select auth.uid()));

-- Foreign key checks bypass RLS, so the plan, the template and the session
-- must all be the caller's own.
create policy "Users can add their own planned sessions"
    on public.planned_sessions for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and (plan_id is null
             or exists (select 1 from public.training_plans p
                        where p.id = plan_id and p.user_id = (select auth.uid())))
        and (template_id is null
             or exists (select 1 from public.session_templates t
                        where t.id = template_id and t.user_id = (select auth.uid())))
        and (session_id is null
             or exists (select 1 from public.sessions s
                        where s.id = session_id and s.user_id = (select auth.uid()))));

create policy "Users can change their own planned sessions"
    on public.planned_sessions for update to authenticated
    using (user_id = (select auth.uid()))
    with check (
        user_id = (select auth.uid())
        and (plan_id is null
             or exists (select 1 from public.training_plans p
                        where p.id = plan_id and p.user_id = (select auth.uid())))
        and (template_id is null
             or exists (select 1 from public.session_templates t
                        where t.id = template_id and t.user_id = (select auth.uid())))
        and (session_id is null
             or exists (select 1 from public.sessions s
                        where s.id = session_id and s.user_id = (select auth.uid()))));

create policy "Users can delete their own planned sessions"
    on public.planned_sessions for delete to authenticated
    using (user_id = (select auth.uid()));

-- user_id comes from the default. session_id is written by the link (#117).
grant select, delete on public.planned_sessions to authenticated;
grant insert (plan_id, date, slot, sport, template_id, title, target, status, skip_reason, session_id)
    on public.planned_sessions to authenticated;
grant update (date, slot, sport, template_id, title, target, status, skip_reason, session_id, updated_at)
    on public.planned_sessions to authenticated;
