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
| `services/analytics` (vitest) | local-day bucketing incl. record zone offsets and DST (23 h / 25 h days), unit conversion + incompatible-unit refusal, non-overlapping 7-vs-28-day windows, coverage gating, change classification, daily aggregation rules, sparkline gaps, all seven freshness statuses, payload hashing, cross-source BP/sleep dedup, steps never summed, BP sessions and morning/evening split, plausibility, domain status; Phase 4: RFC 4180 CSV parsing, Cronometer header mapping (daily summary vs servings, time/completed columns, extra nutrients, total rows skipped), day/time normalisation, meal grouping with stable external ids, glucose day stats (time in/below/above range, overnight mean, sampling interval, coverage), post-meal excursion (30-min baseline, 2-h peak, iAUC, confidence), repeated-meal grouping; Phase 5: analyte mapping (aliases, LOINC, swapped names, no fasting assumption), explicit lab unit conversions and refusals, reference-range/flag/comparator parsing, lab CSV header mapping and row normalisation with OUTSIDE_REPORTED_RANGE, PDF text-line extraction with confidence/dates/laboratory and no false positives, cross-source lab dedup by priority, direction on comparable values only, preventive DUE/DUE SOON/COMPLETED; Phase 3: signal engine (ranked meaningful/directional, 365-day highs/lows, coverage, stale/sync/implausible), max-HR resolution (profile → Tanaka → refuse), zone-minute estimation with sample/coverage guards | 60 passed |
| `fixtures` (vitest) | deterministic generation, contract validity of every synthetic batch, scenario features (ring-off gap, glucose gap, implausible value), Cronometer-style CSV export that maps back to the same meals as the Health Connect diary, synthetic Function-style lab export (3 panels, all mapped, lab flags) | 4 passed |
| `services/integrations` (vitest, local mock HTTP server) | Oura mapper (long sleep → session/stages/nightly metrics, naps, daily docs, workouts, heart rate), date windows, HMAC signature verification, PKCE; Withings mapper (value decoding, BP + pulse grouping, attrib → recording method, objectives skipped); clients: authorize URLs, code exchange, single-use refresh rotation, pagination (next_token, more/offset), 429 retry with Retry-After, status envelopes; FHIR: SMART discovery, PKCE authorize URL with `aud`, code exchange returning the patient id, refresh, bundle paging with type filtering, pinned Epic organizations, R4 mappers (lab Observation incl. comparator/vitals/panel-header exclusion, Condition statuses, MedicationRequest with RxNorm, AllergyIntolerance, Immunization, Encounter) | 18 passed |
| `services/api` connector flows (vitest, mock Oura + Withings servers) | OAuth start → consent URL → callback (PKCE verifier matches challenge, single-use state), encrypted token storage, initial history import, CONNECTED status and actions, BLOCKED BY CREDENTIALS when unconfigured, Oura verification handshake, bad/valid signatures, duplicate deliveries, delete events, unknown users ignored, expiring token refresh (single-use) + audit, Withings HEAD validation, notification → fetch window → ingest, duplicate notification, incremental `lastupdate`, disconnect clears tokens, reconcile job secret | 8 passed |
| `services/api` Phase 5 clinical (vitest, Postgres, mock SMART/FHIR server) | lab CSV dry run → staged rows → review with corrections and rejection → explorer with canonical units/flags/direction, document file download, manual entry linked as duplicate by source priority, idempotent re-import never overwrites decisions, clinical domain WATCH with evidence; PDF text-layer import staged with confidence, non-PDF refused; Epic connector BLOCKED BY CREDENTIALS without EPIC_CLIENT_ID, with it: org required → PKCE+aud authorize URL → single-use state callback → labs confirmed as clinician records, conditions, medication source records, allergies, events, scope-denied resource reported not hidden, reconcile CREATE → medication with linked record, expiring token refresh + idempotent re-pull, disconnect → 409 on refresh; medications/supplements/allergies CRUD with interactions NOT IMPLEMENTED, preventive guideline source mandatory, DUE/DUE SOON/COMPLETED + completion history + .ics export, Today WATCH on a due item; physician brief content + PDF bytes + RLS isolation | 5 passed |
| `services/api` Phase 4 nutrition + glucose (vitest, Postgres) | Cronometer CSV dry run (mapping, counts, nothing written) → import (meals, observations, `nutrition_days`), Health Connect Cronometer meal on the same day linked as duplicate (not summed), identical re-import = unchanged, corrected export supersedes one meal, daily-summary export linked to itemised meals, targets echoed, file-import source CONNECTED without sync actions, unknown layout refused, glucose day stats (implausible sample excluded, overnight mean, time in range, 15-min interval), meal excursion against pre-meal baseline, workouts and annotations on the day, Stelo latency note, default day = latest with data, empty day = nulls not zeros, annotation create/validate/list/delete (204/404), repeated meals across days, RLS isolation | 2 passed |
| `services/api` Phase 3 analytics (vitest, Postgres) | derive job writes versioned window stats (7/28/90/365) and baselines without duplicates on rerun; Zone 2 absent without physiology (actionable reason), derived after setting a birth date, removed again when physiology is cleared; trends endpoint windows/percentile/365-day series/zone info; persisted signals incl. implausible-value flag; internal derive job secret | 2 passed |
| `services/api` (vitest, real Postgres 16 with RLS) | health, auth (401s, dev login, profile updates, AI-sharing default), full synthetic ingest (4 batches), idempotent re-ingest, update supersedes raw event, Today contract + freshness, steps by origin priority, sources/permissions, series with gaps, BP pulse attachment and sessions, deletions, sync-report → REVOKED status, manual BP idempotency + session grouping + dedup against cuff, implausible manual values flagged, RLS isolation between users, export/delete-all with audit, demo seed guard and clear | 11 passed |
| `apps/web` (vitest) | formatting helpers | 3 passed |
| `apps/web` (Playwright, Chromium) | login → empty Today with 5 domains and honest NOT CONNECTED → demo seed → Today with values and freshness → Trends chart → Blood pressure page + manual entry → Trends with 7/28/90/365-day windows → domain dashboard → Data Sources with CONNECTED Health Connect → Nutrition page (day totals from the demo CSV import, glucose chart + stats, paste-CSV review → import → result, annotation added) → Labs (paste lab CSV → review → stage → confirm → explorer rows) → Preventive (template → item) → Medications (add) → Physician brief (generate → PDF link) → placeholder page → Settings export link; screenshots in `screenshots/` | 1 passed |
| `apps/android` (JUnit, JVM) | Health Connect record → DTO mapping with real SDK record classes (steps, BP, sleep stages, HR samples), JSON round-trip, SDK constant discovery; backfill window planning; batch splitting; DTO contract shape and tolerant decoding incl. glucose day / nutrition days DTOs and local minute-of-day rendering | 12 passed |
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
| OAuth callback handling, token refresh, webhook replay (spec §35 tests) | TESTED WITH MOCK DATA | `services/api/test/connectors.test.ts` |
| Reports use actual data | N/A Phase 6 | — |
| Recommendations link to evidence | N/A Phase 6 (schema present) | — |
| No secrets in source | VERIFIED | `.env*` ignored; config via env only |
| OAuth credentials server-side | TESTED WITH MOCK DATA | tokens AES-256-GCM encrypted; export never includes ciphertext; refresh rotation audited |
| Database access restricted | TESTED WITH MOCK DATA | RLS tests (psql + API) |
| Sensitive info not logged | IMPLEMENTED | request serializers exclude bodies; auth header redacted |
| Export and deletion | TESTED WITH MOCK DATA | API tests + web Settings |
| Permission revocation respected | TESTED WITH MOCK DATA | sync report path; device verification pending |
| Idempotent sync, resumable imports | TESTED WITH MOCK DATA | re-ingest no-op test; per-record savepoints; offline queue replay (device pending) |
| Webhook retries / replay | TESTED WITH MOCK DATA | duplicate deliveries processed once; failed processing releases the dedupe row so provider retries succeed |
| Time zones / DST | TESTED WITH MOCK DATA | analytics time tests |
| Missing data ≠ zero | TESTED WITH MOCK DATA | windows + sparkline tests; Today shows gaps |
| Stale data labelled | TESTED WITH MOCK DATA | freshness tests + UI chips with reasons |
| Cronometer CSV import reviewed before write, idempotent, never double-counted with Health Connect | TESTED WITH MOCK DATA | `services/api/test/nutrition.test.ts`, analytics `phase4.test.ts`, Playwright paste-import |
| Glucose: configurable range, overnight, excursions, latency surfaced, no diagnosis | TESTED WITH MOCK DATA | same tests; disclaimer and range source on every response |
| Lab results keep analyte, code, value, unit, range, flag, dates, lab, provider, document, confidence, verification (spec §11) | TESTED WITH MOCK DATA | `services/api/test/clinical.test.ts`; `lab_results` columns |
| PDF review-and-confirm staging; no silent unit mixing | TESTED WITH MOCK DATA | PDF text layer only (no OCR); unconvertible units flagged and excluded from comparisons |
| Clinical FHIR (Weill Cornell / NYU Langone via Epic) | TESTED WITH MOCK DATA (mock SMART/FHIR server); live BLOCKED BY CREDENTIALS | `test/mock-fhir.ts`; endpoints mirrored from open.epic.com |
| Medication reconciliation, preventive care with guideline source, physician brief PDF | TESTED WITH MOCK DATA | API tests + Playwright walk |

## Not tested (honest list)
- Anything on a physical Android device or emulator (no device in the build environment).
- Hosted Supabase auth/JWKS: BLOCKED BY CREDENTIALS. Oura and Withings: implemented and mock-tested; live API behaviour (rate limits, real payload variations, webhook delivery) BLOCKED BY CREDENTIALS. Stelo/Cronometer CSV/Function/FHIR connectors: not implemented.
- Background execution behaviour under Doze/App Standby on the Galaxy S26 Ultra.
- Load/performance beyond the 5k-record synthetic dataset (ingest of 4,937 records ≈ 3 s locally).

## How to reproduce
```bash
pnpm install && pnpm run db:reset
pnpm run build:packages && pnpm -r run test          # unit + API integration (needs Postgres)
pnpm --filter @bho/web build && bash scripts/e2e.sh # API + web + Playwright
cd apps/android && ./gradlew :app:assembleDebug :app:testDebugUnitTest
```
