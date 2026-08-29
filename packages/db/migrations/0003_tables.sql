-- 0003_tables.sql
--
-- Core Phase 1 tables per docs/contracts/phase1-contracts.md §2.
-- Layers: identity/connections -> Layer 1 raw ingest (immutable) ->
-- Layer 2 normalized observations (BP) -> Layer 3 derived analytics ->
-- audit + webhook journal. All timestamps are timestamptz (UTC storage).

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------------
create table app_user (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- connections & sync state
-- ---------------------------------------------------------------------------
create table source_connection (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references app_user (id) on delete cascade,
  provider                 provider not null,
  status                   connection_status not null default 'not_connected',
  external_user_id         text,
  connected_at             timestamptz,
  last_success_at          timestamptz,
  last_error               text,
  last_error_at            timestamptz,
  expected_latency_seconds int not null default 300,
  metadata                 jsonb not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id, provider)
);

create trigger source_connection_set_updated_at
  before update on source_connection
  for each row execute function set_updated_at();

-- Encrypted OAuth material. *_enc columns hold AES-256-GCM(TOKEN_ENC_KEY)
-- ciphertext laid out as iv || tag || ciphertext. The API layer never
-- serializes these rows; decryption happens only inside connector modules.
create table oauth_token (
  id                uuid primary key default gen_random_uuid(),
  connection_id     uuid not null references source_connection (id) on delete cascade,
  user_id           uuid not null references app_user (id) on delete cascade,
  access_token_enc  bytea not null,
  refresh_token_enc bytea,
  expires_at        timestamptz,
  scopes            text[],
  rotated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index oauth_token_connection_id_idx on oauth_token (connection_id);

create table sync_cursor (
  id            uuid primary key default gen_random_uuid(),
  connection_id uuid not null references source_connection (id) on delete cascade,
  user_id       uuid not null references app_user (id) on delete cascade,
  cursor_type   text not null,  -- e.g. 'withings_lastupdate'
  cursor_value  text not null,
  updated_at    timestamptz not null default now(),
  unique (connection_id, cursor_type)
);

create trigger sync_cursor_set_updated_at
  before update on sync_cursor
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Layer 1: immutable raw ingestion
-- Rows are immutable except processing_state / processed_at / error
-- (enforced by column-limited UPDATE grants in 0005_grants.sql).
-- ---------------------------------------------------------------------------
create table raw_ingest_event (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references app_user (id) on delete cascade,
  connection_id      uuid references source_connection (id) on delete set null,
  connector          provider not null,
  external_id        text,        -- e.g. Withings grpid, HealthKit UUID
  source_device_id   text,
  event_type         text not null,  -- 'withings.getmeas.group' | 'healthkit.bp_correlation' | 'manual.bp' | 'withings.notify'
  payload            jsonb not null,
  payload_hash       text not null,  -- sha256 hex of canonical JSON
  received_at        timestamptz not null default now(),
  source_modified_at timestamptz,
  parser_version     int not null,
  processing_state   processing_state not null default 'pending',
  processed_at       timestamptz,
  error              text,
  -- '' is reserved as the COALESCE sentinel of the dedup index below;
  -- normalization maps empty-string ids to NULL before insert.
  constraint raw_ingest_event_external_id_not_empty
    check (external_id is null or external_id <> '')
);

-- Dedup guard for the contract's unique(connector, external_id, payload_hash).
-- external_id may be NULL (connectors without stable ids, manual entries); a
-- plain UNIQUE constraint treats NULLs as distinct and would admit identical
-- (connector, NULL, payload_hash) rows. Decision: a single COALESCE-based
-- unique expression index (rather than a pair of partial indexes) so one
-- index covers both the NULL and NOT NULL cases; the '' sentinel cannot
-- collide with a real id because of the CHECK constraint above.
create unique index raw_ingest_event_connector_external_id_payload_hash_key
  on raw_ingest_event (connector, coalesce(external_id, ''), payload_hash);

create index raw_ingest_event_user_received_at_idx
  on raw_ingest_event (user_id, received_at desc);

-- Worker queue scan: only pending rows are interesting.
create index raw_ingest_event_pending_idx
  on raw_ingest_event (received_at)
  where processing_state = 'pending';

-- ---------------------------------------------------------------------------
-- Layer 2: normalized observations (Phase 1: blood pressure)
-- ---------------------------------------------------------------------------
create table bp_session (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references app_user (id) on delete cascade,
  started_at              timestamptz not null,
  ended_at                timestamptz,
  reading_count           int not null default 0,
  avg_systolic            numeric(5,1),
  avg_diastolic           numeric(5,1),
  avg_pulse               numeric(5,1),
  averaging_method        text not null default 'mean_all',
  first_reading_excluded  boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint bp_session_averaging_method_check
    check (averaging_method in ('mean_all', 'mean_excluding_first'))
);

create trigger bp_session_set_updated_at
  before update on bp_session
  for each row execute function set_updated_at();

create index bp_session_user_started_at_idx on bp_session (user_id, started_at desc);

create table blood_pressure_reading (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references app_user (id) on delete cascade,
  raw_event_id              uuid references raw_ingest_event (id),
  session_id                uuid references bp_session (id) on delete set null,
  measured_at               timestamptz not null,
  measured_tz               text,  -- IANA tz if known
  systolic_mmhg             numeric(5,1) not null check (systolic_mmhg between 40 and 300),
  diastolic_mmhg            numeric(5,1) not null check (diastolic_mmhg between 20 and 200),
  pulse_bpm                 numeric(5,1) check (pulse_bpm between 20 and 250),
  source                    bp_source not null,
  source_app                text,
  source_device             text,
  external_group_id         text,  -- Withings grpid / HK correlation UUID
  arm                       arm default 'unknown',
  body_position             body_position default 'unknown',
  seated_rest_minutes       numeric(4,1),
  reading_number_in_session int,
  note                      text,
  canonical                 boolean not null default true,
  duplicate_of              uuid references blood_pressure_reading (id),
  dedup_reason              text,
  quality_flags             text[] not null default '{}',  -- e.g. 'implausible_value'
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz  -- soft delete only; no hard DELETE grant
);

create trigger blood_pressure_reading_set_updated_at
  before update on blood_pressure_reading
  for each row execute function set_updated_at();

create index blood_pressure_reading_user_measured_at_idx
  on blood_pressure_reading (user_id, measured_at desc);

create index blood_pressure_reading_session_id_idx
  on blood_pressure_reading (session_id)
  where session_id is not null;

create index blood_pressure_reading_raw_event_id_idx
  on blood_pressure_reading (raw_event_id)
  where raw_event_id is not null;

-- Cross-source dedup lookups by group id (Withings grpid / HK correlation).
create index blood_pressure_reading_external_group_id_idx
  on blood_pressure_reading (user_id, external_group_id)
  where external_group_id is not null;

-- ---------------------------------------------------------------------------
-- Layer 3: derived analytics (never silently overwritten; new algorithm
-- versions write new rows, old rows get invalidated_at)
-- ---------------------------------------------------------------------------
create table derived_metric (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references app_user (id) on delete cascade,
  algorithm         text not null,
  algorithm_version int not null,
  metric_key        text not null,  -- e.g. 'bp.7d_avg_systolic'
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  value             jsonb not null,
  unit              text,
  confidence        text,  -- 'high' | 'medium' | 'low'
  coverage          numeric(4,3),  -- 0..1 completeness
  input_ids         uuid[] not null default '{}',
  computed_at       timestamptz not null default now(),
  invalidated_at    timestamptz,
  constraint derived_metric_confidence_check
    check (confidence is null or confidence in ('high', 'medium', 'low')),
  constraint derived_metric_coverage_check
    check (coverage is null or (coverage >= 0 and coverage <= 1))
);

create index derived_metric_user_key_period_idx
  on derived_metric (user_id, metric_key, period_end desc);

-- ---------------------------------------------------------------------------
-- audit (details MUST be pre-redacted; no tokens or health values)
-- ---------------------------------------------------------------------------
create table audit_log (
  id        bigint primary key generated always as identity,
  user_id   uuid,  -- intentionally no FK: audit rows survive explicit user deletion
  actor     text not null,
  action    text not null,
  entity    text,
  entity_id text,
  at        timestamptz not null default now(),
  details   jsonb not null default '{}'
);

create index audit_log_user_at_idx on audit_log (user_id, at desc);

-- ---------------------------------------------------------------------------
-- webhook journal (idempotency; service-internal, no user scoping)
-- ---------------------------------------------------------------------------
create table webhook_delivery (
  id            uuid primary key default gen_random_uuid(),
  provider      provider not null,
  delivery_hash text not null,
  received_at   timestamptz not null default now(),
  status        text not null,  -- 'accepted' | 'duplicate' | 'failed'
  unique (provider, delivery_hash),
  constraint webhook_delivery_status_check
    check (status in ('accepted', 'duplicate', 'failed'))
);
