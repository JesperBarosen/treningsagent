-- Session templates (#100, docs/custom-log-forms.md 3.2): a named log form for
-- one sport, with a typed field schema in jsonb. The backend (forms.py) checks
-- the schema; the database checks its shape and size. A template that
-- sessions use is archived, never deleted (sessions.template_id, next
-- migration, refuses the delete).

create table public.session_templates (
    id           bigint generated always as identity primary key,
    user_id      uuid        not null default auth.uid()
                 references auth.users (id) on delete cascade,
    name         text        not null check (char_length(name) between 1 and 40),
    -- The four built-in sports; the next migration adds strength and other to sessions.
    sport        text        not null check (sport in ('running', 'climbing', 'strength', 'other')),
    -- Optional built-in fields the form shows (running: distance_km, elevation_m).
    core_fields  text[]      not null default '{}'
                 check (core_fields <@ array['distance_km', 'elevation_m']::text[]),
    fields       jsonb       not null default '[]'
                 check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 20
                        and pg_column_size(fields) <= 32768),
    position     smallint    not null default 0,
    archived_at  timestamptz,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index session_templates_user_id_idx on public.session_templates (user_id);
-- One live template per name and user.
create unique index session_templates_user_name_idx
    on public.session_templates (user_id, lower(name)) where archived_at is null;

alter table public.session_templates enable row level security;

create policy "Users can read their own templates"
    on public.session_templates for select to authenticated
    using (user_id = (select auth.uid()));
create policy "Users can add their own templates"
    on public.session_templates for insert to authenticated
    with check (user_id = (select auth.uid()));
create policy "Users can change their own templates"
    on public.session_templates for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));
create policy "Users can delete their own templates"
    on public.session_templates for delete to authenticated
    using (user_id = (select auth.uid()));

-- user_id comes from the default.
grant select, delete on public.session_templates to authenticated;
grant insert (name, sport, core_fields, fields, position)
    on public.session_templates to authenticated;
grant update (name, sport, core_fields, fields, position, archived_at, updated_at)
    on public.session_templates to authenticated;
