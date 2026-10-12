# Ben Health OS — working agreement for engineers and AI agents

Ben Health OS is a private personal health operating system: a native Android app (Health Connect
ingestion gateway), a Next.js web dashboard, and a Postgres/Supabase-style backend with one
authoritative analytics implementation. Read `docs/architecture.md` first, then `docs/roadmap.md`.

## Non-negotiables
- **No invented data.** Nothing is shown as connected, live or current unless auth and data retrieval
  actually succeeded. Missing data is missing, never zero. Status labels are literal:
  IMPLEMENTED / TESTED WITH MOCK DATA / TESTED ON PHYSICAL DEVICE / TESTED AGAINST LIVE API /
  BLOCKED BY CREDENTIALS / NOT IMPLEMENTED (see `docs/testing.md`).
- **One calculation implementation.** All health math lives in `services/analytics` and runs in the
  backend. The web app renders; the Android app renders and caches. Thresholds/catalogs come from
  `packages/shared-config` (TypeScript source → generated JSON for Android).
- **Provenance everywhere.** Raw ingest events are immutable; normalized rows keep connector, data
  origin (Android package), device, recording method, measured/modified/ingested timestamps.
- **Dedup, never delete.** Exact id → payload hash → conservative cross-source match. Duplicates are
  linked (`canonical=false`, `duplicate_of`), never removed. Steps are never summed across origins.
- **Safety.** No diagnosis, no medication changes, no causal claims from correlation. AI output is
  labelled MEASURED FACT / DERIVED TREND / HYPOTHESIS / RECOMMENDATION and must cite observations.
- **Privacy.** RLS on every user table; secrets server-side; tokens encrypted at rest; no health
  values in logs or notifications; export-all and delete-all always work. Real personal records are
  never committed; tests and demos use `@bho/fixtures` synthetic data only.
- **Verify integrations against official docs** before coding (`docs/research/*`, `docs/integrations.md`).
  Never scrape portals or reverse-engineer auth.

## Layout
```
apps/android      Kotlin + Compose + Health Connect SDK 1.1.0 + Room + WorkManager
apps/web          Next.js 15 App Router + Tailwind 4 + Recharts (no health math)
services/api      Fastify API: auth (local/Supabase JWT), ingest, dashboard, sources, export/delete
services/analytics  Authoritative calculations (time zones, units, windows, freshness, dedup, BP)
services/integrations  Phase 2+: Oura, Withings, imports (OAuth + webhooks)
services/ai       Phase 6: analysis packets + provider adapters (contracts only until then)
packages/contracts  Zod schemas / types for every API payload (mirrored by Kotlin DTOs)
packages/shared-config  Freshness thresholds, source priority, dedup windows, metric catalog, connectors
supabase/migrations  SQL schema + RLS; supabase/local = Postgres-only auth shim for dev/tests
fixtures          Deterministic synthetic data generator + committed demo dataset
docs              Architecture, data model, integrations, security, ADRs, roadmap, testing
scripts           db-migrate / db-reset / e2e / verify
```

## Commands
```
pnpm install                       # workspace
pnpm run db:reset                  # local Postgres: drop/create + shim + migrations
pnpm test                          # builds packages, runs all vitest suites (API needs Postgres)
pnpm run dev:api / dev:web         # local development (AUTH_MODE=local)
pnpm run verify                    # scripts/verify.sh: everything incl. Android + Playwright
cd apps/android && ./gradlew :app:assembleDebug :app:testDebugUnitTest
```

## Conventions
- TypeScript strict, ESM, `.js` extensions on relative imports, zod at every boundary.
- SQL migrations are append-only timestamped files; never edit an applied migration.
- Derived metrics are versioned (`algorithm`, `algorithm_version`); never overwrite in place.
- Kotlin: clean layers (`presentation`/`domain`/`data`/`integrations`/`security`), coroutines + Flow,
  no DI framework (manual `AppContainer`).
- Commit messages: imperative, scoped (`api:`, `android:`, `web:`, `docs:`).
