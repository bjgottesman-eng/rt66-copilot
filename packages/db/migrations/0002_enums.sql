-- 0002_enums.sql
--
-- Enum vocabularies. Values are NORMATIVE per docs/contracts/phase1-contracts.md §2
-- and are mirrored in @benhealth/shared src/enums.ts. Never rename values;
-- additive changes go through a new migration + ADR.

create type provider as enum (
  'withings',
  'apple_health',
  'oura',
  'stelo',
  'cronometer',
  'function',
  'clinical_records',
  'manual',
  'benhealth'
);

create type connection_status as enum (
  'connected',
  'error',
  'revoked',
  'not_connected'
);

create type freshness_status as enum (
  'CURRENT',
  'RECENT',
  'DELAYED_BY_SOURCE',
  'STALE',
  'SYNC_ERROR',
  'NOT_CONNECTED',
  'INSUFFICIENT_DATA'
);

create type processing_state as enum (
  'pending',
  'processed',
  'failed',
  'skipped_duplicate'
);

create type bp_source as enum (
  'withings_api',
  'apple_health',
  'manual'
);

create type arm as enum (
  'left',
  'right',
  'unknown'
);

create type body_position as enum (
  'seated',
  'standing',
  'lying',
  'unknown'
);
