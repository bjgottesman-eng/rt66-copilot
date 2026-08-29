-- scripts/bootstrap-roles.sql
--
-- Cluster-level role bootstrap, applied by the migration runner (src/migrate.ts)
-- when the role is missing. NOT a migration: roles are cluster-global while
-- migrations are per-database, so this must stay idempotent and re-runnable.
--
-- benhealth_app is the platform service's role: LOGIN, no superuser, no
-- BYPASSRLS, no CREATEDB/CREATEROLE. Table/sequence grants live in
-- migrations/0005_grants.sql. The password below is a well-known LOCAL DEV
-- value (local clusters use trust auth anyway); production deployments must
-- override it, e.g.:
--   alter role benhealth_app password :'BENHEALTH_APP_PASSWORD';

do $$
begin
  if not exists (select from pg_catalog.pg_roles where rolname = 'benhealth_app') then
    create role benhealth_app
      login
      password 'benhealth_app_dev'
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      nobypassrls;
  end if;
end
$$;
