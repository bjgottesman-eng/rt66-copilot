# Roadmap

| Phase | Scope | Status (2026-10-12) |
|---|---|---|
| 0 Architecture & feasibility | repo, CLAUDE.md, docs, integration matrix (verified), security design, data model, ADRs | **Done** |
| 1 Android + web foundation | Android app with Health Connect onboarding/ingestion/cache/background sync, secure auth, backend DB, provenance, freshness, dedup, initial dashboard, responsive web, demo data, unit tests | **Done with synthetic data**; physical-device verification pending (needs the phone) |
| 2 Oura + Withings | Oura OAuth (PKCE), history import, incremental sync + HMAC-verified replay-safe webhooks; Withings OAuth, BP/weight history with `lastupdate` cursors, notify webhooks; BP dashboard on web + Android; cross-source dedup with API data; reconcile job | **Implemented, TESTED WITH MOCK DATA** (19 API + 13 connector tests); live verification BLOCKED BY CREDENTIALS (Oura + Withings developer apps) |
| 3 Core analytics | 7/28/90/365-day window stats and baselines persisted as versioned `derived_metrics`, deterministic signal engine persisted per as-of day, Zone 2 minutes from heart-rate samples (profile max HR or Tanaka estimate, never guessed), personal 365-day percentiles, domain dashboards (web) and trend windows (web + Android), derive job | **Implemented, TESTED WITH MOCK DATA** (API + analytics tests) |
| 4 Nutrition & glucose | Cronometer CSV importer (daily-summary or servings layout, header-mapped with dry-run review, idempotent re-import per day), same-day dedup against Cronometer meals arriving via Health Connect, `nutrition_days` rollups + user/clinician targets, glucose day analytics from Stelo via HC (mean/SD/CV, configurable time in range, overnight mean, meal excursions with baseline/peak/iAUC, repeated-meal comparison, 3-hour Stelo latency surfaced), annotations (meal/exercise/note), web Nutrition page, Android Nutrition screen | **Implemented, TESTED WITH MOCK DATA** (7 analytics + 2 API + 1 fixture tests, Playwright); Apple Health / Google Fit historical import NOT IMPLEMENTED (deferred to Phase 8 hardening) |
| 5 Clinical intelligence | Laboratory ingestion engine (analyte mapping by LOINC/name, explicit unit factors with refusal, lab-reported ranges/flags, raw events), Function Health PDF (text layer, no OCR) and CSV imports staged for review with corrections, manual entry, cross-source lab dedup, lab explorer with history/direction; Epic SMART-on-FHIR patient-access connector (discovery, PKCE + aud, token rotation) pulling laboratory Observations as confirmed clinician records, Conditions, MedicationRequests (reconciliation queue), AllergyIntolerances, Immunizations/Procedures/Encounters; medications, supplements, allergies, conditions, reconciliation log; preventive-care items with mandatory guideline source, computed DUE/DUE SOON, iCal export; physician brief JSON + PDF; clinical domain evidence on Today; web Labs/Medications/Preventive/Physician brief pages; Android Labs/Medications/Preventive screens | **Implemented, TESTED WITH MOCK DATA** (10 analytics + 5 FHIR client/mapper + 5 API tests, Playwright); live Epic = BLOCKED BY CREDENTIALS (fhir.epic.com app registration); drug-interaction checking NOT IMPLEMENTED (no verified source integrated) |
| 6 AI intelligence | provider-independent analysis packets, recommendation engine + evidence, inbox, weekly Health CEO and monthly Board reports, scheduling | Planned (sharing controls and Oura exclusion already in place) |
| 7 Experiments & training | N-of-1 engine, strength module, progression, check-ins, correlations (exploratory) | Planned (schema exists) |
| 8 Hardening | threat model, tests, background sync testing on device, error recovery, performance, deployment docs, AGP 9 / compileSdk 37 upgrade, Play release prep | Planned |

## Immediate next milestone (Phase 6 — AI intelligence)
1. Structured analysis packets (measured facts with provenance, derived trends, confirmed clinical
   records) honouring the AI-sharing controls and the Oura exclusion; provider adapter interface
   with a mock provider for tests — live provider BLOCKED BY CREDENTIALS (API key).
2. Recommendation engine + evidence references + persistent inbox (`recommendations`,
   `recommendation_evidence`, `alerts`) with the labelling rules (MEASURED FACT / DERIVED TREND /
   HYPOTHESIS / RECOMMENDATION) and the safety rules of `docs/recommendation-safety.md`.
3. Weekly Health CEO and monthly Health Board reports (`weekly_health_reports`,
   `monthly_health_reports`) built from the signal engine and the windows; notifications.
Deferred: Apple Health / Google Fit historical import (needs Ben's export files to design the mapper);
drug-interaction flags (needs a verified clinical interaction source).
Still pending from earlier phases (blocked on Ben): physical-device verification of the Android app,
and live Oura/Withings verification once developer credentials exist.
