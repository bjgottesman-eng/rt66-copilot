# Roadmap

| Phase | Scope | Status (2026-10-12) |
|---|---|---|
| 0 Architecture & feasibility | repo, CLAUDE.md, docs, integration matrix (verified), security design, data model, ADRs | **Done** |
| 1 Android + web foundation | Android app with Health Connect onboarding/ingestion/cache/background sync, secure auth, backend DB, provenance, freshness, dedup, initial dashboard, responsive web, demo data, unit tests | **Done with synthetic data**; physical-device verification pending (needs the phone) |
| 2 Oura + Withings | Oura OAuth (PKCE), history import, incremental sync + HMAC-verified replay-safe webhooks; Withings OAuth, BP/weight history with `lastupdate` cursors, notify webhooks; BP dashboard on web + Android; cross-source dedup with API data; reconcile job | **Implemented, TESTED WITH MOCK DATA** (19 API + 13 connector tests); live verification BLOCKED BY CREDENTIALS (Oura + Withings developer apps) |
| 3 Core analytics | 7/28/90/365-day baselines persisted as derived metrics, recovery/cardio/activity/body dashboards, deterministic signal engine, Zone 2 from HR zones | Planned |
| 4 Nutrition & glucose | Cronometer CSV import + HC nutrition, nutrition dashboard, Stelo via HC glucose analytics, meal annotations, repeated-meal comparisons | Planned (HC ingest for both already works) |
| 5 Clinical intelligence | Function PDF/CSV import with review staging, lab explorer, Epic FHIR patient access (Weill Cornell, NYU), medication reconciliation, preventive care, physician brief PDF | Planned (schema exists) |
| 6 AI intelligence | provider-independent analysis packets, recommendation engine + evidence, inbox, weekly Health CEO and monthly Board reports, scheduling | Planned (sharing controls and Oura exclusion already in place) |
| 7 Experiments & training | N-of-1 engine, strength module, progression, check-ins, correlations (exploratory) | Planned (schema exists) |
| 8 Hardening | threat model, tests, background sync testing on device, error recovery, performance, deployment docs, AGP 9 / compileSdk 37 upgrade, Play release prep | Planned |

## Immediate next milestone (Phase 3 — core analytics)
1. Persist 7/28/90/365-day window statistics as versioned `derived_metrics` (nightly job) instead of
   computing on read; expose 90/365-day trends and personal percentiles on Trends.
2. Heart-rate zones from Oura/Health Connect samples → Zone 2 minutes and vigorous minutes.
3. Deterministic signal engine (meaningful vs directional vs noise across domains) feeding the
   Today "what changed" with persisted signals and history.
4. Recovery / cardiovascular / activity / body-composition dashboards with 90-day context.
Before that: run the Phase 2 connectors against the live Oura and Withings APIs once developer
credentials exist (`docs/environment.md`), and the Android app on the physical phone.
