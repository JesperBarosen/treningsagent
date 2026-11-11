-- Training sessions. Only raw, user-reported facts are stored; load and pace
-- are computed when history is read.
create table public.sessions (
    id             bigint generated always as identity primary key,
    -- Owner. Defaults to the caller's id from the JWT, so code never sets it.
    -- TODO: references auth.users (id) once real login exists.
    user_id        uuid        not null default auth.uid(),
    sport          text        not null check (sport in ('running', 'climbing')),
    date           date        not null,
    duration_min   integer     not null check (duration_min > 0),
    effort         integer     not null check (effort between 1 and 10),
    notes          text,
    -- running only
    distance_km    double precision check (distance_km > 0),
    elevation_m    integer     check (elevation_m >= 0),
    -- climbing only
    climbing_style text        check (climbing_style in ('boulder', 'lead', 'top_rope')),
    hardest_grade  text,
    routes_count   integer     check (routes_count >= 0),
    created_at     timestamptz not null default now()
);

create index sessions_user_id_date_idx on public.sessions (user_id, date);

-- Row Level Security: a user only sees and inserts their own rows.
-- Note: the postgres/service_role roles bypass RLS. The backend therefore runs
-- its queries as the `authenticated` role with the user's id in the JWT claims.
alter table public.sessions enable row level security;

create policy "Users can read their own sessions"
    on public.sessions for select to authenticated
    using (user_id = (select auth.uid()));

create policy "Users can insert their own sessions"
    on public.sessions for insert to authenticated
    with check (user_id = (select auth.uid()));

-- The agent only reads and adds sessions; no update or delete.
grant select, insert on public.sessions to authenticated;
