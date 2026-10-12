-- Ben Health OS — core schema (Layer 1 raw ingestion, Layer 2 normalized records, Layer 3 analytics)
-- Conventions: every user-owned table has user_id uuid referencing auth.users(id); RLS is enabled in
-- 20261012000300_rls.sql. Timestamps are timestamptz; original zone offsets are kept alongside.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'Ben',
  time_zone text not null default 'America/New_York',
  demo_mode boolean not null default false,
  -- Explicit AI data-sharing controls (spec §32). excluded_connectors defaults to ['oura'] because the
  -- Oura API Agreement (June 2026) restricts feeding API data to AI models; see docs/integrations.md.
  ai_sharing jsonb not null default '{"enabled": false, "excludedConnectors": ["oura"]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Source connections, devices, cursors, sync runs
-- ---------------------------------------------------------------------------------------------
create table if not exists public.source_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector text not null,
  status text not null default 'NOT_CONFIGURED'
    check (status in ('NOT_CONFIGURED','PENDING_AUTH','CONNECTED','PARTIAL','EXPIRED','REVOKED','ERROR','DISCONNECTED','UNSUPPORTED')),
  external_user_id text,
  scopes text[] not null default '{}',
  -- OAuth material is encrypted server-side (AES-256-GCM with TOKEN_ENCRYPTION_KEY) before storage.
  access_token_ciphertext bytea,
  refresh_token_ciphertext bytea,
  token_expires_at timestamptz,
  last_sync_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  last_sync_status text not null default 'NEVER' check (last_sync_status in ('NEVER','RUNNING','SUCCESS','PARTIAL','ERROR')),
  last_error text,
  granted_permissions text[] not null default '{}',
  requested_permissions text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, connector)
);
create trigger source_connections_updated_at before update on public.source_connections for each row execute function public.set_updated_at();

create table if not exists public.source_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.source_connections(id) on delete set null,
  connector text not null,
  external_device_id text not null,
  label text not null,
  manufacturer text,
  model text,
  device_type text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, connector, external_device_id)
);

create table if not exists public.sync_cursors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.source_connections(id) on delete cascade,
  scope text not null,              -- e.g. 'health_connect:<deviceInstanceId>:Steps' or 'withings:getmeas:lastupdate'
  cursor text,
  cursor_time timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, scope)
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.source_connections(id) on delete set null,
  connector text not null,
  mode text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCESS','PARTIAL','ERROR')),
  records_received integer not null default 0,
  inserted integer not null default 0,
  updated integer not null default 0,
  unchanged_duplicates integer not null default 0,
  cross_source_duplicates integer not null default 0,
  deleted integer not null default 0,
  rejected integer not null default 0,
  error text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists sync_runs_user_started_idx on public.sync_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------------------------
-- Layer 1 — immutable raw ingestion events
-- ---------------------------------------------------------------------------------------------
create table if not exists public.raw_ingest_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector text not null,
  external_id text not null,          -- Health Connect record UID, Withings grpid, Oura document id, file row key...
  source_user_id text,
  device_id uuid references public.source_devices(id) on delete set null,
  record_type text not null,
  original_time timestamptz not null,
  original_end_time timestamptz,
  original_zone_offset text,
  source_modified_at timestamptz,
  ingested_at timestamptz not null default now(),
  payload jsonb not null,
  payload_hash text not null,         -- sha256 of canonical JSON payload
  parser_version integer not null default 1,
  processing_status text not null default 'RECEIVED' check (processing_status in ('RECEIVED','NORMALIZED','REJECTED','DELETED','SUPERSEDED')),
  processing_error text,
  sync_run_id uuid references public.sync_runs(id) on delete set null,
  superseded_by uuid references public.raw_ingest_events(id) on delete set null,
  -- Raw events are immutable: a changed payload for the same external id creates a new row.
  unique (user_id, connector, external_id, payload_hash)
);
create index if not exists raw_ingest_events_lookup_idx on public.raw_ingest_events (user_id, connector, external_id);
create index if not exists raw_ingest_events_time_idx on public.raw_ingest_events (user_id, original_time desc);

-- ---------------------------------------------------------------------------------------------
-- Layer 2 — normalized records
-- ---------------------------------------------------------------------------------------------
-- Universal numeric store: one row per metric value. Typed tables below carry structure that does
-- not fit a single number (sleep stages, workout segments, meals, BP sessions) and link via group_id.
create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_id text not null,
  value double precision not null,
  unit text not null,
  measured_at timestamptz not null,
  start_at timestamptz,
  end_at timestamptz,
  local_date date not null,
  zone_offset text,
  connector text not null,
  data_origin text,
  device_id uuid references public.source_devices(id) on delete set null,
  external_id text not null,
  raw_event_id uuid references public.raw_ingest_events(id) on delete set null,
  group_id uuid,
  recording_method text not null default 'UNKNOWN',
  canonical boolean not null default true,
  duplicate_of uuid references public.observations(id) on delete set null,
  duplicate_reason text,
  quality_flags text[] not null default '{}',
  source_modified_at timestamptz,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, connector, external_id, metric_id)
);
create index if not exists observations_metric_time_idx on public.observations (user_id, metric_id, measured_at desc) where deleted_at is null;
create index if not exists observations_local_date_idx on public.observations (user_id, metric_id, local_date) where deleted_at is null and canonical;
create index if not exists observations_group_idx on public.observations (group_id) where group_id is not null;
create trigger observations_updated_at before update on public.observations for each row execute function public.set_updated_at();

