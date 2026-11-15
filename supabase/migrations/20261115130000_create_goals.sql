-- Outcome goals (docs/design-proposals-2.md, N2): something the user wants to
-- reach by a date, with progress computed from their sessions. Two kinds:
--   climb_grade: send (or flash) a grade, e.g. "send a red by 1 Mar";
--   run_pace:    run a distance band at a target pace, e.g. "7-15 km at 5:00 /km".
-- A goal is never "failed": it is active, paused, achieved or let go.
create table public.goals (
    id            bigint generated always as identity primary key,
    user_id       uuid        not null default auth.uid()
                  references auth.users (id) on delete cascade,
    kind          text        not null check (kind in ('climb_grade', 'run_pace')),
    -- climb_grade
    grade         text        check (grade in ('yellow', 'green', 'blue', 'purple', 'red', 'black', 'white')),
    climb_mode    text        check (climb_mode in ('send', 'flash')),
    -- run_pace (min per km); start_pace is the recent pace in the band when the
    -- goal was set, so progress can be shown from where the user started.
    band          text        check (band in ('under_7km', '7_to_15km', 'over_15km')),
    target_pace   numeric(4, 2) check (target_pace > 0),
    start_pace    numeric(4, 2) check (start_pace > 0),
    target_date   date,
    status        text        not null default 'active'
                  check (status in ('active', 'paused', 'achieved', 'dropped')),
    achieved_on   date,
    created_on    date        not null default current_date,
    created_at    timestamptz not null default now(),
    constraint goals_climb_fields check (
        kind <> 'climb_grade' or (grade is not null and climb_mode is not null
                                  and band is null and target_pace is null)),
    constraint goals_run_fields check (
        kind <> 'run_pace' or (band is not null and target_pace is not null
                               and grade is null and climb_mode is null)),
    constraint goals_achieved_on check ((status = 'achieved') = (achieved_on is not null))
);

create index goals_user_id_idx on public.goals (user_id);

alter table public.goals enable row level security;

create policy "Users can read their own goals"
    on public.goals for select to authenticated
    using (user_id = (select auth.uid()));

create policy "Users can add their own goals"
    on public.goals for insert to authenticated
    with check (user_id = (select auth.uid()));

create policy "Users can change their own goals"
    on public.goals for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

create policy "Users can delete their own goals"
    on public.goals for delete to authenticated
    using (user_id = (select auth.uid()));

-- user_id comes from the default; the kind and its target can't be changed
-- after creation (make a new goal instead), only the date and the status.
grant select, delete on public.goals to authenticated;
grant insert (kind, grade, climb_mode, band, target_pace, start_pace, target_date, created_on)
    on public.goals to authenticated;
grant update (target_date, status, achieved_on) on public.goals to authenticated;
