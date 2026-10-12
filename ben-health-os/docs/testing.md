# Testing and verification status

Last full run: 2026-10-12 in the development container (Linux, Node 22.22, pnpm 10.28, PostgreSQL
16.15, JDK 21, Gradle 8.14.3, Android SDK platform 36 / build-tools 36.0.0, Playwright 1.56 +
Chromium 1194). Re-run everything with `pnpm run verify` (`scripts/verify.sh`).

Status vocabulary (used everywhere, including the Data Sources screens):
**IMPLEMENTED** · **TESTED WITH MOCK DATA** · **TESTED ON PHYSICAL DEVICE** ·
**TESTED AGAINST LIVE API** · **BLOCKED BY CREDENTIALS** · **NOT IMPLEMENTED**.

## Automated suites (all passing)

| Suite | What it covers | Result |
|---|---|---|
| `packages/shared-config` (vitest) | generated JSON = TS source (no drift), catalog/connector/priority integrity, threshold ordering | 6 passed |
| `packages/contracts` (vitest) | ingest record validation (instant/interval, payload per type, time ordering), batch defaults, manual BP rules | 7 passed |
| `services/analytics` (vitest) | local-day bucketing incl. record zone offsets and DST (23 h / 25 h days), unit conversion + incompatible-unit refusal, non-overlapping 7-vs-28-day windows, coverage gating, change classification, daily aggregation rules, sparkline gaps, all seven freshness statuses, payload hashing, cross-source BP/sleep dedup, steps never summed, BP sessions and morning/evening split, plausibility, domain status | 40 passed |
| `fixtures` (vitest) | deterministic generation, contract validity of every synthetic batch, scenario features (ring-off gap, glucose gap, implausible value) | 2 passed |
| `services/api` (vitest, real Postgres 16 with RLS) | health, auth (401s, dev login, profile updates, AI-sharing default), full synthetic ingest (4 batches), idempotent re-ingest, update supersedes raw event, Today contract + freshness, steps by origin priority, sources/permissions, series with gaps, BP pulse attachment and sessions, deletions, sync-report → REVOKED status, manual BP idempotency + session grouping + dedup against cuff, implausible manual values flagged, RLS isolation between users, export/delete-all with audit, demo seed guard and clear | 11 passed |
| `apps/web` (vitest) | formatting helpers | 3 passed |
| `apps/web` (Playwright, Chromium) | login → empty Today with 5 domains and honest NOT CONNECTED → demo seed → Today with values and freshness → Trends chart → Blood pressure page + manual entry → Data Sources with CONNECTED Health Connect → placeholder page → Settings export link; screenshots in `screenshots/` | 1 passed |
| `apps/android` (JUnit, JVM) | Health Connect record → DTO mapping with real SDK record classes (steps, BP, sleep stages, HR samples), JSON round-trip, SDK constant discovery; backfill window planning; batch splitting; DTO contract shape and tolerant decoding | 11 passed |
| `apps/android` `assembleDebug` | full Kotlin/Compose/KSP/Room build of the debug APK | BUILD SUCCESSFUL |

## Acceptance criteria (spec §35) — Phase 1 evidence

| Criterion | Status | Evidence |
|---|---|---|
| Android app launches | IMPLEMENTED, **not yet run on a device** | APK builds; needs the Galaxy S26 Ultra (`docs/device-setup.md`) |
| Web dashboard launches | TESTED WITH MOCK DATA | Playwright smoke run |
| Authentication works | TESTED WITH MOCK DATA (local mode) · BLOCKED BY CREDENTIALS (Supabase) | API auth tests; Supabase verifier implemented but unexercised |
| Health Connect permissions on a physical device | IMPLEMENTED, pending device | onboarding + permission contract + feature gating in code |
| Actual Health Connect records import | TESTED WITH MOCK DATA (synthetic HC-shaped records end to end) | API ingest tests; mapper tests use SDK record classes |
| Missing permissions handled gracefully | TESTED WITH MOCK DATA | sync-report test → REVOKED + SYNC_ERROR freshness |
| Source and timestamp preserved | TESTED WITH MOCK DATA | raw events + observations carry origin, device, offsets, modified/ingested times |
| Duplicates not counted twice | TESTED WITH MOCK DATA | analytics dedup tests; API cross-source tests (sleep, workouts, BP manual vs cuff) |
| Historical backfill | IMPLEMENTED (device pending) | 7-day window planner tests; syncer backfill path |
| Manual measurements | TESTED WITH MOCK DATA | API + web e2e |
| Reports use actual data | N/A Phase 6 | — |
| Recommendations link to evidence | N/A Phase 6 (schema present) | — |
| No secrets in source | VERIFIED | `.env*` ignored; config via env only |
| OAuth credentials server-side | DESIGNED (Phase 2) | encrypted columns + TokenCipher implemented |
| Database access restricted | TESTED WITH MOCK DATA | RLS tests (psql + API) |
| Sensitive info not logged | IMPLEMENTED | request serializers exclude bodies; auth header redacted |
| Export and deletion | TESTED WITH MOCK DATA | API tests + web Settings |
| Permission revocation respected | TESTED WITH MOCK DATA | sync report path; device verification pending |
| Idempotent sync, resumable imports | TESTED WITH MOCK DATA | re-ingest no-op test; per-record savepoints; offline queue replay (device pending) |
| Webhook retries | N/A Phase 2 (table + dedupe key ready) | — |
| Time zones / DST | TESTED WITH MOCK DATA | analytics time tests |
| Missing data ≠ zero | TESTED WITH MOCK DATA | windows + sparkline tests; Today shows gaps |
| Stale data labelled | TESTED WITH MOCK DATA | freshness tests + UI chips with reasons |

## Not tested (honest list)
- Anything on a physical Android device or emulator (no device in the build environment).
- Hosted Supabase auth/JWKS, Oura, Withings, Stelo, Cronometer, Function, FHIR: not implemented
  or BLOCKED BY CREDENTIALS.
- Background execution behaviour under Doze/App Standby on the Galaxy S26 Ultra.
- Load/performance beyond the 5k-record synthetic dataset (ingest of 4,937 records ≈ 3 s locally).

## How to reproduce
```bash
pnpm install && pnpm run db:reset
pnpm run build:packages && pnpm -r run test          # unit + API integration (needs Postgres)
pnpm --filter @bho/web build && bash scripts/e2e.sh # API + web + Playwright
cd apps/android && ./gradlew :app:assembleDebug :app:testDebugUnitTest
```
