-- Closed beta and usage limits (#129, #130).
--
-- 1. beta_invites: the emails allowed to use the API. Backend only: RLS is on
--    with no policies, and the client roles get no privileges, so the app's
--    users can't read or change it. The backend reads it with its own
--    connection role (the table owner), never as the signed-in user.
--    Add a tester:   insert into public.beta_invites (email) values ('name@example.com');
--    Remove one:     delete from public.beta_invites where email = 'name@example.com';
--    Sign-ups stay off in Supabase Auth: accounts are still created by invite.
-- 2. Indexes so the limit checks before every /chat stay cheap: per user and
--    day (tokens), and for everyone by time (the global budget).

create table public.beta_invites (
    -- Stored lower-case; the backend compares lower-case too.
    email      text        primary key
               check (email = lower(email) and char_length(email) between 3 and 320),
    note       text        check (char_length(note) <= 200),
    created_at timestamptz not null default now()
);

alter table public.beta_invites enable row level security;
-- No policies on purpose: no client access at all.
revoke all on public.beta_invites from anon, authenticated;

-- Everyone who already has an account was invited (sign-ups are off), so they
-- keep working, the owner included, without putting any email in this file.
insert into public.beta_invites (email, note)
select lower(email), 'existing account'
from auth.users
where email is not null
on conflict (email) do nothing;

-- Per-user tokens today: model_calls for one user since a time.
create index if not exists model_calls_user_id_created_at_idx
    on public.model_calls (user_id, created_at);
-- Global budget: every user's model_calls since the start of the day or month.
create index if not exists model_calls_created_at_idx
    on public.model_calls (created_at);
