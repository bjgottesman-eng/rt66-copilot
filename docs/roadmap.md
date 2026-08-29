# Ben Health OS — Phased Delivery Roadmap

Derived from the build brief (§27–§29). The normative technical contract for
Phase 1 is `docs/contracts/phase1-contracts.md`; where this roadmap and the
contracts disagree, the contracts win.

## Current status (2026-08-29)

**Phase 0 and Phase 1 are being built now**, concurrently, on branch
`ben-health-os`. Phase 0 documentation and the Phase 1 platform foundation
(DB migrations, shared contracts, platform service, web dashboard, iOS shell,
demo persona fixtures) are in active development. No later phase has started.

**Maintenance rule:** update this file at every phase boundary — when a phase
starts, and again when its exit criteria are met — recording the date, what
was actually delivered vs. planned, and any scope moved between phases.

---

## Phase 0 — Feasibility & architecture docs

**Scope:** product-spec, architecture, data-model, security, integrations,
source-priority, recommendation-safety, roadmap (this file), ADRs, root
`CLAUDE.md`. The integrations doc classifies every source as one of:
VERIFIED DIRECT API / APPLE HEALTH / CLINICAL HEALTH RECORDS / FILE IMPORT /
MANUAL ENTRY / NOT CURRENTLY SUPPORTED, with official-doc URLs and access
dates.

- **Entry:** repo scaffolded; brief and contracts agreed.
- **Exit:** all docs above exist and are internally consistent with
  `phase1-contracts.md`; each integration classification is backed by a cited
  source; ADRs cover auth mode, three-layer data model, and dedup policy.

## Phase 1 — Blood pressure + platform foundation

**Scope:** iOS SwiftUI shell with secure auth and local cache; Fastify
backend with numbered SQL migrations and RLS; source-connection model;
Withings OAuth (tokens AES-256-GCM at rest, safe rotation); historical
import; webhook ingestion with durable `lastupdate` cursor; Apple Health BP
fallback ingest; manual entry; deduplication (raw retained, canonical
marked); BP screen with source/device/measured/ingested/freshness; minimal
web BP dashboard; demo mode with synthetic persona; automated tests. First
production-quality milestone.

- **Entry:** Phase 0 contracts stable; Postgres 16 available.
- **Exit:** the full acceptance checklist below passes (in the environments
  where each item is verifiable).

### Phase 1 acceptance checklist (brief §28)

Legend — each item is tagged with where it can be verified:
**[LINUX]** verifiable in this Linux container (Node 22, pnpm, real
PostgreSQL 16 at 127.0.0.1:55432, no external network credentials).
**[MACOS]** requires macOS + stable Xcode (iOS compile, Simulator).
**[IPHONE]** requires a physical iPhone (HealthKit hardware, device signing).
**[WITHINGS]** requires a registered Withings developer app, real user
credentials, and a public HTTPS callback URL reachable by Withings.

#### iOS

- [ ] App compiles with installed stable Xcode — **[MACOS]** (XcodeGen
  project; cannot compile on Linux)
- [ ] Demo mode runs in Simulator against local backend — **[MACOS]**
- [ ] Runs on physical device when signing is available — **[IPHONE]**
- [ ] Withings connection is OAuth-only (no password handling) — code review
  possible **[LINUX]**; end-to-end flow **[WITHINGS]**
- [ ] Historical import of Withings BP works — against `WithingsFake`
  **[LINUX]**; against real API **[WITHINGS]**
- [ ] Mocked webhook delivery is idempotent (duplicate delivery processed
  once, HEAD 200) — **[LINUX]**
- [ ] Genuine new measurement flows in via real webhook when credentials
  available — **[WITHINGS]** (registered app + public HTTPS callback; cannot
  be simulated honestly)
- [ ] Latest reading shows source, device, measured_at, ingested_at, and
  freshness status — backend/DTO level **[LINUX]**; iOS UI **[MACOS]**
- [ ] Apple Health BP import works on device — **[IPHONE]** (HealthKit is
  unavailable off-device); the `/ingest/healthkit` endpoint itself is
  testable with fixture batches **[LINUX]**
- [ ] Withings-API + Apple Health duplicates are not double-counted —
  **[LINUX]** (fixture-driven dedup tests, brief §13 scenarios)
- [ ] Manual entry works — API path **[LINUX]**; iOS form **[MACOS]**
- [ ] Optional Apple Health write-back tested separately — **[IPHONE]**
- [ ] Charts show history and session averages — web charts **[LINUX]**
  (build + tests; visual check in browser); iOS charts **[MACOS]**
- [ ] App remains usable when Withings is unavailable (SYNC_ERROR surfaced,
  no crash) — backend behavior **[LINUX]**; iOS behavior **[MACOS]**
- [ ] Sync failures clearly identified (never mislabeled as fresh) —
  **[LINUX]** freshness-algorithm table tests; UI verification **[MACOS]**

#### Backend

- [ ] Migrations apply from a clean DB; re-run is a no-op — **[LINUX]**
- [ ] RLS tests: user A cannot read user B's rows through `benhealth_app` —
  **[LINUX]**
