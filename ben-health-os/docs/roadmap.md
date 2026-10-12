# Roadmap

| Phase | Scope | Status (2026-10-12) |
|---|---|---|
| 0 Architecture & feasibility | repo, CLAUDE.md, docs, integration matrix (verified), security design, data model, ADRs | **Done** |
| 1 Android + web foundation | Android app with Health Connect onboarding/ingestion/cache/background sync, secure auth, backend DB, provenance, freshness, dedup, initial dashboard, responsive web, demo data, unit tests | **Done with synthetic data**; physical-device verification pending (needs the phone) |
| 2 Oura + Withings | Oura OAuth (PKCE), history import, incremental sync + HMAC-verified replay-safe webhooks; Withings OAuth, BP/weight history with `lastupdate` cursors, notify webhooks; BP dashboard on web + Android; cross-source dedup with API data; reconcile job | **Implemented, TESTED WITH MOCK DATA** (19 API + 13 connector tests); live verification BLOCKED BY CREDENTIALS (Oura + Withings developer apps) |
| 3 Core analytics | 7/28/90/365-day window stats and baselines persisted as versioned `derived_metrics`, deterministic signal engine persisted per as-of day, Zone 2 minutes from heart-rate samples (profile max HR or Tanaka estimate, never guessed), personal 365-day percentiles, domain dashboards (web) and trend windows (web + Android), derive job | **Implemented, TESTED WITH MOCK DATA** (API + analytics tests) |
| 4 Nutrition & glucose | Cronometer CSV import + HC nutrition, nutrition dashboard, Stelo via HC glucose analytics, meal annotations, repeated-meal comparisons | Planned (HC ingest for both already works) |
| 5 Clinical intelligence | Function PDF/CSV import with review staging, lab explorer, Epic FHIR patient access (Weill Cornell, NYU), medication reconciliation, preventive care, physician brief PDF | Planned (schema exists) |
| 6 AI intelligence | provider-independent analysis packets, recommendation engine + evidence, inbox, weekly Health CEO and monthly Board reports, scheduling | Planned (sharing controls and Oura exclusion already in place) |
| 7 Experiments & training | N-of-1 engine, strength module, progression, check-ins, correlations (exploratory) | Planned (schema exists) |
| 8 Hardening | threat model, tests, background sync testing on device, error recovery, performance, deployment docs, AGP 9 / compileSdk 37 upgrade, Play release prep | Planned |

## Immediate next milestone (Phase 4 — nutrition and glucose)
1. Cronometer CSV importer (header-mapped with review), nutrition day rollups (`nutrition_days`)
   and micronutrients, nutrition dashboard with protein/fiber/sodium/potassium targets.
2. Glucose analytics from Stelo via Health Connect: 24-hour chart, daily mean, variability,
   configurable time-in-range, overnight trends, meal/exercise annotations (`annotations`), repeated-
   meal comparisons; source latency surfaced (3-hour Stelo delay).
3. Apple Health / Google Fit historical import with dedup against Health Connect.
Still pending from earlier phases (blocked on Ben): physical-device verification of the Android app,
and live Oura/Withings verification once developer credentials exist.
