-- #150: anon and authenticated still hold Supabase's default TRUNCATE,
-- REFERENCES and TRIGGER privileges on the tables in public. The app never
-- uses them through these roles, and RLS doesn't apply to TRUNCATE: any SQL
-- run as one of these roles could empty a whole table, everyone's rows
-- included. Least privilege: revoke all three on every table (and view) in
-- public, and keep new tables from getting them. Select, insert, update and
-- delete grants, and RLS, are unchanged.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Tables created later by the role that runs migrations (postgres) start without them.
alter default privileges for role postgres in schema public
    revoke truncate, references, trigger on tables from anon, authenticated;