create table if not exists public.blood_pressure_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  arm text not null default 'UNKNOWN',
  posture text not null default 'UNKNOWN',
  notes text,
  averaging_rule text not null default 'MEAN_OF_ALL',
  created_at timestamptz not null default now()
);

create table if not exists public.blood_pressure_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.blood_pressure_sessions(id) on delete set null,
  measured_at timestamptz not null,
  local_date date not null,
  zone_offset text,
  systolic double precision not null,
  diastolic double precision not null,
  pulse double precision,
  arm text not null default 'UNKNOWN',
  posture text not null default 'UNKNOWN',
  seated_rest_minutes integer,
  notes text,
  connector text not null,
  data_origin text,
  device_id uuid references public.source_devices(id) on delete set null,
  external_id text not null,
  raw_event_id uuid references public.raw_ingest_events(id) on delete set null,
  recording_method text not null default 'UNKNOWN',
  source_attrib text,                  -- Withings attrib code, HC recording method, etc.
  canonical boolean not null default true,
  duplicate_of uuid references public.blood_pressure_readings(id) on delete set null,
  duplicate_reason text,
  quality_flags text[] not null default '{}',
  ingested_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, connector, external_id)
);
create index if not exists bp_readings_time_idx on public.blood_pressure_readings (user_id, measured_at desc) where deleted_at is null;

create table if not exists public.sleep_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  start_zone_offset text,
  end_zone_offset text,
  local_date date not null,            -- the local calendar date the sleep ENDED (night-of date)
  duration_min double precision not null,
  time_in_bed_min double precision,
  efficiency double precision,
  deep_min double precision,
  light_min double precision,
  rem_min double precision,
  awake_min double precision,
  title text,
  notes text,
  connector text not null,
  data_origin text,
  device_id uuid references public.source_devices(id) on delete set null,
  external_id text not null,
  raw_event_id uuid references public.raw_ingest_events(id) on delete set null,
  recording_method text not null default 'UNKNOWN',
  canonical boolean not null default true,
  duplicate_of uuid references public.sleep_sessions(id) on delete set null,
  duplicate_reason text,
  quality_flags text[] not null default '{}',
  ingested_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, connector, external_id)
);
create index if not exists sleep_sessions_time_idx on public.sleep_sessions (user_id, end_at desc) where deleted_at is null;

create table if not exists public.sleep_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sleep_sessions(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  stage text not null                  -- UNKNOWN|AWAKE|SLEEPING|OUT_OF_BED|LIGHT|DEEP|REM|AWAKE_IN_BED
);
create index if not exists sleep_stages_session_idx on public.sleep_stages (session_id, start_at);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  local_date date not null,
  duration_min double precision not null,
  exercise_type integer,
  exercise_type_name text,
  category text not null default 'OTHER',   -- CARDIO|RESISTANCE|MOBILITY|SPORT|OTHER
  title text,
  notes text,
  calories_kcal double precision,
  distance_m double precision,
  avg_heart_rate double precision,
  segments jsonb,
  connector text not null,
  data_origin text,
  device_id uuid references public.source_devices(id) on delete set null,
  external_id text not null,
  raw_event_id uuid references public.raw_ingest_events(id) on delete set null,
  recording_method text not null default 'UNKNOWN',
  canonical boolean not null default true,
  duplicate_of uuid references public.workouts(id) on delete set null,
  duplicate_reason text,
  quality_flags text[] not null default '{}',
  ingested_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, connector, external_id)
);
create index if not exists workouts_time_idx on public.workouts (user_id, start_at desc) where deleted_at is null;

create table if not exists public.daily_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  steps double precision,
  steps_source text,                   -- 'health_connect:com.sec.android.app.shealth' etc. (never a sum across origins)
  distance_m double precision,
  active_calories double precision,
  exercise_minutes double precision,
  resistance_sessions integer,
  contributing_origins jsonb not null default '[]'::jsonb,
  algorithm_version integer not null default 1,
  computed_at timestamptz not null default now(),
  unique (user_id, local_date)
);

