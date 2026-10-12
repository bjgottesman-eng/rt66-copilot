# Integration feasibility matrix

Verified against official documentation on 2026-10-12 (details and URLs in `docs/research/`).
Nothing below is presented as connected until authentication and data retrieval actually succeed.

| Service | Classification | Mechanism | Data | Verified constraints | Phase | Status |
|---|---|---|---|---|---|---|
| **Google Health Connect** | HEALTH CONNECT | `androidx.health.connect:connect-client:1.1.0` on the Samsung Galaxy S26 Ultra (Android 17; HC is a framework module on 14+) | Steps, distance, HR, resting HR, HRV (RMSSD), sleep + stages (inside SleepSessionRecord), BP, weight, body fat, lean mass, height, glucose, nutrition, hydration, exercise sessions, respiratory rate, SpO2, VO2 max, calories, body temperature | 30-day read limit before first grant unless `READ_HEALTH_DATA_HISTORY` is granted; background reads need `READ_HEALTH_DATA_IN_BACKGROUND` (feature-gated); change tokens expire after 30 days; undocumented rate quotas (IllegalStateException); privacy rationale activity + Play declaration required | 1 | IMPLEMENTED, TESTED WITH MOCK DATA; device test pending |
| **Oura** | VERIFIED DIRECT API | Oura API v2, OAuth2 (authorization code, PKCE recommended), webhooks (`x-oura-signature`), sandbox | sleep, daily_sleep/readiness/activity, heartrate, workout, session, daily_spo2, daily_stress, daily_resilience, vO2_max, cardiovascular age, temperature deviation (inside readiness) | PATs deprecated Dec 2025 → OAuth only; apps capped at 10 users until approved; Membership required (Gen3+); 5000 req / 5 min; **API Agreement §4(d): API data may not be provided as input to AI models except via Oura's MCP server** → Oura API data excluded from AI packets by default | 2 | IMPLEMENTED, TESTED WITH MOCK DATA (mock API server); live = BLOCKED BY CREDENTIALS |
| **Oura via Health Connect** | HEALTH CONNECT | Oura app exports to HC (official) | active calories, distance, exercise, steps, height, weight, sleep, HR, HRV (no SpO2) | Requires membership; scores (readiness/sleep) are **not** in HC → only via API | 1 | ingest path implemented |
| **Withings BP cuff** | VERIFIED DIRECT API | Withings Public API: OAuth2 (`account.withings.com/oauth2_user/authorize2`, token `wbsapi.withings.net/v2/oauth2`), `measure?action=getmeas` (types 10 systolic, 9 diastolic, 11 pulse), `notify` webhooks (appli 4) | BP + pulse, weight, fat ratio, SpO2, temperature, VO2max, PWV | Free plan: 10 users, HEAD-validated HTTPS callback; refresh tokens rotate (replace every time); poll ≤ 1/10 min per user via `lastupdate`; **Withings+ membership required for accounts created after 2026-10-12 on the free plan** (existing accounts grandfathered); `attrib` codes distinguish device-captured vs manual | 2 | IMPLEMENTED, TESTED WITH MOCK DATA (mock API server); live = BLOCKED BY CREDENTIALS |
| **Withings via Health Connect** | HEALTH CONNECT | Withings app "Export health data to Health Connect" | types not enumerated officially; BP specifically UNVERIFIED | Deduplicated against API readings (3-minute window, exact values) | 1 | ingest path implemented |
| **Dexcom Stelo** | HEALTH CONNECT | Stelo app → Health Connect (official; 3-hour delay) | glucose | Dexcom Developer API does **not** document Stelo → treated as UNSUPPORTED for API; Clarity CSV export for Stelo UNVERIFIED | 4 | HC ingest + glucose day analytics (time in range, overnight, meal excursions, repeated meals, 3-hour latency surfaced) TESTED WITH MOCK DATA |
| **Cronometer Gold** | HEALTH CONNECT + FILE IMPORT | Cronometer app exports Nutrition (Food, Water) + biometrics to HC (official); CSV exports from Account settings | calories, macros, fiber, sodium, potassium (HC); micronutrients and food items (CSV) | No public API; CSV columns undocumented → header-mapped importer with review | 4 | HC nutrition ingest + CSV importer (`POST /v1/imports/cronometer`, dry-run review, idempotent per day, same-day dedup vs HC) TESTED WITH MOCK DATA; real export headers still UNVERIFIED until Ben imports one |
| **Function Health** | FILE IMPORT | PDF download (official); CSV UNVERIFIED | lab panels (Quest) | No developer API; PDFs go through review-and-confirm staging | 5 | NOT IMPLEMENTED |
| **Weill Cornell (Epic MyChart)** | CLINICAL FHIR | Epic patient-access FHIR R4 (`epicproxy-pub.et1089.epichosted.com/FHIRProxy/api/FHIR/R4/`), SMART standalone launch, PKCE | labs, meds, conditions, vitals, immunizations | Requires app registration on fhir.epic.com (non-prod + prod client ids) | 5 | NOT IMPLEMENTED (BLOCKED BY CREDENTIALS) |
| **NYU Langone (Epic)** | CLINICAL FHIR | `epicfhir.nyumc.org/FHIRPRD/api/FHIR/R4` | same | same | 5 | NOT IMPLEMENTED |
| **One Medical** | FILE IMPORT | Records download (web/app); Apple Health Records only | clinical documents | No patient-facing FHIR or Health Connect found | 5 | NOT IMPLEMENTED |
| **Health Connect medical records (FHIR)** | CLINICAL FHIR | Android 16+ `MedicalResource` APIs | 14 FHIR resource types | `ExperimentalPersonalHealthRecordApi`; Play policy still being developed | 5+ | NOT IMPLEMENTED |
| **Samsung Health** | HEALTH CONNECT | Samsung Health → HC sync (official, since 6.22.5) | steps, exercise, HR, sleep, glucose, SpO2, BP, nutrition, weight | Phone steps overlap Oura steps → priority rule, never summed | 1 | ingest path implemented |
| **Apollo Neuro** | MANUAL | No API / Health Connect | usage as experiment adherence | — | 7 | NOT IMPLEMENTED |
| **ChatGPT Health / Claude** | UNSUPPORTED as data source | Consumer subscriptions give no developer API; Phase 6 uses server-side provider APIs with explicit sharing controls | — | — | 6 | NOT IMPLEMENTED |
| **Apple Health / Google Fit history** | FILE IMPORT | Apple Health export XML; Google Takeout | historical records | Deduplicated against HC | 4 | NOT IMPLEMENTED |

