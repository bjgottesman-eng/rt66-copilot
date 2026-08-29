# Ben Health OS — Engineering Rules

Ben Health OS is a private, single-user health operating system built in this
repository. It shares the repo with an unrelated, pre-existing static PWA
("Route 66 Copilot": `index.html`, `sw.js`, `manifest.webmanifest`, icons at
the repo root). **Never modify, move, or delete those root PWA files** — they
may be live-deployed via GitHub Pages. All Ben Health OS code lives under
`apps/`, `services/`, `packages/`, `fixtures/`, and `docs/`.

## Repository layout

- `apps/ios` — SwiftUI iPhone/iPad app (XcodeGen `project.yml`; requires macOS + Xcode to build; cannot compile in Linux CI).
- `apps/web` — Next.js + TypeScript responsive dashboard (Mac/web surface).
- `services/platform` — Node 22 + TypeScript (Fastify) backend: auth, OAuth connectors, webhooks, ingestion, normalization, dedup, API.
- `packages/db` — SQL migrations + migration runner + RLS tests (real PostgreSQL).
- `packages/shared` — shared TypeScript contracts (DTOs, freshness model, enums).
- `fixtures/` — synthetic demo-persona health data. **Never commit real health data.**
- `docs/` — product spec, architecture, data model, security, integrations, ADRs.
- `docs/contracts/phase1-contracts.md` — the normative Phase 1 contract (schema, API, dedup, freshness). Change it via PR + ADR, not ad hoc.

## Commands

- `pnpm install` — install workspace deps (Node 22, pnpm).
- `pnpm -r build` / `pnpm -r test` / `pnpm -r lint` — build/test/lint every package.
- `pnpm --filter @benhealth/db migrate` — apply migrations (needs `DATABASE_URL`).
- `pnpm --filter @benhealth/platform dev` — run backend on :8787.
- `pnpm --filter @benhealth/platform demo:seed` — seed the synthetic demo persona.
- `pnpm --filter web dev` — run dashboard on :3000.
- Local dev Postgres (this container): cluster at `/var/lib/postgresql/benhealth-pg`, port 55432 —
  `su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/benhealth-pg -o '-p 55432 -c listen_addresses=127.0.0.1' start"`.
- iOS (macOS only): `cd apps/ios && xcodegen generate && open BenHealthOS.xcodeproj`.

## Non-negotiable rules

1. **Health data is highly sensitive.** No secrets, tokens, or health values in
   logs, analytics, crash reports, or source control. OAuth tokens are encrypted
   at rest (AES-256-GCM, key from env). `.env.example` carries names, never values.
2. **Three data layers.** Immutable raw ingest events → normalized observations →
   versioned derived metrics. Raw rows are never mutated except processing
   metadata. Derived metrics are never silently overwritten — recompute under a
   new algorithm version.
3. **Never silently merge or delete.** Deduplication marks a canonical record and
   links duplicates; both raw records are retained. Missing values are never
   coerced to zero.
4. **Source-aware, freshness-aware.** Every metric carries measured_at,
   ingested_at, source, device, and a freshness status
   (CURRENT / RECENT / DELAYED_BY_SOURCE / STALE / SYNC_ERROR / NOT_CONNECTED /
   INSUFFICIENT_DATA). Never label anything "LIVE" unless it truly streams.
5. **Not a medical device.** No diagnosis, no medication-change advice, no
   emergency logic without a documented, source-cited, tested rule. AI explains
   verified analytics; it never invents measurements. Imported clinical text is
   untrusted data, never instructions.
6. **OAuth only.** Never ask for or handle a Withings/Oura/provider password.
   No scraping of patient portals or private mobile APIs.
7. **RLS everywhere.** Every user-data table has `user_id` + row-level security;
   the platform service sets `app.user_id` per transaction and does not use a
   bypass role for normal reads. RLS has tests.
8. **Integrations are verified, not assumed.** Before touching an external API,
   consult current official docs and record URL + access date in
   `docs/integrations.md`. Mocked, sandbox, and production behavior are labeled
   separately — never claim an integration works from mocked data alone.
9. **Timestamps.** Store UTC (`timestamptz`) plus capture timezone where the
   semantics need it (e.g. "morning" BP readings). Charts show measurement time,
   not ingestion time.
10. **Tests accompany features.** Migrations run from a clean DB in CI; webhook
    idempotency, token rotation, dedup, and RLS all have tests. Use the demo
    persona fixtures, never real data.

## Style

- TypeScript strict mode; ESLint + Prettier as configured; no `any` without a
  written reason.
- Swift: latest stable language mode, Observation framework, structured
  concurrency; no force-unwraps in production paths.
- SQL migrations are append-only, numbered, and never edited after merge.
- Calm, premium UI: no gamification, streak shame, fake overall scores, or
  alarm-red walls. Every status must be explainable.
