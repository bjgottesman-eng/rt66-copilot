# Product specification (Phase 1 scope and the full product)

Ben Health OS answers: *"Given everything we know about my health, what is happening, what matters,
what is changing, and what should I do next?"* — without inventing data, diagnosing, or
prescribing.

## Primary navigation
Today · Trends · Health CEO · Labs · Training · Nutrition · Experiments · Medications · Preventive ·
Physician brief · Data Sources · Settings. Items not yet built are honest placeholders that name their phase.

## Today
- How am I doing? (headline from domain statuses), What changed (meaningful/directional
  changes vs 28-day baseline), What matters (attention domains, stale or failing sources), What
  should I do today (rules-based, data-driven actions only).
- Five domains, each with transparent status (STEADY, IMPROVING, WATCH, ATTENTION,
  INSUFFICIENT_DATA, NOT_CONNECTED) and evidence. There is no composite health score.
  - Recovery: sleep duration, sleep efficiency, HRV, resting HR, respiratory rate, SpO2
    (Oura scores arrive with the Oura API in Phase 2; temperature deviation likewise).
  - Cardiovascular fitness: blood pressure (+ diastolic, pulse), steps, exercise minutes, active
    calories, VO2 max (Zone 2 minutes in Phase 3 when heart-rate zones are computed).
  - Strength & body composition: weight, body fat, resistance sessions (waist/lean mass via
    manual entry; strength benchmarks in Phase 7).
  - Metabolic & nutrition: glucose, glucose variability, calories, protein, fiber, saturated fat,
    sodium, potassium (micronutrients with Cronometer CSV in Phase 4).
  - Clinical & preventive: confirmed lab results (count, latest panel, lab-flagged values) and
    preventive-care items due (Phase 5); WATCH when the laboratory flagged a value or an item is due,
    never a diagnosis. NOT CONNECTED until labs or clinical records exist.
- Every metric: latest value with unit, measured-at and source, freshness chip with reason,
  7-day vs 28-day delta and change class, 28-day sparkline with gaps, quality flags.

## Trends
Metric picker across all catalog metrics, 30/90/365-day chart windows, daily values with gaps, raw
observations with linked duplicates drawn hollow, plus (Phase 3) the 7/28/90/365-day statistics
table with coverage and confidence, the 7-vs-28-day comparison, the current week's percentile within
the trailing 365 days, heart-rate zone information and persisted signals.

## Domain dashboards (`/domains/{recovery|cardio|strength_body|metabolic_nutrition|clinical_preventive}`)
Status and evidence for the domain, its metric tiles, and per metric the four window means with
confidence and a 90-day daily chart.

## Blood pressure
Latest reading, 7-/30-day averages, morning/evening split, sessions with the averaging rule
stated, reading table with canonical/duplicate status, default target labelled as a population
placeholder until a clinician target is configured, optional manual entry (deduplicated).

## Data Sources
Per connector: connection status (never CONNECTED without auth + data), integration class,
implementation status, latest observation, last sync, expected cadence, measured→ingested latency,
observation count, 30-day coverage, available metrics, missing permissions, devices, last error,
actions (connect/reconnect/refresh/disconnect/export/delete). The Android app adds the phone-side
view: availability, granted permissions, per-type sync state, pending offline uploads, sync log.

## Settings
Profile and time zone, AI data-sharing controls (off by default; Oura excluded by default),
export all data (JSON), delete all data (typed confirmation), implementation-status table.

## Later phases (summary)
See `docs/roadmap.md`: Oura + Withings (2), analytics dashboards and signal engine (3), nutrition
and glucose (4), labs/clinical/medications/preventive/physician brief (5), AI intelligence,
recommendations inbox, weekly/monthly reports (6), experiments, training, check-ins (7),
hardening and release (8). The spec sections 17–33 are the authoritative requirements for those.
