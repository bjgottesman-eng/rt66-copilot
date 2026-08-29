# This repository

Two independent projects live here:

1. **Route 66 Copilot** — the pre-existing static PWA at the repository root
   (`index.html`, `sw.js`, `manifest.webmanifest`, icons). Untouched by
   everything below; see ADR-0001.
2. **Ben Health OS** — a private, source-aware personal health operating
   system (everything under `apps/`, `services/`, `packages/`, `fixtures/`,
   `docs/`). The rest of this README is about it.

# Ben Health OS

A private, single-user health platform that turns fragmented health data
(Withings blood pressure, Apple Health, Oura, Stelo CGM, Cronometer, labs,
clinical records) into one longitudinal record with honest, source-aware
freshness — answering: *what has changed, what matters, and what should I do
next?*

**Current status: Phase 1 — blood pressure + platform foundation.** See
`docs/roadmap.md` for the phase plan and `docs/brief/build-brief-v2.md` for
the full product brief. It is a wellness product, not a medical device: no
diagnosis, no medication advice (docs/recommendation-safety.md).

## Layout

| Path | What |
|---|---|
| `services/platform` | Node 22 + Fastify backend: auth, Withings OAuth + webhooks, ingestion, normalization, dedup, API |
| `packages/db` | PostgreSQL 16 migrations, RLS, migration runner |
| `packages/shared` | Shared TypeScript contracts: DTOs, enums, freshness engine |
| `apps/web` | Next.js 16 dashboard (Safari/Mac-first, responsive) |
| `apps/ios` | SwiftUI iPhone/iPad app (XcodeGen; builds on macOS only) |
| `fixtures/demo-persona` | Synthetic 90-day BP dataset (fictional; regenerable) |
| `docs/` | Product spec, architecture, data model, security, integrations (+ verified API research), ADRs, normative Phase 1 contracts |

## Quick start (demo mode — zero external credentials)

Prereqs: Node 22+, pnpm 10+, PostgreSQL 16.

```bash
pnpm install

# 1. Start Postgres and create the dev database (any Postgres 16 works;
#    the default expects superuser 'postgres' on 127.0.0.1:55432)
createdb -h 127.0.0.1 -p 55432 -U postgres benhealth_dev

# 2. Apply migrations (also bootstraps the least-privilege benhealth_app role)
DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:55432/benhealth_dev \
  pnpm --filter @benhealth/db migrate

# 3. Seed the synthetic demo persona and start the platform (port 8787)
pnpm --filter @benhealth/platform demo:seed
pnpm --filter @benhealth/platform dev

# 4. Start the web dashboard (port 3000) in a second terminal
pnpm --filter web dev
```

Log in at http://localhost:3000 with `demo@benhealth.local` /
`demo-password`. You get 90 days of synthetic blood-pressure data: trends,
sessions, cross-source duplicates already deduplicated, freshness statuses,
and a visible "Demo data (synthetic persona)" banner. Demo mode uses a fake
in-process Withings server; nothing leaves your machine.

Environment variables are documented in `.env.example` (names only — never
commit values). In demo mode every secret has a safe generated default.

## Tests

```bash
DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:55432/postgres pnpm -r test
pnpm -r lint && pnpm -r typecheck && pnpm -r build
```

156 tests across the workspace (shared 23, db 13 — RLS/migrations against
real Postgres, platform 90 — OAuth/webhook idempotency/token rotation/dedup
matrix/redaction, web 30). CI runs the same suite plus gitleaks secret
scanning (`.github/workflows/ben-health-os-ci.yml`).

## iOS app (macOS required)

```bash
cd apps/ios
brew install xcodegen
xcodegen generate
open BenHealthOS.xcodeproj
```

Runs in the Simulator in demo mode; HealthKit ingestion and background
delivery require a physical iPhone. See `apps/ios/README.md`. The Swift has
not yet been compiled (this repo was built in a Linux environment) — expect
minor mechanical fixes on first build; that is a documented known limitation.

## Connecting real Withings data

1. Create an app at https://developer.withings.com/dashboard/ and register
   your public HTTPS callback URL.
2. Set `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`,
   `WITHINGS_REDIRECT_URI`, `WITHINGS_WEBHOOK_URL`, `PLATFORM_MODE=production`
   (plus real `AUTH_JWT_SECRET`, `TOKEN_ENC_KEY`, `DATABASE_URL`).
3. Click **Connect Withings** in the dashboard; historical readings import
   automatically and webhooks keep it current (with a durable cursor healing
   missed deliveries).

The webhook endpoint must be publicly reachable over HTTPS on a real domain
(Withings validates it with a HEAD request). Details: `docs/integrations.md`.

## Known limitations (honest list)

- iOS is scaffolded but not yet compiled (no Xcode in the build environment).
- Withings production behavior is verified against the official API docs and
  a high-fidelity fake, not yet against live credentials — labeled MOCKED
  until the owner provides a developer app + public callback.
- Withings deleted-measurement representation is undocumented; corrections
  are handled, deletions need an empirical test with a live account.
- Web E2E is curl-verified against the seeded stack; no browser-automation
  suite yet.
- Single-user by design; the schema is multi-user-safe but service-scope
  lookups assume one user per process (documented in
  `services/platform/src/directory.ts`).
