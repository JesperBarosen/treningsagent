-- Sessions that use a template, and two new built-in sports (#100,
-- docs/custom-log-forms.md 3.3 and 5). Needs 20261116130000_create_session_templates.sql.
--
-- Existing sessions get template_id null (the built-in Run or Climb form) and
-- custom_values '{}', so they read, edit and count exactly as before.

-- 1. Strength and Other count in weekly load like running and climbing (Q1, closes #27).
alter table public.sessions drop constraint sessions_sport_check;
alter table public.sessions add constraint sessions_sport_check
    check (sport in ('running', 'climbing', 'strength', 'other'));

-- 2. The template and its values. NO ACTION (not RESTRICT): deleting a user
-- still cascades through templates and sessions in one statement, while a
-- used template on its own can't be deleted, only archived.
alter table public.sessions
    add column template_id   bigint references public.session_templates (id),
    add column custom_values jsonb  not null default '{}'
        check (jsonb_typeof(custom_values) = 'object'
               and pg_column_size(custom_values) <= 16384);

create index sessions_template_id_idx on public.sessions (template_id);

-- 3. RLS: foreign key checks bypass RLS, so the template must be the caller's own.
drop policy "Users can insert their own sessions" on public.sessions;
create policy "Users can insert their own sessions"
    on public.sessions for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and (template_id is null
             or exists (select 1 from public.session_templates t
                        where t.id = template_id and t.user_id = (select auth.uid()))));

drop policy "Users can update their own sessions" on public.sessions;
create policy "Users can update their own sessions"
    on public.sessions for update to authenticated
    using (user_id = (select auth.uid()))
    with check (
        user_id = (select auth.uid())
        and (template_id is null
             or exists (select 1 from public.session_templates t
                        where t.id = template_id and t.user_id = (select auth.uid()))));

-- sessions has a table-wide insert grant; updates use column grants.
grant update (template_id, custom_values) on public.sessions to authenticated;
