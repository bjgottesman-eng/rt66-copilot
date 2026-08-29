# Integrations

Status of every data source, verified against **current official documentation
on 2026-08-29**. Raw research evidence (full fact lists, per-fact citations,
and uncertainties) is archived in
`docs/research-2026-08-29-integration-research.txt`. Re-verify before each new
connector build; update the access date when you do.

Classification vocabulary: `VERIFIED DIRECT API` · `APPLE HEALTH` ·
`CLINICAL HEALTH RECORDS` · `FILE IMPORT` · `MANUAL ENTRY` ·
`NOT CURRENTLY SUPPORTED`.

| Source | Classification | Phase | Ingestion path |
|---|---|---|---|
| Withings (BP cuff) | VERIFIED DIRECT API | 1 | OAuth2 + `getmeas` + `notify` webhooks; Apple Health as cross-check |
| Apple Health | APPLE HEALTH | 1 (BP), 2 (rest) | HealthKit on iOS; anchored queries + observers |
| Oura | VERIFIED DIRECT API | 3 | API v2 OAuth2 + webhooks; Apple Health as cross-check |
| Dexcom Stelo | APPLE HEALTH (+ FILE IMPORT) | 2 | Stelo app → Apple Health (≈3 h delay); Clarity CSV for backfill |
| Cronometer | FILE IMPORT (+ APPLE HEALTH) | 4 | Official CSV exports; Apple Health nutrition as convenience feed |
| Function Health | FILE IMPORT (+ summary MCP) | 4 | PDF/CSV import with review; no public raw-data API |
| Clinical records (One Medical, Weill Cornell, …) | CLINICAL HEALTH RECORDS | 4 | HKClinicalRecord / FHIR, read-only |
| Apollo Neuro | APPLE HEALTH | later | Mindful Minutes via Apple Health; no developer API |
| ChatGPT Health / Counsel Health / provider portals | NOT CURRENTLY SUPPORTED | — | Not developer APIs; export summaries *to* them instead |
| Manual entry | MANUAL ENTRY | 1 | First-class in-app entry |

---

## Withings — VERIFIED DIRECT API (Phase 1)

Docs consulted 2026-08-29:
- https://developer.withings.com/api-reference/ and the authoritative machine-readable spec https://developer.withings.com/openapi.yaml
- OAuth: https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/get-access/oauth-authorization-url/
- Tokens: https://developer.withings.com/developer-guide/v3/integration-guide/dropship-cellular/get-access/access-and-refresh-tokens/
- Notifications: https://developer.withings.com/developer-guide/v3/data-api/notifications/notification-overview/, …/notification-content, …/notification-subscribe/
- Dashboard (app registration): https://developer.withings.com/dashboard/

Verified facts the connector is built on:

- **OAuth2**: authorize `GET https://account.withings.com/oauth2_user/authorize2`
  (`response_type=code`, `client_id`, `state` (required, CSRF), comma-separated
  `scope`, `redirect_uri`; optional `mode=demo` for the sandbox user). The
  authorization code lives **30 seconds**. Token endpoint
  `POST https://wbsapi.withings.net/v2/oauth2` (form-encoded) with Withings'
  non-standard `action=requesttoken` plus `grant_type=authorization_code|refresh_token`.
  Responses use the envelope `{"status": int, "body": {...}}` — `status: 0` is
  success and HTTP is 200 even on errors. Persist `body.userid`.
- **Scopes**: exactly `user.info`, `user.metrics`, `user.activity`,
  `user.sleepevents`. BP + appli=4 notifications need only **`user.metrics`**.
- **Token lifetimes**: access token 3 h (`expires_in=10800`); refresh token ~1
  year and **rotates on every call** — the old refresh token dies 8 h after
  rotation or as soon as the new access token is used. Persist the new pair
  atomically before using the new access token.
- **Measures**: `POST https://wbsapi.withings.net/measure` `action=getmeas`,
  `meastypes=9,10,11`, `category=1`. Types verified current: **9 diastolic
  (mmHg), 10 systolic (mmHg), 11 pulse (bpm)**. Real value =
  `value * 10^unit`. A BP reading is one `measuregrp` (`grpid` int64 = stable
  idempotency key; `date` measured, `created`, `modified`, `deviceid`,
  `attrib`). Groups are updated in place on correction. Pagination: loop on
  `more`/`offset`. **Sync cursor**: pass `lastupdate` (not startdate/enddate);
  store the response's `updatetime` as the next cursor — this heals missed
  webhooks by design.
