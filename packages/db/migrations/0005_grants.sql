-- 0005_grants.sql
--
-- Least-privilege grants for the service role benhealth_app (created by
-- scripts/bootstrap-roles.sql, which the migration runner applies before
-- migrations; the role is LOGIN, NOT superuser, NOT BYPASSRLS).
--
-- Deviations from blanket CRUD, by design (documented here, enforced below):
--   * raw_ingest_event      — Layer 1 is immutable: UPDATE limited to
--                             processing metadata columns, no DELETE.
--   * blood_pressure_reading — soft delete only (deleted_at): no hard DELETE.
--   * derived_metric        — history is never destroyed: no DELETE
--                             (supersede via invalidated_at instead).
--   * audit_log             — append-only: INSERT + SELECT only.
--   * schema_migrations     — owned by the migration runner: SELECT only.

grant usage on schema public to benhealth_app;

-- identity & connection state: full CRUD
grant select, insert, update, delete on app_user to benhealth_app;
grant select, insert, update, delete on source_connection to benhealth_app;
grant select, insert, update, delete on oauth_token to benhealth_app;
grant select, insert, update, delete on sync_cursor to benhealth_app;

-- Layer 1: immutable raw ingest
grant select, insert on raw_ingest_event to benhealth_app;
grant update (processing_state, processed_at, error) on raw_ingest_event to benhealth_app;

-- Layer 2: normalized observations
grant select, insert, update, delete on bp_session to benhealth_app;
grant select, insert, update on blood_pressure_reading to benhealth_app;

-- Layer 3: derived analytics
grant select, insert, update on derived_metric to benhealth_app;

-- audit: append-only
grant select, insert on audit_log to benhealth_app;
-- audit_log.id is GENERATED ALWAYS AS IDENTITY — the app needs the sequence.
grant usage, select on all sequences in schema public to benhealth_app;

-- webhook journal: full access, no user scoping (policy grants all rows)
grant select, insert, update, delete on webhook_delivery to benhealth_app;

-- migration bookkeeping: visible, never writable by the service
grant select on schema_migrations to benhealth_app;
