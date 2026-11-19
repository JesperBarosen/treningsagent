-- Training profile (#137): what the user tells the app about themselves, one
-- row per user. The coach reads it in every turn's context and propose_program
-- uses it (sessions per week, days, pain); the coach changes it only through
-- a tool whose change the user confirms. Every field is optional: the
-- first-login step can be skipped, and the profile edited in the You tab.
--
-- No existing per-user settings column fits (the app's settings so far live
-- in the browser), so this is a new table. Simple facts are columns; the
-- list of injuries is a small jsonb array checked by the backend
-- (profile.py) and here for shape and size.

create table public.training_profiles (
    user_id            uuid        primary key default auth.uid()
                       references auth.users (id) on delete cascade,
    -- Current form, as the user states it (history may say otherwise).
    longest_run_km     numeric(5, 1) check (longest_run_km > 0 and longest_run_km <= 200),
    weekly_run_km      numeric(5, 1) check (weekly_run_km >= 0 and weekly_run_km <= 500),
    climbing_level     text        check (char_length(climbing_level) <= 60),
    -- [{"body_part": "calf", "pain": 3, "note": "sore after long runs"}], at most 10.
    injuries           jsonb       not null default '[]'
                       check (jsonb_typeof(injuries) = 'array' and jsonb_array_length(injuries) <= 10
                              and pg_column_size(injuries) <= 4096),
    sessions_per_week  smallint    check (sessions_per_week between 1 and 14),
    preferred_days     text[]      not null default '{}'
                       check (preferred_days <@ array['monday', 'tuesday', 'wednesday', 'thursday',
                                                      'friday', 'saturday', 'sunday']::text[]),
    other_sports       text        check (char_length(other_sports) <= 200),
    goals_note         text        check (char_length(goals_note) <= 500),
    -- The first-login step: null until shown, then 'done' or 'skipped'.
    onboarding         text        check (onboarding in ('done', 'skipped')),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

alter table public.training_profiles enable row level security;

create policy "Users can read their own profile"
    on public.training_profiles for select to authenticated
    using (user_id = (select auth.uid()));

create policy "Users can add their own profile"
    on public.training_profiles for insert to authenticated
    with check (user_id = (select auth.uid()));

create policy "Users can change their own profile"
    on public.training_profiles for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

create policy "Users can delete their own profile"
    on public.training_profiles for delete to authenticated
    using (user_id = (select auth.uid()));

-- user_id comes from the default and never changes.
grant select, delete on public.training_profiles to authenticated;
grant insert (longest_run_km, weekly_run_km, climbing_level, injuries, sessions_per_week,
              preferred_days, other_sports, goals_note, onboarding)
    on public.training_profiles to authenticated;
grant update (longest_run_km, weekly_run_km, climbing_level, injuries, sessions_per_week,
              preferred_days, other_sports, goals_note, onboarding, updated_at)
    on public.training_profiles to authenticated;
