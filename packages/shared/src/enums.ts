/**
 * Enum vocabularies for Ben Health OS.
 *
 * The string values are NORMATIVE — they mirror the PostgreSQL enum types in
 * docs/contracts/phase1-contracts.md §2 exactly and must never be edited
 * without an ADR + a coordinated DB migration.
 */

export const FRESHNESS_STATUSES = [
  'CURRENT',
  'RECENT',
  'DELAYED_BY_SOURCE',
  'STALE',
  'SYNC_ERROR',
  'NOT_CONNECTED',
  'INSUFFICIENT_DATA',
] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const PROVIDERS = [
  'withings',
  'apple_health',
  'oura',
  'stelo',
  'cronometer',
  'function',
  'clinical_records',
  'manual',
  'benhealth',
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const CONNECTION_STATUSES = [
  'connected',
  'error',
  'revoked',
  'not_connected',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const BP_SOURCES = ['withings_api', 'apple_health', 'manual'] as const;
export type BpSource = (typeof BP_SOURCES)[number];

export const ARMS = ['left', 'right', 'unknown'] as const;
export type Arm = (typeof ARMS)[number];

export const BODY_POSITIONS = ['seated', 'standing', 'lying', 'unknown'] as const;
export type BodyPosition = (typeof BODY_POSITIONS)[number];

export const PROCESSING_STATES = [
  'pending',
  'processed',
  'failed',
  'skipped_duplicate',
] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

/** BP session averaging methods (contracts §2 bp_session.averaging_method). */
export const AVERAGING_METHODS = ['mean_all', 'mean_excluding_first'] as const;
export type AveragingMethod = (typeof AVERAGING_METHODS)[number];
