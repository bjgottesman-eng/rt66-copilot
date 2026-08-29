# ADR-0002: PostgreSQL + RLS with a Node/TypeScript platform service (Supabase-compatible, not Supabase-hosted yet)

Date: 2026-08-29 · Status: Accepted

## Context

The brief prefers "PostgreSQL, Supabase Auth and database, or another
well-supported equivalent," with server-side functions for OAuth, webhooks,
token refresh, and AI calls, and allows an alternative via ADR. Constraints
observed in this build environment and in verified docs (2026-08-29):

- No Supabase project credentials exist yet (owner action).
- Supabase Edge Functions run on a Deno runtime; this environment has no Deno
  toolchain, so Edge-Function code could not be executed or tested here.
- Webhook + OAuth handling needs a long-lived HTTPS endpoint, durable retries,
  and background work — a conventional service fits at least as well as edge
  functions.
- Real PostgreSQL 16 is available locally, so migrations and RLS are testable
  today.

## Decision

1. **PostgreSQL 16** is the system of record. Schema, RLS policies, and
   migrations live in `packages/db` as plain numbered SQL applied by a small
   runner — portable to Supabase (`supabase/migrations`) later.
2. **services/platform** is a Node 22 + TypeScript (Fastify) service that owns
   auth, OAuth flows, webhooks, ingestion, normalization, dedup, and the API.
   It connects as the least-privilege `benhealth_app` role (no BYPASSRLS) and
   scopes every request via `set_config('app.user_id', …)` so RLS is active in
   production paths, not just tests.
3. **Auth abstraction**: local mode issues platform JWTs (argon2id password,
   HS256, single bootstrap user); a Supabase-mode verifier (JWKS /
   `getClaims`-equivalent) can replace it without touching handlers.
4. Supabase remains the intended managed home: hosting the same Postgres +
   Auth there is an infrastructure swap, not a rewrite. Adopting Supabase
   Auth/Edge Functions later gets its own ADR.

## Consequences

- Everything is runnable and testable in CI/this container today against real
  Postgres — the brief's Phase 1 backend acceptance criteria are verifiable.
- We own auth code in local mode (bounded: one user, argon2id + JWT); the
  Supabase adapter path is documented in `docs/security.md`.
- No CloudKit/iCloud storage of health records (per brief). No secrets in
  clients; all connector calls are server-side.
