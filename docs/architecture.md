# Architecture

Ben Health OS is two product surfaces over one normalized, source-aware health
data platform. Binding implementation detail for Phase 1 lives in
`docs/contracts/phase1-contracts.md`; decisions and their rationale live in
`docs/adr/`.

```mermaid
flowchart LR
  subgraph Devices["Ben's devices & services"]
    W[Withings BP cuff] -->|BLE| HM[Health Mate app]
    O[Oura ring] --> OA[Oura app]
    ST[Stelo sensor] --> SA[Stelo app]
    CR[Cronometer]
  end

  subgraph iOS["iPhone/iPad app (SwiftUI)"]
    HK[(Apple Health / HealthKit)]
    APP[BenHealthOS app]
    HM --> HK
    SA -->|"~3 h delay"| HK
    OA --> HK
    CR --> HK
    HK -->|anchored queries + observers| APP
  end

  subgraph Backend["services/platform (Node/TS, Fastify)"]
    API[REST API /api/v1]
    ING[Ingestion + normalization + dedup]
    CONN[Connectors: Withings (Oura P3)]
    PG[(PostgreSQL 16 · RLS · 3 data layers)]
    API --> PG
    ING --> PG
    CONN --> ING
  end

  WAPI[Withings Public API] <-->|OAuth2 · getmeas · notify webhooks| CONN
  APP -->|JWT · batches + reads| API
  WEB[Next.js 16 dashboard] -->|httpOnly-cookie proxy| API
  CSV[CSV/PDF imports P4] --> ING
```

## The platform (services/platform + packages/db)

- **Three data layers** (see docs/data-model.md): immutable
  `raw_ingest_event` → normalized observations (`blood_pressure_reading`,
  `bp_session`, …) → versioned `derived_metric`. Corrections update
  normalized rows via new raw events; nothing is silently rewritten.
- **Connectors** run server-side behind interfaces (`WithingsApi` with real
  HTTP and fake fixture implementations). Webhooks are signals to fetch, never
  trusted as records; a durable `sync_cursor` (Withings `lastupdate` ←
  response `updatetime`) heals missed deliveries.
- **Deduplication** is a first-class module executing the evidence hierarchy
  in contracts §4; canonical selection follows docs/source-priority.md and
  never deletes the losing record.
- **Freshness** is computed by one shared algorithm (contracts §3) implemented
  in `@benhealth/shared` (TypeScript) and mirrored in Swift, from
  per-connection expected latency + last success + latest measurement.
- **Security posture** (docs/security.md): RLS enforced through the
  non-bypass `benhealth_app` role with per-request `app.user_id`; OAuth tokens
  AES-256-GCM at rest; redacted logs with tests; JWT auth behind an
  AuthProvider seam (ADR-0005).

## iOS app (apps/ios)

The Apple Health gateway and primary personal surface. SwiftUI + Observation,
structured concurrency, Swift Charts. HealthKit ingestion uses persisted
anchors with observer queries + background delivery on the systolic/diastolic
quantity types (correlations don't support background delivery), then posts
normalized batches to `/api/v1/ingest/healthkit`. Manual readings can
optionally write back to Apple Health with `HKMetadataKeySyncIdentifier`
(`benhealthos.bp.*`) so ingestion suppresses self-re-import. Face ID gates the
UI; the JWT lives in Keychain; a protected JSON cache keeps the app useful
offline (ADR-0004). Demo mode runs entirely on bundled fixtures.

## Web dashboard (apps/web)

Next.js 16 App Router, TypeScript, Recharts. The browser only ever calls
Next.js route handlers, which attach the JWT from an httpOnly cookie and
proxy the platform API (ADR-0006). It renders the same normalized records and
freshness statuses as iOS — measured time first, ingestion time visible,
never "LIVE".

## Environments

- **demo** (default): zero external credentials; `WithingsFake` + synthetic
  persona fixtures; everything runnable in CI/containers.
- **production**: real Withings OAuth app + public HTTPS callback; same code
  paths, `WithingsHttp` implementation. Mocked vs sandbox (`mode=demo`
  Withings user) vs production behavior are labeled separately in test
  reports, per the brief.

## Multi-user posture

Single-user product; multi-user-safe substrate: every row carries `user_id`,
RLS isolates by user, connectors key state by connection. No UI or billing
complexity for additional users until required.