- [ ] Tokens never appear in logs (redaction tests) — **[LINUX]**
- [ ] Safe refresh rotation: new access+refresh persisted atomically; old
  refresh token never reused — **[LINUX]** against `WithingsFake`; real
  rotation semantics confirmed only **[WITHINGS]**
- [ ] Webhooks idempotent (`webhook_delivery` unique hash journal) —
  **[LINUX]**
- [ ] Required request validation on all endpoints — **[LINUX]**
- [ ] Missed webhook recovered via durable `sync_cursor` on next
  webhook/manual refresh — **[LINUX]** (simulated); real missed-webhook
  healing **[WITHINGS]**
- [ ] Raw ingest events vs. normalized readings kept distinct; raw immutable —
  **[LINUX]**
- [ ] Duplicate processing tested (all seven brief-§13 dedup scenarios,
  including late canonical-source arrival transferring canonicality) —
  **[LINUX]**
- [ ] `.env.example` contains names only, no values — **[LINUX]**

#### Web

- [ ] Secure auth (JWT via httpOnly cookie proxy) — **[LINUX]**
- [ ] Web shows the same normalized records as iOS (single API) — **[LINUX]**
- [ ] Source + freshness displayed for every metric — **[LINUX]**
- [ ] Responsive in Safari — layout testable **[LINUX]**; genuine Safari
  check requires macOS/iOS **[MACOS]**

#### Quality

- [ ] Unit + integration tests pass (`pnpm -r test`) — **[LINUX]**
- [ ] Formatter/linter passes (`pnpm -r lint`) — **[LINUX]**
- [ ] No hardcoded production secrets (secret scan) — **[LINUX]**
- [ ] README with complete setup instructions — **[LINUX]**
- [ ] Honest known-limitations section; mocked / sandbox / production
  behavior labeled separately in `docs/integrations.md` — **[LINUX]**
- [ ] Timezone/DST boundary test (America/New_York) for morning/evening
  split — **[LINUX]**
- [ ] No-zero rule: absent pulse stays null end-to-end — **[LINUX]**

**Explicitly out of reach in this Linux environment:** anything requiring
Xcode/Simulator (iOS compile & UI), a physical iPhone (HealthKit read/write,
device signing), or Withings production behavior (genuine webhook delivery,
real token rotation against Withings servers, public HTTPS callback
registration). These are tracked as open items, never claimed as verified
from mocks alone (CLAUDE.md rule 8).

## Phase 2 — Apple Health executive dashboard

**Scope:** steps, activity, workouts, sleep, heart rate, resting HR, HRV,
weight/body composition, glucose via Apple Health; personal baseline engine;
five-domain dashboard; data-quality screen.

- **Entry:** Phase 1 exit; HealthKit ingest pipeline proven for BP.
- **Exit:** all listed metric types normalized with provenance and freshness;
  baseline engine has trend tests; data-quality screen explains every gap.

## Phase 3 — Oura direct integration

**Scope:** Oura OAuth + webhooks, sleep/readiness/activity scores,
stress/recovery, dedup against Apple Health-relayed Oura data, freshness.

- **Entry:** Phase 2 exit; Oura API verified in `docs/integrations.md`.
- **Exit:** direct Oura data flows with cross-source dedup tested; webhook
  idempotency and cursor recovery mirror the Withings pattern.

## Phase 4 — Nutrition + labs

**Scope:** Cronometer via Apple Health + CSV import; general lab-result
framework; Function Health import; Clinical Health Records ingestion; Lab
Explorer UI.

- **Entry:** Phase 3 exit; file-import parsing hardened (corrupted-import
  tests).
- **Exit:** labs normalized with units/reference ranges; imported clinical
  text treated as untrusted data; Lab Explorer ships.

## Phase 5 — Medication + physician workflow

**Scope:** medication reconciliation, preventive-care tracking, Physician
Brief, PDF export.

- **Entry:** Phase 4 exit (labs/clinical records available to reconcile).
- **Exit:** reconciliation flows tested; Physician Brief PDF renders from
  verified data only.

## Phase 6 — Signals + recommendations

**Scope:** deterministic signal engine, recommendation inbox, AI context
packet, structured AI narrative, weekly Health CEO and monthly Health Board
reports. AI never precedes dependable provenance and data quality —
this phase is gated on Phases 1–5 quality bars.

- **Entry:** Phase 5 exit; recommendation-safety doc enforced by tests.
- **Exit:** every signal rule documented, source-cited, and tested; AI
  explains verified analytics and never invents measurements.

## Phase 7 — Experiments engine

**Scope:** structured n-of-1 health experiments (hypothesis, protocol,
measurement windows, honest inconclusive outcomes).

- **Entry:** Phase 6 exit.
- **Exit:** experiment lifecycle tested end-to-end on the demo persona.

## Phase 8 — Polish

**Scope:** widgets, App Intents, shortcuts, notifications, PDF improvements,
Apple Watch companion, offline support, App Store preparation.

- **Entry:** Phase 7 exit.
- **Exit:** release-candidate build; App Store checklist complete
  (macOS/device work throughout).
