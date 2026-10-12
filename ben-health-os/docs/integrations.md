# Integration feasibility matrix

Verified against official documentation on 2026-10-12 (details and URLs in `docs/research/`).
Nothing below is presented as connected until authentication and data retrieval actually succeed.

| Service | Classification | Mechanism | Data | Verified constraints | Phase | Status |
|---|---|---|---|---|---|---|
| **Google Health Connect** | HEALTH CONNECT | `androidx.health.connect:connect-client:1.1.0` on the Samsung Galaxy S26 Ultra (Android 17; HC is a framework module on 14+) | Steps, distance, HR, resting HR, HRV (RMSSD), sleep + stages (inside SleepSessionRecord), BP, weight, body fat, lean mass, height, glucose, nutrition, hydration, exercise sessions, respiratory rate, SpO2, VO2 max, calories, body temperature | 30-day read limit before first grant unless `READ_HEALTH_DATA_HISTORY` is granted; background reads need `READ_HEALTH_DATA_IN_BACKGROUND` (feature-gated); change tokens expire after 30 days; undocumented rate quotas (IllegalStateException); privacy rationale activity + Play declaration required | 1 | IMPLEMENTED, TESTED WITH MOCK DATA; device test pending |
| **Oura** | VERIFIED DIRECT API | Oura API v2, OAuth2 (authorization code, PKCE recommended), webhooks (`x-oura-signature`), sandbox | sleep, daily_sleep/readiness/activity, heartrate, workout, session, daily_spo2, daily_stress, daily_resilience, vO2_max, cardiovascular age, temperature deviation (inside readiness) | PATs deprecated Dec 2025 → OAuth only; apps capped at 10 users until approved; Membership required (Gen3+); 5000 req / 5 min; **API Agreement §4(d): API data may not be provided as input to AI models except via Oura's MCP server** → Oura API data excluded from AI packets by default | 2 | NOT IMPLEMENTED |
| **Oura via Health Connect** | HEALTH CONNECT | Oura app exports to HC (official) | active calories, distance, exercise, steps, height, weight, sleep, HR, HRV (no SpO2) | Requires membership; scores (readiness/sleep) are **not** in HC → only via API | 1 | ingest path implemented |
| **Withings BP cuff** | VERIFIED DIRECT API | Withings Public API: OAuth2 (`account.withings.com/oauth2_user/authorize2`, token `wbsapi.withings.net/v2/oauth2`), `measure?action=getmeas` (types 10 systolic, 9 diastolic, 11 pulse), `notify` webhooks (appli 4) | BP + pulse, weight, fat ratio, SpO2, temperature, VO2max, PWV | Free plan: 10 users, HEAD-validated HTTPS callback; refresh tokens rotate (replace every time); poll ≤ 1/10 min per user via `lastupdate`; **Withings+ membership required for accounts created after 2026-10-12 on the free plan** (existing accounts grandfathered); `attrib` codes distinguish device-captured vs manual | 2 | NOT IMPLEMENTED (BLOCKED BY CREDENTIALS once built) |
| **Withings via Health Connect** | HEALTH CONNECT | Withings app "Export health data to Health Connect" | types not enumerated officially; BP specifically UNVERIFIED | Deduplicated against API readings (3-minute window, exact values) | 1 | ingest path implemented |
| **Dexcom Stelo** | HEALTH CONNECT | Stelo app → Health Connect (official; 3-hour delay) | glucose | Dexcom Developer API does **not** document Stelo → treated as UNSUPPORTED for API; Clarity CSV export for Stelo UNVERIFIED | 4 (ingest path works now) | HC ingest implemented; connector screen NOT IMPLEMENTED |
| **Cronometer Gold** | HEALTH CONNECT + FILE IMPORT | Cronometer app exports Nutrition (Food, Water) + biometrics to HC (official); CSV exports from Account settings | calories, macros, fiber, sodium, potassium (HC); micronutrients and food items (CSV) | No public API; CSV columns undocumented → header-mapped importer with review | 4 | HC nutrition ingest implemented; CSV NOT IMPLEMENTED |
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
- **Oura / Withings (Phase 2)**: server-driven. OAuth tokens encrypted at rest; webhooks are
  validated, deduplicated by (connector, dedupe_key) and replay-safe; periodic reconciliation with
  `lastupdate`/date windows recovers missed notifications.
- **Imports (Phase 4/5)**: file hashes make reimports idempotent; PDFs require confirmation.

## What is deliberately not done
- No scraping of Function, One Medical, Weill Cornell or Dexcom portals.
- No assumption that Health Connect contains Oura scores, or that Withings BP reaches Health Connect.
- No AI calls in Phase 1; the Oura exclusion default is already wired into profiles.
