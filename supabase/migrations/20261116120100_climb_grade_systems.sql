-- Climbs and grade goals in their own grade system (#98, docs/custom-log-forms.md
-- 3.4-3.6 and 5). Needs 20261116120000_create_gyms.sql.
--
-- Every user with climbs or grade goals gets a gym "My gym" with the seven
-- colours the app had so far, in the same order, with default approximate
-- ranges (backend/grades.py LEGACY_CIRCUIT; tests/test_gyms.py checks they
-- match). Their climbs and goals then point at it, so nothing changes on
-- screen. Runs as one transaction (Supabase applies each migration in one).

-- 1. New columns. grade_system defaults to 'gym', which every existing row is.
alter table public.climbs
    add column grade_system text   not null default 'gym'
        check (grade_system in ('gym', 'v', 'font')),
    add column gym_id       bigint,
    add column gym_grade_id bigint;

alter table public.goals
    add column grade_system text   check (grade_system in ('gym', 'v', 'font')),
    add column gym_id       bigint,
    add column gym_grade_id bigint;

-- 2. "My gym" for every user with climbs or grade goals.
insert into public.gyms (user_id, name, range_system)
select u.user_id, 'My gym', 'v'
from (select user_id from public.climbs
      union
      select user_id from public.goals where kind = 'climb_grade') u;

insert into public.gym_grades (user_id, gym_id, position, name, colour, range_low, range_high)
select g.user_id, g.id, c.position, c.name, c.colour, c.range_low, c.range_high
from public.gyms g
cross join (values
    (1, 'yellow', '#f2c230', -1.0,  0.0),
    (2, 'green',  '#3fae5f',  0.0,  1.0),
    (3, 'blue',   '#2f6fd6',  1.0,  3.0),
    (4, 'purple', '#9440b8',  3.0,  4.0),
    (5, 'red',    '#c0302f',  4.0,  6.0),
    (6, 'black',  '#1a1a1a',  6.0,  8.0),
    (7, 'white',  '#ffffff',  8.0, 10.0)
) as c (position, name, colour, range_low, range_high);

-- 3. Point every climb and grade goal at its colour in "My gym".
update public.climbs c
set grade_system = 'gym', gym_id = g.id, gym_grade_id = gg.id
from public.gyms g
join public.gym_grades gg on gg.gym_id = g.id
where g.user_id = c.user_id and gg.name = c.grade;

update public.goals o
set grade_system = 'gym', gym_id = g.id, gym_grade_id = gg.id
from public.gyms g
join public.gym_grades gg on gg.gym_id = g.id
where o.kind = 'climb_grade' and g.user_id = o.user_id and gg.name = o.grade;

-- 4. Loosen the fixed seven-colour checks; the backend checks grades against
-- the gym's colours or the V/Font lists (grades.py).
alter table public.climbs drop constraint climbs_grade_check;
alter table public.climbs drop constraint climbs_check;
alter table public.climbs alter column grade_ordinal drop not null;
alter table public.goals drop constraint goals_grade_check;

-- 5. The new rules, checked against the rows backfilled above. The foreign keys
-- are NO ACTION (checked at the end of the statement), not RESTRICT, so
-- deleting a user still cascades through gyms and climbs in one go, while a
-- used gym or colour on its own can't be deleted.
alter table public.climbs
    add constraint climbs_grade_text check (char_length(grade) between 1 and 24),
    add constraint climbs_gym_fkey foreign key (gym_id) references public.gyms (id),
    add constraint climbs_gym_grade_fkey
        foreign key (gym_grade_id, gym_id) references public.gym_grades (id, gym_id),
    add constraint climbs_gym_system check ((grade_system = 'gym') = (gym_grade_id is not null));

alter table public.goals
    add constraint goals_grade_text check (grade is null or char_length(grade) between 1 and 24),
    add constraint goals_gym_fkey foreign key (gym_id) references public.gyms (id),
    add constraint goals_gym_grade_fkey
        foreign key (gym_grade_id, gym_id) references public.gym_grades (id, gym_id),
    add constraint goals_grade_system check (
        kind <> 'climb_grade'
        or (grade_system is not null and (grade_system = 'gym') = (gym_grade_id is not null)));

create index climbs_gym_id_idx on public.climbs (gym_id);
create index climbs_gym_grade_id_idx on public.climbs (gym_grade_id);

-- 6. RLS: foreign key checks bypass RLS, so a climb or goal may only point at
-- the caller's own gym (the composite key then ties the colour to that gym).
drop policy "Users can insert climbs into their own sessions" on public.climbs;
create policy "Users can insert climbs into their own sessions"
    on public.climbs for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and exists (select 1 from public.sessions s
                    where s.id = session_id and s.user_id = (select auth.uid()))
        and (gym_id is null
             or exists (select 1 from public.gyms g
                        where g.id = gym_id and g.user_id = (select auth.uid()))));

drop policy "Users can add their own goals" on public.goals;
create policy "Users can add their own goals"
    on public.goals for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and (gym_id is null
             or exists (select 1 from public.gyms g
                        where g.id = gym_id and g.user_id = (select auth.uid()))));

-- climbs already has a table-wide insert grant; goals uses column grants.
grant insert (grade_system, gym_id, gym_grade_id) on public.goals to authenticated;
