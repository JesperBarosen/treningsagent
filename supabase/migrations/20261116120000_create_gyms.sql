-- Gyms and their colour circuits (#98, docs/custom-log-forms.md 3.4).
-- A gym has an ordered list of colours, easiest first. Each colour may have an
-- approximate range, stored as difficulty-index values (V-scale numbers:
-- VB = -1, V0 = 0 ... V17 = 17; Font maps onto them, see backend/grades.py).
-- Used gyms and colours are archived, never deleted: climbs.gym_id and
-- climbs.gym_grade_id (next migration) restrict deletes.

create table public.gyms (
    id           bigint generated always as identity primary key,
    user_id      uuid        not null default auth.uid()
                 references auth.users (id) on delete cascade,
    name         text        not null check (char_length(name) between 1 and 60),
    -- Which system the ranges are entered and shown in; display only.
    range_system text        not null default 'v' check (range_system in ('v', 'font')),
    archived_at  timestamptz,
    created_at   timestamptz not null default now()
);

create index gyms_user_id_idx on public.gyms (user_id);

create table public.gym_grades (
    id           bigint generated always as identity primary key,
    user_id      uuid        not null default auth.uid()
                 references auth.users (id) on delete cascade,
    gym_id       bigint      not null references public.gyms (id) on delete cascade,
    position     smallint    not null check (position >= 1),   -- 1 = easiest
    name         text        not null check (char_length(name) between 1 and 24),
    colour       text        not null check (colour ~ '^#[0-9a-f]{6}$'),
    -- Approximate range as index values; both null = unknown.
    range_low    numeric(3, 1),
    range_high   numeric(3, 1),
    archived_at  timestamptz,
    created_at   timestamptz not null default now(),
    -- So climbs can reference (gym_grade_id, gym_id) and the colour must be that gym's.
    unique (id, gym_id),
    constraint gym_grades_range check (
        (range_low is null) = (range_high is null)
        and (range_low is null or range_low <= range_high))
);

-- One colour per place on the wall among the colours in use. Reordering moves
-- the positions out of the way first (backend db.PostgresStore.update_gym).
create unique index gym_grades_position_idx
    on public.gym_grades (gym_id, position) where archived_at is null;
create index gym_grades_user_id_idx on public.gym_grades (user_id);

-- Row Level Security: owner only, as for every other table.
alter table public.gyms enable row level security;
alter table public.gym_grades enable row level security;

create policy "Users can read their own gyms"
    on public.gyms for select to authenticated
    using (user_id = (select auth.uid()));
create policy "Users can add their own gyms"
    on public.gyms for insert to authenticated
    with check (user_id = (select auth.uid()));
create policy "Users can change their own gyms"
    on public.gyms for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));
create policy "Users can delete their own gyms"
    on public.gyms for delete to authenticated
    using (user_id = (select auth.uid()));

-- Foreign key checks bypass RLS, so the gym must also be the caller's own:
-- otherwise a user could add colours to someone else's gym.
create policy "Users can read their own gym colours"
    on public.gym_grades for select to authenticated
    using (user_id = (select auth.uid()));
create policy "Users can add colours to their own gyms"
    on public.gym_grades for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and exists (select 1 from public.gyms g
                    where g.id = gym_id and g.user_id = (select auth.uid())));
create policy "Users can change colours of their own gyms"
    on public.gym_grades for update to authenticated
    using (user_id = (select auth.uid()))
    with check (
        user_id = (select auth.uid())
        and exists (select 1 from public.gyms g
                    where g.id = gym_id and g.user_id = (select auth.uid())));
create policy "Users can delete their own gym colours"
    on public.gym_grades for delete to authenticated
    using (user_id = (select auth.uid()));

-- user_id comes from the default. A colour can't move to another gym.
grant select, delete on public.gyms, public.gym_grades to authenticated;
grant insert (name, range_system) on public.gyms to authenticated;
grant update (name, range_system, archived_at) on public.gyms to authenticated;
grant insert (gym_id, position, name, colour, range_low, range_high, archived_at)
    on public.gym_grades to authenticated;
grant update (position, name, colour, range_low, range_high, archived_at)
    on public.gym_grades to authenticated;