create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eaten_at timestamptz not null,
  end_at timestamptz,
  local_date date not null,
  meal_type text,
  name text,
  energy_kcal double precision,
  protein_g double precision,
  carbs_g double precision,
  fat_g double precision,
  saturated_fat_g double precision,
  fiber_g double precision,
  sodium_mg double precision,
  potassium_mg double precision,
  sugar_g double precision,
  nutrients jsonb not null default '{}'::jsonb,
  food_items jsonb not null default '[]'::jsonb,
  connector text not null,
  data_origin text,
  external_id text not null,
  raw_event_id uuid references public.raw_ingest_events(id) on delete set null,
  canonical boolean not null default true,
  duplicate_of uuid references public.meals(id) on delete set null,
  duplicate_reason text,
  quality_flags text[] not null default '{}',
  ingested_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, connector, external_id)
);
create index if not exists meals_time_idx on public.meals (user_id, eaten_at desc) where deleted_at is null;

create table if not exists public.nutrient_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_id uuid references public.meals(id) on delete cascade,
  local_date date not null,
  nutrient text not null,
  value double precision not null,
  unit text not null
);
create index if not exists nutrient_obs_idx on public.nutrient_observations (user_id, nutrient, local_date);

create table if not exists public.nutrition_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  energy_kcal double precision,
  protein_g double precision,
  carbs_g double precision,
  fat_g double precision,
  saturated_fat_g double precision,
  fiber_g double precision,
  sodium_mg double precision,
  potassium_mg double precision,
  meals_count integer not null default 0,
  source text,
  complete boolean not null default false,
  algorithm_version integer not null default 1,
  computed_at timestamptz not null default now(),
  unique (user_id, local_date)
);

create table if not exists public.glucose_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_at timestamptz not null,
  local_date date not null,
  mg_dl double precision not null,
  specimen_source text,
  meal_relation text,
  connector text not null,
  data_origin text,
  device_id uuid references public.source_devices(id) on delete set null,
  external_id text not null,
  raw_event_id uuid references public.raw_ingest_events(id) on delete set null,
  canonical boolean not null default true,
  duplicate_of uuid references public.glucose_samples(id) on delete set null,
  duplicate_reason text,
  quality_flags text[] not null default '{}',
  ingested_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, connector, external_id)
);
create index if not exists glucose_time_idx on public.glucose_samples (user_id, measured_at desc) where deleted_at is null;

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                  -- MEAL|EXERCISE|NOTE|MEDICATION_TAKEN|TAG
  at timestamptz not null,
  end_at timestamptz,
  local_date date not null,
  label text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Body measurements are observations with body metric ids; this view keeps the spec entity name.
create or replace view public.body_measurements as
  select * from public.observations
  where metric_id in ('weight','body_fat_pct','waist_cm','lean_mass_kg','height_m') and deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Layer 3 — analytics (versioned, never overwritten)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.algorithm_versions (
  algorithm text not null,
  version integer not null,
  description text not null,
  created_at timestamptz not null default now(),
  primary key (algorithm, version)
);

create table if not exists public.derived_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_id text not null,
  algorithm text not null,
  algorithm_version integer not null,
  window_from date not null,
  window_to date not null,
  computed_at timestamptz not null default now(),
  coverage double precision,
  observation_count integer not null default 0,
  value double precision,
  unit text,
  result jsonb not null default '{}'::jsonb,
  confidence text not null default 'LOW' check (confidence in ('LOW','MEDIUM','HIGH')),
  quality_flags text[] not null default '{}',
  input_refs jsonb not null default '[]'::jsonb,
  foreign key (algorithm, algorithm_version) references public.algorithm_versions(algorithm, version),
  unique (user_id, metric_id, algorithm, algorithm_version, window_from, window_to)
);
create index if not exists derived_metrics_lookup_idx on public.derived_metrics (user_id, metric_id, algorithm, window_to desc);

insert into public.algorithm_versions (algorithm, version, description) values
  ('window_stats', 1, 'Mean/median/SD/min/max/slope over local-day aggregates with coverage'),
  ('baseline_7_vs_28', 1, 'Latest 7 complete local days vs preceding non-overlapping 28 days; change classification'),
  ('freshness', 1, 'Freshness status from measured-at age, sync health and shared thresholds'),
  ('daily_activity', 1, 'Per-day steps/distance/exercise from the highest-priority origin, never summed across origins'),
  ('cross_source_dedup', 1, 'Exact id, payload hash, then conservative value+time window matching with source priority')
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- Operational tables
-- ---------------------------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  connector text not null,
  dedupe_key text not null,
  received_at timestamptz not null default now(),
  headers jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  signature_valid boolean,
  user_id uuid references auth.users(id) on delete set null,
  processing_status text not null default 'RECEIVED' check (processing_status in ('RECEIVED','PROCESSED','IGNORED','ERROR')),
  processed_at timestamptz,
  attempts integer not null default 0,
  error text,
  unique (connector, dedupe_key)
);

create table if not exists public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  connector text not null,
  code_verifier text,
  redirect_uri text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  actor text not null,                 -- 'user' | 'system' | 'webhook:<connector>'
  action text not null,                -- EXPORT_ALL | DELETE_ALL | TOKEN_REFRESH | SOURCE_DISCONNECT | ...
  entity text,
  entity_id text,
  at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_user_idx on public.audit_log (user_id, at desc);
