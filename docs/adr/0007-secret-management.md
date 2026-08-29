# ADR-0007: Secret management and token-at-rest encryption

Date: 2026-08-29 · Status: Accepted

## Context

Secrets in play: Withings/Oura client secrets, OAuth user tokens, JWT signing
secret, DB credentials, future LLM keys. Brief requirements: server-side
secret management, encrypted OAuth-token storage, no secrets in source control
or clients, redacted logs.

## Decision

- **Environment-variable injection** is the single secret channel
  (`.env` locally — git-ignored; the deployment platform's secret store in
  production). `.env.example` documents names only; CI runs secret scanning
  (gitleaks) to keep values out of the repo.
- **OAuth tokens at rest**: AES-256-GCM with a 32-byte key from
  `TOKEN_ENC_KEY`; ciphertext stored as `iv ‖ authTag ‖ data` in `bytea`
  columns. Decryption happens only inside connector modules; API serializers
  never touch token rows; a redaction test asserts logs contain no token
  material.
- **Key rotation**: documented procedure (decrypt-reencrypt migration script)
  rather than multi-key envelope encryption for now — single-user scale;
  revisit if multi-user.
- Clients (iOS/web JS) never receive: client secrets, user OAuth tokens,
  service DB credentials, or LLM keys. iOS keeps only its own JWT in
  Keychain; web keeps it in an httpOnly cookie.
- A managed KMS (e.g. Supabase Vault) is an infrastructure upgrade adopted
  together with hosted deployment (future ADR).

## Consequences

- Simple, auditable, testable now; the encryption module is ~100 lines with
  unit tests (roundtrip, tamper detection, wrong-key failure).
- Compromise of a runtime host still exposes in-memory secrets — accepted for
  a single-user self-hosted deployment; noted in docs/security.md.