- **Notifications**: `POST https://wbsapi.withings.net/notify`
  `action=subscribe|get|list|revoke|update`, `callbackurl` (HTTPS, real domain,
  no IP/localhost, port 80/443, ≤255 chars), `appli` — **appli=4 = blood
  pressure & heart rate** (verified against …/notification-content; note the
  official `llms.md` file's appli table is wrong — do not use it). At subscribe
  time Withings sends a **HEAD request** that must get 2xx. Deliveries are
  `application/x-www-form-urlencoded` POSTs: `userid`, `appli`, `startdate`,
  `enddate`. Payloads are unauthenticated and carry no delivery id → respond
  2xx fast, never trust the body, fetch via `getmeas` with the durable
  cursor. Retries: ~10 attempts over ~5 h (duplicates possible); missed
  notifications are never redelivered; 20 days of failures auto-cancels the
  subscription (run a reconciliation poll + `action=list` check).
- **Sandbox**: `mode=demo` on the authorize URL; also `action=getdemoaccess`.
- **Errors**: envelope statuses — 100 no data, 343 invalid token (refresh),
  601 too many requests. Don't poll more than every 10 min/user.

Open uncertainties (tracked, not blocking): representation of *deleted*
measure groups in `getmeas` output is undocumented (corrections verified as
group updates; deletion needs an empirical test with a real account); exact
numeric rate limits unpublished; webhook has no signature — mitigated by
fetch-on-notify.

**Owner actions required**: create an app at
https://developer.withings.com/dashboard/ (needs a Withings account; no
contract required for the Public API), register the callback URL, and provide
`WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET` / public HTTPS callback
domain. Until then the connector runs against `WithingsFake` (labeled MOCKED).

## Apple Health / HealthKit — APPLE HEALTH (Phase 1 BP, Phase 2 rest)

Docs consulted 2026-08-29: HKAnchoredObjectQueryDescriptor, HKObserverQuery,
`enableBackgroundDelivery`, HKCorrelation/bloodPressure,
HKMetadataKeySyncIdentifier, bloodGlucose, HKClinicalTypeIdentifier,
HKFHIRResource, `com.apple.developer.healthkit.access`, authorization articles
(all developer.apple.com; URLs in the research archive).

- Toolchain landscape (Aug 2026): Apple unified OS versions at **26**; current
  stable Xcode is **26.x with Swift 6.3**; iOS 27 is in beta. See ADR-0003.
- Modern sync: `HKAnchoredObjectQueryDescriptor` (iOS 15.4+) with persisted
  anchors; `results(for:)` AsyncSequence while foregrounded.
- **Background delivery does NOT support correlation types** — observe
  `bloodPressureSystolic`/`bloodPressureDiastolic` quantity types, then query
  the `bloodPressure` correlation. Observer handlers carry no samples and their
  completion handler must be called (3 misses stop delivery). Background
  delivery needs the `com.apple.developer.healthkit.background-delivery`
  entitlement and does not work in the Simulator.
- BP correlations contain exactly two quantity samples; provenance comes from
  `sourceRevision` + `HKDevice`.
- App-written samples use `HKMetadataKeySyncIdentifier` +
  `HKMetadataKeySyncVersion` (official upsert/dedup mechanism) — ours are
  `benhealthos.bp.<uuid>`, which also lets ingestion suppress re-import of our
  own writes.
- Read authorization is **opaque by design**: denied read ≠ distinguishable
  from no data. UI must present "no data or no permission" honestly.
  (An iOS 27-beta API for limited-authorization detection exists; not used.)
- HealthKit is still **not usable on macOS** (framework links on macOS 14+ but
  `isHealthDataAvailable()` returns false) — confirms the web-dashboard
  architecture.

## Oura — VERIFIED DIRECT API (Phase 3)

Docs consulted 2026-08-29: https://cloud.ouraring.com/v2/docs, OpenAPI spec
https://api.ouraring.com/v2/static/json/openapi-1.37.json,
https://cloud.ouraring.com/docs/authentication.

- API **v2 only** (v1 sunset 2024); **personal access tokens deprecated Dec
  2025** — OAuth2 authorization-code is mandatory even for one user
  (authorize `https://cloud.ouraring.com/oauth/authorize`, token
  `https://api.ouraring.com/oauth/token`). **Refresh tokens are single-use.**
  Unapproved apps: 10 users (fine for us).
- Scopes: `email personal daily heartrate workout tag session spo2Daily`
  (spec) — auth page says `spo2`; test empirically at connect time.
- Routes verified: daily_sleep, daily_readiness, daily_activity, sleep,
  heartrate, daily_spo2, daily_stress, daily_resilience,
  daily_cardiovascular_age, vO2_max, workout, session, enhanced_tag (plain
  `tag` deprecated), etc. HRV lives inside `/sleep` (`average_hrv`, `hrv[]`),
  temperature deviation on `/daily_readiness`. Sandbox twins at
  `/v2/sandbox/usercollection/*`.
