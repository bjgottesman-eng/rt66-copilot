-- 0004_rls.sql
--
-- Row-level security. The platform service opens each request's DB work in a
-- transaction that first runs:
--   select set_config('app.user_id', '<uuid>', true);
-- Policies compare user_id against that transaction-local setting. RLS is
-- ENABLED **and** FORCED on every user-data table so even the table owner is
-- subject to policies (superusers always bypass; the service role
-- benhealth_app is NOT a superuser and NOT BYPASSRLS).
--
-- current_setting('app.user_id', true) returns NULL when the setting was
-- never set, but can return '' after a transaction-local set_config expires;
-- ''::uuid raises. NULLIF normalizes both cases to NULL so an unscoped
-- connection deterministically sees zero rows instead of erroring.

create function current_app_user_id() returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- app_user: a user sees only their own identity row (id, not user_id)
-- ---------------------------------------------------------------------------
alter table app_user enable row level security;
alter table app_user force row level security;
create policy app_user_self on app_user
  for all
  using (id = current_app_user_id())
  with check (id = current_app_user_id());

-- ---------------------------------------------------------------------------
-- user-data tables: user_id = app.user_id for select/insert/update/delete
-- ---------------------------------------------------------------------------
alter table source_connection enable row level security;
alter table source_connection force row level security;
create policy source_connection_user_isolation on source_connection
  for all
  using (user_id = current_app_user_id())
  with check (user_id = current_app_user_id());

alter table oauth_token enable row level security;
alter table oauth_token force row level security;
create policy oauth_token_user_isolation on oauth_token
  for all
  using (user_id = current_app_user_id())
  with check (user_id = current_app_user_id());

alter table sync_cursor enable row level security;
alter table sync_cursor force row level security;
create policy sync_cursor_user_isolation on sync_cursor
  for all
  using (user_id = current_app_user_id())
  with check (user_id = current_app_user_id());

alter table raw_ingest_event enable row level security;
alter table raw_ingest_event force row level security;
create policy raw_ingest_event_user_isolation on raw_ingest_event
  for all
  using (user_id = current_app_user_id())
  with check (user_id = current_app_user_id());

alter table bp_session enable row level security;
alter table bp_session force row level security;
create policy bp_session_user_isolation on bp_session
  for all
  using (user_id = current_app_user_id())
  with check (user_id = current_app_user_id());

alter table blood_pressure_reading enable row level security;
alter table blood_pressure_reading force row level security;
create policy blood_pressure_reading_user_isolation on blood_pressure_reading
  for all
  using (user_id = current_app_user_id())
  with check (user_id = current_app_user_id());

alter table derived_metric enable row level security;
alter table derived_metric force row level security;
create policy derived_metric_user_isolation on derived_metric
  for all
  using (user_id = current_app_user_id())
  with check (user_id = current_app_user_id());

-- audit_log: rows written on behalf of a user are visible only in that user's
-- scope. System rows (user_id is null) are admin-only by design.
alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy audit_log_user_isolation on audit_log
  for all
  using (user_id = current_app_user_id())
  with check (user_id is null or user_id = current_app_user_id());

-- ---------------------------------------------------------------------------
-- webhook_delivery: service-internal idempotency journal — no user scoping.
-- RLS is still enabled+forced so access is limited to roles that hold an
-- explicit policy/grant; benhealth_app gets unrestricted rows.
-- ---------------------------------------------------------------------------
alter table webhook_delivery enable row level security;
alter table webhook_delivery force row level security;
create policy webhook_delivery_service_access on webhook_delivery
  for all
  using (true)
  with check (true);
