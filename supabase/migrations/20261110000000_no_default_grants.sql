-- No default privileges for anon and authenticated on new objects in public (#163).
--
-- Production never had these defaults: its tables only ever gave anon and
-- authenticated MAINTAIN by default (removed in 20261125120000_revoke_maintain.sql),
-- and its sequences and functions nothing. A fresh Supabase database (the local
-- one the CI database tests run on) grants them everything instead, which made
-- the migrations' column grants meaningless there. This makes a fresh database
-- match production. It sorts before every other migration, so the tables they
-- create get only the grants they ask for. On production its only effect would
-- be dropping the MAINTAIN default, which 20261125120000 drops anyway.

alter default privileges for role postgres in schema public
    revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
    revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
    revoke all on functions from anon, authenticated;
