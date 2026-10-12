# Roadmap

| Phase | Scope | Status (2026-10-12) |
|---|---|---|
| 0 Architecture & feasibility | repo, CLAUDE.md, docs, integration matrix (verified), security design, data model, ADRs | **Done** |
| 1 Android + web foundation | Android app with Health Connect onboarding/ingestion/cache/background sync, secure auth, backend DB, provenance, freshness, dedup, initial dashboard, responsive web, demo data, unit tests | **Done with synthetic data**; physical-device verification pending (needs the phone) |
| 2 Oura + Withings | Oura OAuth, history import, incremental sync + webhooks; Withings OAuth, BP history, notify webhooks; BP dashboard; cross-source dedup with API data | Next. Code can be built and tested against mocks; live tests need developer credentials (`docs/environment.md`) |
| 3 Core analytics | 7/28/90/365-day baselines persisted as derived metrics, recovery/cardio/activity/body dashboards, deterministic signal engine, Zone 2 from HR zones | Planned |
| 4 Nutrition & glucose | Cronometer CSV import + HC nutrition, nutrition dashboard, Stelo via HC glucose analytics, meal annotations, repeated-meal comparisons | Planned (HC ingest for both already works) |
| 5 Clinical intelligence | Function PDF/CSV import with review staging, lab explorer, Epic FHIR patient access (Weill Cornell, NYU), medication reconciliation, preventive care, physician brief PDF | Planned (schema exists) |
| 6 AI intelligence | provider-independent analysis packets, recommendation engine + evidence, inbox, weekly Health CEO and monthly Board reports, scheduling | Planned (sharing controls and Oura exclusion already in place) |
| 7 Experiments & training | N-of-1 engine, strength module, progression, check-ins, correlations (exploratory) | Planned (schema exists) |
| 8 Hardening | threat model, tests, background sync testing on device, error recovery, performance, deployment docs, AGP 9 / compileSdk 37 upgrade, Play release prep | Planned |

## Immediate next milestone (Phase 2)
1. `services/integrations/oura`: OAuth (PKCE), token store, usercollection importers (sleep,
   daily_*, heartrate, workout, vO2_max), webhook subscription + HMAC verification, reconciliation job.
2. `services/integrations/withings`: OAuth, `getmeas` BP/weight import with `lastupdate` cursors,
   `notify` subscription with HEAD validation, replay-safe webhook handler.
3. Cross-source dedup of API readings vs Health Connect copies (already supported by the engine).
4. Web + Android: connect/reconnect flows and a fuller BP dashboard.
Live verification is BLOCKED BY CREDENTIALS until Oura and Withings developer apps exist.
