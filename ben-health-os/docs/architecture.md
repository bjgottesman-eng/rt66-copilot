# Architecture

## Components

```
┌──────────────────────────┐      HTTPS (JWT)      ┌──────────────────────────────┐
│ Android app (Kotlin)     │ ───────────────────▶  │ API service (Fastify, TS)    │
│  Health Connect reader   │  ingest batches,      │  auth · ingest · dashboard   │
│  Room cache · WorkManager│  sync reports,        │  sources · measurements      │
│  Biometric lock · Keystore│ dashboard reads      │  export/delete · demo        │
└──────────────────────────┘                       │          │                   │
┌──────────────────────────┐   same-origin proxy   │   services/analytics (TS)   │
│ Web dashboard (Next.js)  │ ───────────────────▶  │   one calculation engine    │
│  renders only            │  httpOnly cookie      └──────────┬───────────────────┘
└──────────────────────────┘                                  │ pg (role authenticated + RLS)
                                                   ┌──────────▼───────────────────┐
                                                   │ PostgreSQL 16 / Supabase     │
                                                   │ raw events · normalized rows │
                                                   │ derived metrics · RLS        │
                                                   └──────────────────────────────┘
services/integrations (Oura/Withings OAuth + webhooks, Phase 2) → same persistence pipeline
```

### Android app (`apps/android`)
- Layers: `presentation` (Compose screens, view models) → `domain` (repositories, shared config)
  → `data` (Room cache, DataStore settings, API client, sync) → `integrations/healthconnect`
  (SDK wrapper + mapper) → `security` (Keystore cipher, secure store, biometric gate).
- Health Connect sync (`HealthConnectSyncer`): availability check → granted permissions → per
  record type backfill in 7-day windows (30 days, 365 with history permission) → change token
  → incremental `getChanges` loops; deletions soft-delete linked rows server-side; offline batches
  queue in Room (`pending_uploads`) and replay later (server is idempotent); every attempt ends with
  a sync report so the backend can explain staleness and revoked permissions.
- Background: `SyncWorker` every 4 hours (network constraint) plus on-demand; Android decides
  when it runs. Reads in the background require `READ_HEALTH_DATA_IN_BACKGROUND`; without it,
  sync runs when the app is open (onboarding and the Today refresh button).
- Offline: last Today/Sources/series responses cached in Room; single-value readings cached for
  display; cached data is labelled with its fetch time, never presented as live.
- Security: session token encrypted with an Android Keystore AES-GCM key; app excluded from
  backups; biometric/device-credential lock after 60 s in background; no analytics SDKs.

### Web dashboard (`apps/web`)
- Server components call the API with the session token from an httpOnly cookie; client
  components call `/api/proxy/v1/*`, a same-origin forwarder, so the token never reaches JS.
- Screens: Today (five domains), Trends (daily + raw with duplicates hollow), Blood pressure,
  Data Sources, Settings, Nutrition (Phase 4), Labs / Medications / Preventive / Physician brief
  (Phase 5), Health CEO reports and Inbox (recommendations, alerts, memory; Phase 6); Training /
  Experiments are explicit NOT IMPLEMENTED pages until Phase 7.
- No health math in the browser; the dashboard renders exactly what the API computed.

### API service (`services/api`)
- Every user request runs inside a transaction as role `authenticated` with
  `request.jwt.claims` set from the verified JWT (`withUser`), so RLS applies identically to local
  Postgres and hosted Supabase. Service-role work is limited to audit logging and local-mode
  user creation.
- Ingest pipeline (`services/ingest.ts`): raw event (immutable, hashed) → normalization
  (`services/normalize.ts`) → typed rows + universal `observations` → cross-source dedup →
  daily activity recompute → sync run + connection status + change-token cursors.
- Dashboard (`services/dashboard.ts`): loads canonical observations for the last 35 local days,
  aggregates per catalog rule (steps by origin priority, never summed), computes 7-day vs
  preceding 28-day comparisons, freshness and domain status through `services/analytics`.

