# Data model

Three layers (spec §12), all in Postgres with row-level security per user.

## Layer 1 — raw ingestion (`raw_ingest_events`)
Immutable. One row per (connector, external id, payload hash). Fields: connector, external_id,
source_user_id, device_id, record_type, original_time/end_time, original_zone_offset,
source_modified_at, ingested_at, payload (jsonb), payload_hash (sha256 of canonical JSON),
parser_version, processing_status (RECEIVED, NORMALIZED, REJECTED, DELETED, SUPERSEDED),
processing_error, sync_run_id, superseded_by. A changed payload for the same id creates a new row
and marks the old one SUPERSEDED.

## Layer 2 — normalized records
- `observations` — the universal numeric store: metric_id (catalog), value, unit (canonical),
  measured_at, start/end, local_date, zone_offset, connector, data_origin (Android package or
  API), device_id, external_id, raw_event_id, group_id (links the systolic/diastolic/pulse of one
  reading, the observations of one sleep session, etc.), recording_method, canonical,
  duplicate_of, duplicate_reason, quality_flags, source_modified_at, ingested_at, deleted_at.
  Unique on (user, connector, external_id, metric_id).
- Typed tables carrying structure: `blood_pressure_readings` (+ `blood_pressure_sessions`),
  `sleep_sessions` (+ `sleep_stages`), `workouts`, `meals` (+ `nutrient_observations`),
  `glucose_samples`, `annotations`; `body_measurements` is a view over observations.
- Derived-per-day tables: `daily_activity` (steps from the highest-priority origin with the
  alternates recorded, distance, active calories, exercise minutes, resistance sessions) and
  `nutrition_days`.
- **Nutrition and glucose (Phase 4).** `meals` carry `food_items`, `quality_flags`
  (`DAY_MARKED_COMPLETE`, `MEAL_TIME_ASSUMED`) and the usual `canonical`/`duplicate_of`/
  `duplicate_reason`. Nutrition is deduplicated per local day: the highest-priority source for that day
  (`cronometer` CSV > Cronometer via Health Connect > other Health Connect apps > manual) is canonical,
  the rest are linked (`SAME_DAY_NUTRITION_SOURCE:*`), and a daily-summary row from the same source as
  itemised meals is linked as `DAILY_SUMMARY_OF_ITEMISED_MEALS`; observations mirror the meal's
  canonical flag through `group_id`. `nutrition_days` (algorithm_version 1) sums canonical meals per
  day and is absent when nothing was logged. CSV meals use stable external ids
  (`cronometer-csv:<day>:<group>` / `cronometer-csv:day:<day>`) so a newer export supersedes changed
  days only; the file hash is kept in `sync_runs.details` and `sync_cursors`. `profiles.glucose_range`
  and `profiles.nutrition_targets` are user/clinician-set JSON (defaults are labelled placeholders).
  `annotations` (MEAL/EXERCISE/NOTE/MEDICATION_TAKEN/TAG) are user markers that feed the glucose day
  view; glucose statistics are computed on request from canonical `glucose_samples` excluding
  `IMPLAUSIBLE_VALUE`/`FUTURE_TIMESTAMP` rows (algorithms `glucose_day` v1, `meal_excursion` v1).
- Sources: `source_connections` (status, encrypted tokens, permissions, sync health),
  `source_devices`, `sync_cursors` (change tokens / lastupdate), `sync_runs`.
- Clinical and intelligence entities (schema in place, features in later phases): `documents`,
  `lab_panels`, `lab_results` (analyte, LOINC, value, unit, canonical value/unit, reference range,
  abnormal flag, collection/result dates, laboratory, provider, method, extraction confidence,
  verification status), `conditions`, `clinical_events`, `medications`,
  `medication_source_records`, `medication_reconciliations`, `supplements`, `symptoms`,
  `journal_entries`, `health_goals`, `health_experiments`, `experiment_phases`,
  `recommendations`, `recommendation_evidence`, `alerts`, `preventive_care_items`,
  `weekly_health_reports`, `monthly_health_reports`, `physician_briefs`, `health_memories`.
- Operational: `webhook_events` (replay-safe by (connector, dedupe_key)), `oauth_states`,
  `audit_log` (append-only, service-written), `schema_migrations`.

## Layer 3 — analytics (`derived_metrics`, `signals`, `algorithm_versions`)
`signals` holds the deterministic signal engine output per as-of day (kind, direction, priority,
delta, effect size, explanation, evidence jsonb, algorithm version); unique per (user, day, metric,
kind, version). Phase 3 persists window stats, baselines and Zone 2 minutes (see architecture.md).

Each derived value stores algorithm, version, window, computed_at, coverage, observation count,
value/unit, result jsonb, confidence, quality flags and input references. Unique per
(user, metric, algorithm, version, window), so recomputation under a new version never overwrites
history. Phase 1 computes dashboard values on read; Phase 3 persists them here.

## Canonical units
steps, m, bpm, ms (HRV), min (sleep, exercise), %, mmHg, kg, cm, mg/dL (glucose), kcal, g, mg,
L, °C, mL/kg/min, score (Oura). `services/analytics/units.ts` converts and refuses incompatible
units. Lab analytes carry their own canonical units (`LAB_ANALYTES`).

## Provenance fields on every normalized row
connector · data_origin · device · recording_method · external_id · raw_event_id ·
source_modified_at · ingested_at · measured_at (+ zone offset) · quality_flags.

## Quality flags
IMPLAUSIBLE_VALUE, FUTURE_TIMESTAMP, MODIFIED_BEFORE_MEASURED, INVALID_TIMESTAMP,
NO_STAGES_DURATION_IS_TIME_IN_BED, STAGES_WITHOUT_SLEEP_TIME, DIASTOLIC_NOT_BELOW_SYSTOLIC,
EXERCISE_TYPE_NUMERIC_FALLBACK, PARTIAL_COVERAGE_7D. Flagged rows are kept and visible; implausible
values are excluded from trend aggregates.

## Deduplication
See ADR 0004 and `docs/source-priority.md`.