## Sync model per connector
- **Health Connect**: app-driven. Initial backfill in 7-day windows (30 days, or 365 with history
  permission), then per-type change tokens; deletions soft-delete linked rows; every attempt posts a
  sync report so the server can explain staleness. Background execution is best-effort (WorkManager,
  4-hour period) and requires the background-read permission; otherwise sync runs on app launch.
- **Oura / Withings (Phase 2, implemented)**: server-driven. `GET /v1/oauth/{connector}/start`
  creates a user-bound state (PKCE S256 for Oura) and returns the provider consent URL; the callback
  exchanges the code, stores AES-256-GCM encrypted tokens, runs the initial history import (Oura:
  `OURA_HISTORY_DAYS`, default 90, in 30-day windows across sleep/daily_*/workout/vO2_max plus 2 days
  of heart-rate samples; Withings: `getmeas` over `WITHINGS_HISTORY_DAYS`, default 730) and registers
  webhooks when `PUBLIC_BASE_URL` is HTTPS (Oura: application-level subscriptions for create/update/
  delete of 8 data types with the verification handshake; Withings: `notify` subscribe for appli 4 and
  1 with the HEAD validation). Webhook deliveries are stored in `webhook_events` keyed by a dedupe key
  so retries and duplicate deliveries are processed once; Oura payloads are HMAC-verified; Withings
  payloads carry no values so the window is fetched from `getmeas`. `POST /v1/sources/{connector}/
  refresh` and `POST /internal/jobs/reconcile` (JOB_SECRET; wire to pg_cron or a container cron,
  hourly) run incremental reconciliation (Oura: last 3 days; Withings: `lastupdate` cursor) and renew
  Oura subscriptions. Refresh tokens rotate on every refresh (single-use) and are persisted
  immediately; auth failures mark the connection EXPIRED so the Data Sources screen asks to reconnect.
- **Imports (Phase 4/5)**: file hashes make reimports idempotent; PDFs require confirmation.

## What is deliberately not done
- No scraping of Function, One Medical, Weill Cornell or Dexcom portals.
- No assumption that Health Connect contains Oura scores, or that Withings BP reaches Health Connect.
- No AI calls in Phase 1; the Oura exclusion default is already wired into profiles.
