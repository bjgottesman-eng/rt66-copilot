# ADR-0005: Authentication — platform-issued JWT (local mode) behind an AuthProvider interface

Date: 2026-08-29 · Status: Accepted

## Context

Single user today, multi-user-safe schema. No Supabase project exists yet
(owner action). The web dashboard must authenticate securely; iOS stores its
token in Keychain. Supabase's current server-side guidance (verified
2026-08-29) is `@supabase/ssr` + `auth.getClaims()`; adopting it requires the
hosted project.

## Decision

- **Local auth mode (Phase 1 default)**: the platform service bootstraps one
  user from env (`BOOTSTRAP_USER_EMAIL/PASSWORD`, argon2id hash), issues HS256
  JWTs (`AUTH_JWT_SECRET`, 24 h expiry, `sub` = user id) on
  `POST /api/v1/auth/login`, and verifies them in middleware that also sets
  `app.user_id` for RLS.
- **Web**: Next.js route handlers proxy the platform API and keep the JWT in
  an **httpOnly, Secure, SameSite=Lax cookie** — the token never touches
  client-side JS.
- **iOS**: token in Keychain; Face ID/device authentication gates the UI
  (LocalAuthentication), which protects local cache too.
- **AuthProvider interface** isolates verification so a Supabase-JWT verifier
  (JWKS) can be swapped in without handler changes (future ADR when adopted).
- OAuth connector flows (Withings) use a server-persisted `state` nonce bound
  to the user and single-use, expiring in 10 minutes (CSRF).

## Consequences

- Secure today without external dependencies; demo mode works everywhere.
- Password reset/MFA are out of scope for a single-user local mode and arrive
  with Supabase Auth if/when adopted.
