# ADR 0002 — Supabase-compatible schema, local Postgres without Docker

Status: accepted (2026-10-12)

## Context
The preferred backend is Supabase (Auth + Postgres + RLS). The Supabase CLI's local stack requires
Docker, which the development container cannot run. Supabase Auth verification moved to asymmetric
JWT signing keys (JWKS) in 2025–2026; the legacy HS256 secret is no longer recommended.

## Decision
- Migrations are plain SQL under `supabase/migrations`, written to Supabase conventions
  (`auth.users` FK, `auth.uid()` in RLS policies, roles `anon`/`authenticated`/`service_role`).
- For local development and CI, `supabase/local/0000_local_auth_shim.sql` creates the `auth`
  schema, roles and `auth.uid()` exactly as Supabase defines them. `scripts/db-migrate.mjs` applies
  the shim only when `auth.uid()` is missing (never on a hosted project).
- The API executes every user request inside a transaction as role `authenticated` with
  `request.jwt.claims` set from the verified token, so RLS is enforced identically locally and on
  Supabase. Service-role work (audit log, webhooks) uses the service connection.
- `AUTH_MODE=local` issues HS256 dev tokens (refused in production); `AUTH_MODE=supabase` verifies
  ES256/RS256 tokens via the project JWKS with an optional legacy HS256 fallback.

## Consequences
- Hosted deployment needs a Supabase project (URL, publishable key, JWKS) and the API's
  `DATABASE_URL` pointing at it — listed in `docs/environment.md` as BLOCKED BY CREDENTIALS.
- Supabase-specific features (Edge Functions, pg_cron scheduling) are optional; the roadmap uses
  pg_cron + pg_net for report scheduling in Phase 6 with a container cron fallback.
