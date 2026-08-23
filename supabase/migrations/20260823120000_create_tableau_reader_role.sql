-- Read-only Postgres role for external BI tools (Tableau).
--
-- Tableau connects with this role's own username/password instead of the
-- project's master database credentials, using Supabase's native
-- PostgreSQL connector (Session Pooler or direct connection).
--
-- The password is NOT set here — never commit credentials to a migration.
-- Set or rotate it from the Supabase SQL editor or dashboard:
--   alter role tableau_reader with password '<strong-generated-password>';

create role tableau_reader with login;

-- Cap how long a single Tableau query may run, so a heavy report can't
-- lock up the database.
alter role tableau_reader set statement_timeout = '30s';

grant usage on schema public to tableau_reader;
grant select on all tables in schema public to tableau_reader;

-- Also grant SELECT on tables created after this migration runs.
alter default privileges in schema public
  grant select on tables to tableau_reader;
