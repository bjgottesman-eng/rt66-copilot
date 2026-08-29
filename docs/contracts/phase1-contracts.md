# Phase 1 Contracts (Normative)

This document is the single source of truth for Phase 1 ("blood pressure and
platform foundation"). The database schema, API surface, freshness model, and
deduplication rules below are binding on `packages/db`, `packages/shared`,
`services/platform`, `apps/web`, and `apps/ios`. Change via ADR, not ad hoc.

Status vocabulary, enum values, and endpoint paths are exact strings.

---

## 1. Identity and auth

Single-user product, multi-user-safe schema. Every user-data row carries
`user_id uuid`.

- **Local auth mode** (default, `PLATFORM_MODE=demo` or self-hosted): the
  platform service owns auth. On boot, if no user exists it creates one from
  `BOOTSTRAP_USER_EMAIL`/`BOOTSTRAP_USER_PASSWORD` (argon2id hash). Login
  issues a JWT (HS256, `AUTH_JWT_SECRET`, 24 h expiry, claims: `sub` =
  user_id, `email`). Web stores it in an httpOnly cookie via its own route
  handler; iOS stores it in Keychain.
- **Supabase mode** (future): the same middleware verifies Supabase JWTs via
  JWKS instead. The `AuthProvider` interface isolates this.
- RLS: the service opens each request's DB work in a transaction that first runs
  `select set_config('app.user_id', $1, true)`. Policies check
  `user_id = current_setting('app.user_id', true)::uuid`. The service's DB role
  (`benhealth_app`) is NOT `BYPASSRLS`. Only the migration runner uses the
  admin URL.

## 2. Database schema (packages/db)

PostgreSQL 16. All timestamps `timestamptz`. Migrations: numbered SQL files
`NNNN_name.sql` applied in order by the runner; recorded in
`schema_migrations(version, applied_at)`.

### Enums

```sql
create type provider as enum ('withings','apple_health','oura','stelo','cronometer','function','clinical_records','manual','benhealth');
create type connection_status as enum ('connected','error','revoked','not_connected');
create type freshness_status as enum ('CURRENT','RECENT','DELAYED_BY_SOURCE','STALE','SYNC_ERROR','NOT_CONNECTED','INSUFFICIENT_DATA');
create type processing_state as enum ('pending','processed','failed','skipped_duplicate');
create type bp_source as enum ('withings_api','apple_health','manual');
create type arm as enum ('left','right','unknown');
create type body_position as enum ('seated','standing','lying','unknown');
```

### Tables (Layer 0/1/2/3)

```sql
-- identity
app_user(id uuid pk default gen_random_uuid(), email text unique not null,
         password_hash text, created_at timestamptz default now())

-- connections & sync state
source_connection(id uuid pk, user_id uuid not null references app_user,
    provider provider not null, status connection_status not null default 'not_connected',
    external_user_id text, connected_at timestamptz, last_success_at timestamptz,
    last_error text, last_error_at timestamptz,
    expected_latency_seconds int not null default 300,
    metadata jsonb not null default '{}', created_at/updated_at,
    unique(user_id, provider))

oauth_token(id uuid pk, connection_id uuid not null references source_connection on delete cascade,
    user_id uuid not null, access_token_enc bytea not null, refresh_token_enc bytea,
    expires_at timestamptz, scopes text[], rotated_at timestamptz default now(),
    created_at)  -- enc = AES-256-GCM(TOKEN_ENC_KEY); iv||tag||ciphertext

sync_cursor(id uuid pk, connection_id uuid not null references source_connection on delete cascade,
    user_id uuid not null, cursor_type text not null,  -- e.g. 'withings_lastupdate'
    cursor_value text not null, updated_at timestamptz default now(),
    unique(connection_id, cursor_type))

-- Layer 1: immutable raw ingestion
raw_ingest_event(id uuid pk, user_id uuid not null, connection_id uuid references source_connection,
    connector provider not null, external_id text,        -- e.g. Withings grpid, HK UUID
    source_device_id text, event_type text not null,      -- 'withings.getmeas.group' | 'healthkit.bp_correlation' | 'manual.bp' | 'withings.notify'
    payload jsonb not null, payload_hash text not null,   -- sha256 hex of canonical JSON
    received_at timestamptz not null default now(), source_modified_at timestamptz,
    parser_version int not null, processing_state processing_state not null default 'pending',
    processed_at timestamptz, error text,
    unique(connector, external_id, payload_hash))
-- Rows are immutable except processing_state/processed_at/error.

-- Layer 2: normalized observations (Phase 1: blood pressure)
bp_session(id uuid pk, user_id uuid not null, started_at timestamptz not null,
    ended_at timestamptz, reading_count int not null default 0,
    avg_systolic numeric(5,1), avg_diastolic numeric(5,1), avg_pulse numeric(5,1),
    averaging_method text not null default 'mean_all',    -- 'mean_all' | 'mean_excluding_first'
    first_reading_excluded boolean not null default false,
    created_at/updated_at)

blood_pressure_reading(id uuid pk, user_id uuid not null,
    raw_event_id uuid references raw_ingest_event,
    session_id uuid references bp_session,
    measured_at timestamptz not null, measured_tz text,   -- IANA tz if known
    systolic_mmhg numeric(5,1) not null check (systolic_mmhg between 40 and 300),
    diastolic_mmhg numeric(5,1) not null check (diastolic_mmhg between 20 and 200),
    pulse_bpm numeric(5,1) check (pulse_bpm between 20 and 250),
    source bp_source not null, source_app text, source_device text,
    external_group_id text,                               -- Withings grpid / HK correlation UUID
    arm arm default 'unknown', body_position body_position default 'unknown',
    seated_rest_minutes numeric(4,1), reading_number_in_session int, note text,
    canonical boolean not null default true,
    duplicate_of uuid references blood_pressure_reading, dedup_reason text,
    quality_flags text[] not null default '{}',           -- e.g. 'implausible_value'
    created_at/updated_at, deleted_at timestamptz)        -- soft delete only

-- Layer 3: derived analytics
derived_metric(id uuid pk, user_id uuid not null, algorithm text not null,
    algorithm_version int not null, metric_key text not null,   -- e.g. 'bp.7d_avg_systolic'
    period_start timestamptz not null, period_end timestamptz not null,
    value jsonb not null, unit text, confidence text,           -- 'high'|'medium'|'low'
    coverage numeric(4,3),                                      -- 0..1 completeness
    input_ids uuid[] not null default '{}', computed_at timestamptz default now(),
    invalidated_at timestamptz)

-- audit
audit_log(id bigint pk generated always as identity, user_id uuid, actor text not null,
    action text not null, entity text, entity_id text, at timestamptz default now(),
    details jsonb not null default '{}')  -- details MUST be pre-redacted; no tokens/health values

-- webhook journal (idempotency)
webhook_delivery(id uuid pk, provider provider not null, delivery_hash text not null,
    received_at timestamptz default now(), status text not null,  -- 'accepted'|'duplicate'|'failed'
    unique(provider, delivery_hash))
```

RLS enabled on every table with `user_id` (webhook_delivery and
schema_migrations are service-internal; RLS denies non-service access).
`oauth_token` additionally denies SELECT of token columns to the app role via a
security-barrier view? No — simpler binding rule: **the API layer never
serializes oauth_token rows**; tokens are decrypted only inside the connector
module, and log redaction tests enforce absence.

## 3. Freshness model (packages/shared, mirrored in Swift)

Inputs: `connectionStatus`, `lastSuccessAt`, `latestMeasuredAt`,
`expectedLatencySeconds`, `now`.

```
if connectionStatus == 'not_connected'            -> NOT_CONNECTED
if connectionStatus == 'error'                    -> SYNC_ERROR
if latestMeasuredAt == null                       -> INSUFFICIENT_DATA
age = now - latestMeasuredAt
if age <= max(2 * expectedLatency, 15 min)        -> CURRENT
if age <= 24 h                                    -> RECENT
if age <= 72 h and (now - lastSuccessAt) <= 6 h   -> DELAYED_BY_SOURCE   # connector fine, source quiet
else                                              -> STALE
```

The word "LIVE" is forbidden in all UI copy.

## 4. Deduplication (services/platform, module `dedup`)

Runs at normalization time; never deletes raw rows. Evidence hierarchy:

1. same connector + same `external_id` (exact) → raw-level duplicate → new raw
   row recorded, normalization skipped (`skipped_duplicate`).
2. same connector + same `external_group_id` (Withings grpid, HK correlation
   UUID) → same measurement group.
3. same `payload_hash` → duplicate.
4. same metric + `measured_at` (exact) + values + source device → duplicate.
5. cross-source: |Δ measured_at| ≤ 180 s AND systolic equal AND diastolic
   equal (integers after rounding) AND (pulse both null or |Δ| ≤ 5) →
   cross-source duplicate.
6. user-confirmed (Phase 2 UI).

Canonical priority for BP: `withings_api` > `apple_health` > `manual`.
The loser gets `canonical=false, duplicate_of=<winner>, dedup_reason=<rule>`.
If the canonical record arrives AFTER the duplicate (e.g. Apple Health first,
Withings API later), canonicality is transferred: the new row becomes
canonical, the older row is demoted. Analytics and API responses include only
`canonical and deleted_at is null` unless `includeDuplicates=true`.

Session grouping: consecutive canonical readings for a user with gaps ≤ 15 min
form one `bp_session`; recomputed idempotently after each ingest batch.
`mean_excluding_first` is used when the session has ≥ 3 readings, else
`mean_all`; both stored, method recorded.

## 5. Platform API (services/platform, prefix `/api/v1`)

Auth: `Authorization: Bearer <jwt>` (web proxies via httpOnly cookie).
Errors: `{ "error": { "code": string, "message": string } }`, proper status.
All response times ISO-8601 UTC.

```
POST /auth/login              {email,password} -> {token, user:{id,email}}
GET  /auth/me                 -> {id,email}

GET  /bp/latest               -> { reading: BpReadingDto | null, freshness: FreshnessDto }
GET  /bp/readings?from&to&includeDuplicates -> { readings: BpReadingDto[] }
GET  /bp/sessions?from&to     -> { sessions: BpSessionDto[] }   # includes readings inline
GET  /bp/summary?window=7d|30d -> BpSummaryDto                  # trend, morning/evening split
POST /bp/manual               ManualBpEntry -> { reading: BpReadingDto }

GET  /sources                 -> { sources: SourceStatusDto[] } # one per provider incl. NOT_CONNECTED
POST /sources/withings/connect -> { authorizeUrl }              # state persisted server-side
GET  /integrations/withings/callback?code&state                 # OAuth redirect target (302 back to app)
POST /sources/withings/refresh -> { imported: number }          # on-demand manual refresh
POST /sources/withings/backfill {sinceDays?} -> { imported }    # historical import

HEAD /webhooks/withings       -> 200                            # Withings callback validation
POST /webhooks/withings       (x-www-form-urlencoded) -> 200 fast; async fetch via getmeas

POST /ingest/healthkit        HealthKitBpBatch -> { accepted, duplicates }
POST /demo/seed               (demo mode only) -> { seeded: true }
GET  /health                  -> { ok: true }                   # liveness, unauthenticated
```

### DTOs (packages/shared — exact field names)

```ts
BpReadingDto { id, measuredAt, measuredTz, systolic, diastolic, pulse,
  source: 'withings_api'|'apple_health'|'manual', sourceApp, sourceDevice,
  sessionId, arm, bodyPosition, note, canonical, duplicateOf, ingestedAt }

BpSessionDto { id, startedAt, endedAt, readingCount, avgSystolic, avgDiastolic,
  avgPulse, averagingMethod, firstReadingExcluded, readings: BpReadingDto[] }

BpSummaryDto { window, from, to, readingCount, sessionCount,
  meanSystolic, meanDiastolic, meanPulse, morning: {...same means}, evening: {...},
  daily: [{date, meanSystolic, meanDiastolic, sessionCount}] }
  # morning = 04:00–11:59 local (measured_tz or UTC fallback); evening = 17:00–23:59

FreshnessDto { status: FreshnessStatus, latestMeasuredAt, lastSuccessAt,
  expectedLatencySeconds, ageSeconds }

SourceStatusDto { provider, displayName, connectionStatus, freshness: FreshnessDto,
  latestMeasuredAt, lastSyncAt, coverageNote, problems: string[] }

ManualBpEntry { systolic, diastolic, pulse?, measuredAt, measuredTz?,
  arm?, bodyPosition?, seatedRestMinutes?, readingNumberInSession?, note?,
  saveToAppleHealth?: boolean }   # flag echoed for iOS to act on; server just stores

HealthKitBpBatch { deviceAnchor?: string, samples: [{ hkUuid, measuredAt, measuredTz?,
  systolic, diastolic, pulse?, sourceApp, sourceDevice, sourceBundleId }] }
```

## 6. Withings connector (services/platform, module `connectors/withings`)

Behind interface `WithingsApi`:

```ts
interface WithingsApi {
  authorizeUrl(state: string): string
  exchangeCode(code: string): Promise<WithingsTokens>
  refresh(refreshToken: string): Promise<WithingsTokens>   // rotation: ALWAYS persist new pair atomically before using
  getMeasures(accessToken: string, opts: {lastupdate?: number, startdate?: number, enddate?: number}): Promise<WithingsMeasureGroup[]>
  subscribe(accessToken: string, callbackUrl: string, appli: number): Promise<void>
}
```

Two implementations: `WithingsHttp` (real, endpoints/scopes per
`docs/integrations.md`) and `WithingsFake` (in-memory fixture server used in
demo mode and tests; serves the synthetic persona, supports injected webhook
notifications, duplicate deliveries, and corrected measurements).

Sync algorithm (idempotent, durable):
1. Webhook POST arrives → hash body → insert `webhook_delivery` (unique) →
   if duplicate, 200 and stop. Else 200 immediately, then process async.
2. Read `sync_cursor['withings_lastupdate']` (epoch seconds, 0 if absent).
3. `getmeas(lastupdate=cursor)` → for each measure group: insert
   `raw_ingest_event` (external_id = grpid; dup-safe) → normalize → dedup.
4. Advance cursor to the max of (server-reported time, group modified times),
   only after the batch commits. Missed webhooks are healed by the next
   webhook or manual refresh because the cursor is durable.
5. Historical backfill uses `startdate/enddate` windows, same normalization.

Token handling: refresh 60 s before expiry; on refresh response persist new
access+refresh atomically (Withings rotates refresh tokens); on `invalid_grant`
mark connection `error` and surface `SYNC_ERROR`. Tokens never appear in logs —
logger redaction test asserts this.

## 7. Demo mode

`PLATFORM_MODE=demo`: bootstrap user `demo@benhealth.local` / `demo-password`
(overridable), `WithingsFake` active, `POST /demo/seed` loads
`fixtures/demo-persona/*` (90 days of synthetic BP: 2 sessions/day of 2–3
readings, realistic drift, a handful of Apple Health cross-source duplicates,
one corrected Withings measurement, gaps). Web and iOS run fully against demo
mode with zero external credentials.

## 8. Ports & processes (dev)

- Postgres: 127.0.0.1:55432 (`postgres` superuser for admin; `benhealth_app` role for service)
- Platform: http://localhost:8787
- Web: http://localhost:3000

## 9. Testing floor (Phase 1 acceptance)

- migrations from clean DB; re-run is a no-op
- RLS: user A cannot read user B's rows through the app role
- webhook: duplicate delivery processed once; out-of-order safe; HEAD 200
- token rotation: refresh persists new pair; old refresh token never reused
- dedup: all seven scenarios in the build brief §13 have tests
- freshness: table-driven tests over the §3 algorithm (shared TS impl)
- summary: 7d/30d math, morning/evening split, DST boundary test (America/New_York)
- no-zero rule: absent pulse stays null end-to-end
- log redaction: request logs contain no token, secret, or BP values
