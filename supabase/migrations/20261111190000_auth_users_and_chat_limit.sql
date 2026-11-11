-- Real login: every row's owner must be a Supabase Auth user, and deleting
-- a user deletes their data.
--
-- Rows whose user_id isn't in auth.users (such as the old fixed test user
-- 00000000-0000-0000-0000-000000000001) make this migration fail. Move or
-- delete them first (see the PR / README).

alter table public.sessions
    add constraint sessions_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.climbs
    add constraint climbs_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.model_calls
    add constraint model_calls_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade;

-- One row per /chat request, for the per-user daily limit (api.CHAT_DAILY_LIMIT).
create table public.chat_requests (
    id         bigint generated always as identity primary key,
    user_id    uuid        not null default auth.uid()
               references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

create index chat_requests_user_id_created_at_idx
    on public.chat_requests (user_id, created_at);

alter table public.chat_requests enable row level security;

create policy "Users can read their own chat requests"
    on public.chat_requests for select to authenticated
    using (user_id = (select auth.uid()));

create policy "Users can insert their own chat requests"
    on public.chat_requests for insert to authenticated
    with check (user_id = (select auth.uid()));

grant select, insert on public.chat_requests to authenticated;
