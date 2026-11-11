-- Individual climbs (boulders, Kilter problems, rope routes) within a climbing
-- session. Grades use the gym's colour scale; grade_ordinal (1 = easiest) is
-- stored next to the colour so progression can be computed with plain SQL.
create table public.climbs (
    id            bigint generated always as identity primary key,
    -- TODO: references auth.users (id) once real login exists.
    user_id       uuid     not null default auth.uid(),
    session_id    bigint   not null references public.sessions (id) on delete cascade,
    grade         text     not null
                  check (grade in ('yellow', 'green', 'blue', 'purple', 'red', 'black', 'white')),
    -- Must match the colour's position in the scale above.
    grade_ordinal smallint not null check (grade_ordinal = array_position(
                      array['yellow', 'green', 'blue', 'purple', 'red', 'black', 'white'], grade)),
    -- Null when the user didn't say.
    attempts      integer  check (attempts >= 1),
    sent          boolean  not null,
    style         text     not null check (style in ('boulder', 'kilter', 'rope')),
    notes         text,
    created_at    timestamptz not null default now()
);

create index climbs_session_id_idx on public.climbs (session_id);
create index climbs_user_id_idx on public.climbs (user_id);

-- Same pattern as sessions: a user only sees and inserts their own rows.
alter table public.climbs enable row level security;

create policy "Users can read their own climbs"
    on public.climbs for select to authenticated
    using (user_id = (select auth.uid()));

-- Foreign key checks bypass RLS, so also require that the session is the
-- caller's own: otherwise a user could attach climbs to someone else's session.
create policy "Users can insert climbs into their own sessions"
    on public.climbs for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and exists (select 1 from public.sessions s
                    where s.id = session_id and s.user_id = (select auth.uid()))
    );

grant select, insert on public.climbs to authenticated;