### Connectors (`services/integrations` + `services/api/src/services/connectors.ts`)
Pure clients/mappers (injectable fetch, retry with backoff, pagination) produce the same
connector-neutral `ExternalRecordInput` that Health Connect records are converted into, so one
`persistRecords` pipeline handles raw events, typed rows, observations, dedup and daily recompute for
every source. The API owns OAuth state (PKCE), encrypted tokens with single-use refresh rotation,
initial imports, webhook verification (Oura HMAC, Withings HEAD) and replay-safe processing
(`webhook_events` dedupe keys), reconciliation (`/v1/sources/:connector/refresh`, `/internal/jobs/reconcile`).

### Analytics (`services/analytics`)
The single authoritative implementation of: local-day bucketing (record zone offset first, user
zone second, DST-safe), unit normalization (errors on incompatible units), statistics, window
stats and baseline classification, freshness, payload hashing and dedup matching, source
priority, plausibility flags, blood-pressure sessions and morning/evening split, domain status.

### Derived metrics and signals (Phase 3, `services/api/src/services/derived.ts`)
`POST /v1/analytics/derive` (per user) and `POST /internal/jobs/derive` (all users, `JOB_SECRET`)
persist, for the latest complete local day: window statistics for 7/28/90/365 days
(`derived_metrics`, algorithm `window_stats` v1), the 7-vs-28-day baseline comparison
(`baseline_7_vs_28` v1), deterministic signals (`signals`, `signal_engine` v1) and Zone 2 minutes
per workout (`zone2_minutes` observations with `DERIVED:` quality flags, from heart-rate samples and
the profile max HR or Tanaka estimate). Rows are keyed by algorithm version so a new version never
overwrites history. `GET /v1/analytics/trends/:metric` returns the windows, confidence, 365-day
percentile, series and signals; `GET /v1/analytics/signals` returns the latest persisted signals.
The demo seed and connector imports trigger a derive run; schedule the job nightly in production.

## Freshness (ADR 0005)
Every metric card carries measured-at, source-updated-at, ingested-at, expected latency and a
status with a reason: CURRENT, RECENT, SOURCE_DELAYED, STALE, SYNC_ERROR, NOT_CONNECTED,
INSUFFICIENT_DATA. Thresholds are per metric in `packages/shared-config/src/freshness.ts`.

## Baselines (spec §16)
The 7-day window is the latest seven complete local days; the baseline is the 28 days ending the
day before the window starts (never overlapping). Minimum coverage per metric gates any
conclusion; change classes are MEANINGFUL, DIRECTIONAL, NOISE or INSUFFICIENT_EVIDENCE with the
rule stated in the explanation string. Missing days are missing; the only zero-fill is for workout
metrics on days where the sources were demonstrably recording.

## Time and zones
Observations store the instant (timestamptz), the source zone offset when the record carried one,
and the derived `local_date`. DST days are 23/25 hours long and are bucketed correctly (tests in
`services/analytics/test/time.test.ts`).

## Reliability
- Ingest is idempotent: same id + same hash is a no-op; same id + new hash is an update that
  supersedes (never deletes) the previous raw event; deletions are soft.
- Partial failures are per record (savepoints) and reported back as `rejected[]`.
- Sync runs, cursors and connection status are persisted; the Data Sources screen shows them.

## Deployment shape
- API: any Node 22 host/container with `DATABASE_URL` and `AUTH_MODE=supabase` (see
  `docs/environment.md`). Web: Node host or Vercel-style platform with `API_BASE_URL`.
- Database: Supabase project (migrations applied with `supabase db push` or the included runner).
- Scheduled jobs (Phase 2 reconciliation, Phase 6 reports): pg_cron + pg_net on Supabase, or a
  container cron hitting internal endpoints.
