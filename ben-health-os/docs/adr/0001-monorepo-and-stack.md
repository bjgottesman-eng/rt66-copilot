# ADR 0001 — Monorepo, TypeScript backend, Kotlin Android, Next.js web

Status: accepted (2026-10-12)

## Context
The specification asks for a native Android app, a web dashboard and a secure backend with one
authoritative calculation implementation, delivered incrementally by a small team (initially one
engineer plus AI agents).

## Decision
- pnpm workspace monorepo: `apps/android`, `apps/web`, `services/*`, `packages/*`, `fixtures`.
- Backend in TypeScript (Fastify 5, Node 22, `pg`, zod 4, jose) so contracts, analytics and the API
  share one language and one test runner (vitest). The analytics engine (`services/analytics`) is the
  only place health math lives; the web app never recalculates.
- Android in Kotlin 2.3 / Jetpack Compose / Material 3 / Room / WorkManager / Health Connect 1.1.0.
- Web in Next.js 15.5 (App Router) with Tailwind 4 and Recharts 3; the browser talks only to a
  same-origin proxy route so the session token stays in an httpOnly cookie.
- Shared configuration (thresholds, catalogs, priorities) is TypeScript source generating JSON that
  the Android build copies into assets, with a drift test.

## Consequences
- Two languages (TS, Kotlin) instead of three; Kotlin DTOs mirror zod contracts and are covered by
  serialization tests.
- Supabase Edge Functions (Deno) are not used for business logic; the Fastify service can be
  deployed anywhere (container) and still use Supabase Auth + Postgres (see ADR 0002).