- Webhooks: subscription CRUD with `x-client-id`/`x-client-secret` headers;
  GET verification challenge (echo `{"challenge": ...}`); event POSTs signed
  with HMAC-SHA256 (`x-oura-signature`, uppercase hex over timestamp+body);
  respond 2xx <10 s then fetch by `object_id`; subscriptions expire and need
  `renew`; **no heartrate webhook type**. Data lands only after ring→app sync.

## Dexcom Stelo — APPLE HEALTH + FILE IMPORT (Phase 2)

Docs consulted 2026-08-29: stelo.com FAQs (health-app sharing, Apple Watch,
Clarity), dexcom.com FAQs (G7 Apple Health, raw export),
https://developer.dexcom.com/docs/dexcom/scopes-access/.

- Stelo → Apple Health sharing is official (**"Stelo sends your glucose data
  to health apps with a 3-hour delay"**), 15-minute reading cadence. So:
  `expected_latency_seconds ≈ 11,700` (3 h + one 15-min interval), and glucose
  UI must say "as of ~3 h ago" — never "live".
- The **Dexcom Developer API does not list Stelo** among supported devices
  (G6/G7/ONE only) — a direct Stelo API integration is not currently possible;
  re-check periodically. (Its Individual/Limited tier would otherwise fit.)
- Backfill path: Dexcom **Clarity works with Stelo credentials** and exports
  CSV — build as FILE IMPORT in Phase 4's import framework.
- Sensor reality: ~20 % of sensors die before day 15 — ingestion tolerates
  gaps, never interpolates silently.

## Cronometer — FILE IMPORT primary (Phase 4)

Docs consulted 2026-08-29 (via the official Zendesk API mirror because
support.cronometer.com Cloudflare-gates bots): Apple Health & Apple Watch
article, Account Settings (Export Data), Health Connect, Devices Integration
Overview, Subscription Types.

- **No official public API for individuals** (confirmed; only closed partner
  integrations).
- Official CSV export: Account → Account Data → Export Data — diary entries,
  exercises, biometrics, notes, nutrition summaries; "Daily Nutrition" export
  has an *Include diary group rows* option (per-meal rows vs daily totals).
  Export is **free-tier** (not Gold-gated). Column schemas are unpublished →
  the importer maps columns by header name defensively.
- Apple Health integration is mobile-app-only; exact iOS nutrient write list
  is not officially enumerated → inspect actual source coverage at Phase 4,
  per the brief. Treat CSV as nutrition source of truth, Apple Health as a
  convenience feed.

## Function Health — FILE IMPORT (+ summary-level MCP) (Phase 4)

- **No public developer REST API.** Function launched an official MCP
  connector (Jan 2026) exposing summary-level lab data to Claude — useful as a
  supplement, not a raw-data pipeline.
- Plan: PDF/CSV import through the Phase 4 laboratory-import framework with
  user review of extracted values; member-dashboard structured export to be
  checked from a logged-in account (unverifiable without login).

## Apple Clinical Health Records — CLINICAL HEALTH RECORDS (Phase 4)

- `HKClinicalTypeIdentifier`: allergyRecord, clinicalNoteRecord,
  conditionRecord, coverageRecord, immunizationRecord, labResultRecord,
  medicationRecord, procedureRecord, vitalSignRecord — **read-only** by
  platform design. FHIR JSON via `HKFHIRResource` (DSTU2/R4 branching).
- Requires the `com.apple.developer.healthkit.access` entitlement value
  `health-records`, a usage string, and a privacy policy URL. Available in
  US/UK/Canada (One Medical and Weill Cornell are US institutions; verify
  their presence in Apple's institution directory on device).

## Apollo Neuro — APPLE HEALTH (later)

- No developer API found. Official help center describes an iOS Apple Health
  integration (Apollo usage as Mindful Minutes) — route through the Apple
  Health pipeline. (Help-center page 403'd automated fetch; verify on device.)

## Explicitly not integrated

ChatGPT Health, Counsel Health, One Medical portal, Weill Cornell/NYU portals:
not developer APIs; scraping is forbidden by our rules. The product exports
physician-ready summaries these services can consume instead.

## Web/backend stack currency (for ADR-0002/0006)

Verified 2026-08-29: Next.js stable major is **16.3.x** (App Router,
Turbopack default, `proxy.ts` replaces `middleware.ts`, async-only request
APIs, React 19.2, Node ≥ 20.9, TS ≥ 5.1). Supabase's current guidance:
`@supabase/ssr`, `auth.getClaims()` server-side (never `getSession()` alone),
RLS with `(select auth.uid())` + `TO authenticated`, CLI migrations under
`supabase/migrations`, Edge Functions remain Deno-based.
