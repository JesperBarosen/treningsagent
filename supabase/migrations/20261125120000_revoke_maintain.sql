-- #163: anon and authenticated hold MAINTAIN on the tables in public, from
-- production's default privileges. MAINTAIN (Postgres 17) allows VACUUM,
-- ANALYZE, CLUSTER, REINDEX, REFRESH MATERIALIZED VIEW and LOCK TABLE, none of
-- which the app uses through these roles, and RLS doesn't apply to them. Least
-- privilege, like 20261120120000_revoke_truncate_references_trigger.sql: revoke
-- it on every table in public, and keep new tables from getting it.

revoke maintain on all tables in schema public from anon, authenticated;

-- Tables created later by the role that runs migrations (postgres) start without it.
alter default privileges for role postgres in schema public
    revoke maintain on tables from anon, authenticated;
