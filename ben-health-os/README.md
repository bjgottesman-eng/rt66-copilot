# Ben Health OS

Private, connected personal health intelligence. One longitudinal record across Oura, Health Connect
(Samsung Health, Withings, Stelo, Cronometer…), Withings, labs and clinical records, with honest
freshness, provenance and deduplication — and no invented numbers.

**Status (2026-10-12): Phases 0–5 implemented and tested with synthetic/mock data.** See
`docs/testing.md` for what has been verified and how, and `docs/roadmap.md` for phases.

| Component | What works today | Status |
|---|---|---|
| Backend API (`services/api`) | Local/Supabase JWT auth, Health Connect ingest with provenance + dedup, Today dashboard, metric series, Data Sources status, manual BP, export-all, delete-all, demo seed | TESTED WITH MOCK DATA (11 integration tests on Postgres 16) |
| Analytics (`services/analytics` + derive job) | Time zones/DST, units, stats, 7-day vs preceding 28-day baselines, freshness, dedup, BP sessions, domain status; Phase 3: versioned 7/28/90/365-day windows, signal engine, Zone 2 minutes, 365-day percentiles, domain dashboards | TESTED WITH MOCK DATA (60 unit + 2 API tests) |
| Web dashboard (`apps/web`) | Login, Today (5 domains), Trends, Blood pressure, Data Sources, Settings, honest placeholders | TESTED WITH MOCK DATA (build + Playwright smoke) |
| Android app (`apps/android`) | Onboarding, Health Connect availability/permissions, backfill + change-token sync, offline queue, Today/Trends/Sources/BP/Settings, biometric lock, Keystore-encrypted session | IMPLEMENTED; unit tests pass; **not yet run on a physical device** |
| Oura + Withings connectors (`services/integrations`, API routes) | OAuth (PKCE), encrypted token storage with rotation, history import, incremental reconcile, HMAC-verified replay-safe webhooks, BP dashboard on web + Android | TESTED WITH MOCK DATA (13 connector + 8 API flow tests); live = BLOCKED BY CREDENTIALS |
| Nutrition & glucose (Phase 4) | Cronometer CSV importer with mapping review and idempotent re-import, same-day dedup against Cronometer-via-Health-Connect meals, `nutrition_days` + personal targets, glucose day analytics (time in range, overnight, meal excursions, repeated meals, Stelo 3-hour latency), annotations; web Nutrition page + Android Nutrition screen | TESTED WITH MOCK DATA (7 analytics + 2 API + 1 fixture tests, Playwright) |
| Clinical intelligence (Phase 5) | Lab ingestion engine (LOINC/name mapping, explicit unit factors, lab-reported ranges/flags), Function Health PDF text-layer + CSV import staged for review, manual entry, cross-source dedup, lab explorer; Epic SMART-on-FHIR connector (labs, conditions, medications, allergies, events) against a mock server; medications/supplements/allergies/conditions + reconciliation; preventive care with guideline sources + iCal; physician brief PDF; web + Android screens | TESTED WITH MOCK DATA (10 analytics + 5 FHIR + 5 API tests, Playwright); live Epic = BLOCKED BY CREDENTIALS; drug interactions NOT IMPLEMENTED |
| AI intelligence (Phase 6) | Analysis packets with citation ids, provenance and sharing controls; deterministic rules engine → recommendations with evidence, three-priority cap, no-repeat rules, descriptive outcomes; weekly Health CEO + monthly Health Board reports persisted with algorithm versions; provider adapter + structured-output validator (mock provider in tests; Anthropic adapter implemented); alerts with value-free titles + notification preferences; health memory; scheduled reports job; web Health CEO + Inbox, Android Health CEO + Inbox + private notifications with quiet hours | TESTED WITH MOCK DATA (8 `@bho/ai` + 4 API tests, Playwright, 2 Android tests); live AI provider = BLOCKED BY CREDENTIALS (API key) |
| Experiments & training (Phase 7) | N-of-1 experiment engine (baseline vs intervention with the trend classifier, coverage + adherence gates, alternating consistency, honest verdicts, decisions to memory, completion alerts, monthly board report), strength module (logged sets, Epley 1RM, weekly volume, progression), subjective check-ins (7-vs-28-day summary, usable as outcomes); web + Android screens; demo seed | TESTED WITH MOCK DATA (8 analytics + 3 API + 1 fixture tests, Playwright, Android DTO test) |
| Apple Health / Google Fit historical import, exploratory correlations | Feasibility matrix (`docs/integrations.md`); correlations deferred until a causal-safe design is agreed | NOT IMPLEMENTED (deferred / Phase 8) |

## Quick start (local, no cloud accounts needed)

Prerequisites: Node 22, pnpm 10, PostgreSQL 16 on `127.0.0.1:5432` (role `bho`/`bho`), JDK 17+ and
the Android SDK (platform 36) for the app.

```bash
pnpm install
pnpm run db:reset                       # creates schema + RLS on postgres://bho:bho@127.0.0.1:5432/ben_health_os
pnpm run build:packages
pnpm --filter @bho/api build && pnpm run dev:api      # API on :8787, AUTH_MODE=local
pnpm run dev:web                                      # web on :3000 → sign in with any email
# On the Today page click "Load synthetic demo data" (or: pnpm run demo:seed)
```

Android: open `apps/android` in Android Studio (or `./gradlew :app:assembleDebug`), install the debug
APK, set the API base URL to your machine (`http://10.0.2.2:8787` on an emulator, `http://<lan-ip>:8787`
on a phone), sign in with the same email, grant Health Connect permissions, and run the first sync.
Physical-device steps and caveats: `docs/device-setup.md`.

## Documentation
- `docs/architecture.md` — components, data flow, freshness rules, offline/background behaviour
- `docs/product-spec.md` — product scope and the five-domain dashboard
- `docs/data-model.md` — three data layers, entities, provenance, dedup rules
- `docs/integrations.md` — verified feasibility matrix per service (with sources)
- `docs/source-priority.md`, `docs/recommendation-safety.md`, `docs/security.md`
- `docs/environment.md` — every environment variable and the credentials you must provide
- `docs/adr/` — architecture decision records
- `docs/testing.md` — what was tested, how, and the results
- `docs/research/` — raw verification notes against official documentation

Ben Health OS does not diagnose disease, prescribe or change medication, or replace licensed
healthcare professionals.
