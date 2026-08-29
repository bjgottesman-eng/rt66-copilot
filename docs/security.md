# Ben Health OS — Security & Privacy Architecture

Status: Phase 1 (normative references: `docs/contracts/phase1-contracts.md`,
build brief §25). This document describes controls that are implemented or
contractually required in Phase 1, and explicitly marks anything deferred.

---

## 1. Threat model summary

### 1.1 Sensitive-data classes

| Class | Examples | Sensitivity |
|---|---|---|
| Health observations | BP readings, sessions, derived trends, raw ingest payloads | Highest. Never in logs, analytics, crash reports, or VCS. |
| OAuth credentials | Withings access/refresh tokens, scopes | Highest. Encrypted at rest (AES-256-GCM), never serialized by the API. |
| Auth secrets | JWT signing secret, password hash, token-encryption key | Highest. Env-only; hashes are argon2id. |
| Identity | Email, user_id | Moderate. user_id appears in audit rows; email never in request logs. |
| Sync metadata | Cursors, connection status, error strings | Low, but provider error strings are treated as untrusted and redacted before logging. |

### 1.2 Attacker classes

1. **Remote network attacker** — probes the platform API and webhook
   endpoints. Mitigated by TLS, JWT auth on all data routes, rate limiting,
   webhook validation, and strict input validation.
2. **Stolen/lost device** — physical access to the iPhone/iPad. Mitigated by
   iOS file protection, Keychain storage, and the Face ID gate.
3. **Compromised or spoofed provider** — forged webhook deliveries, duplicate
   or replayed notifications, malicious payloads. Mitigated by the webhook
   journal (idempotency), payload treated as data, async verification via a
   fresh authenticated `getmeas` call rather than trusting webhook contents.
4. **Malicious or buggy dependency** — supply-chain compromise. Mitigated by
   lockfiles, dependency scanning, and least-privilege runtime roles.
5. **Database-level attacker or application bug crossing users** — SQL
   injection or a missing `where user_id` clause. Mitigated by parameterized
   queries and PostgreSQL row-level security enforced for the app role.
6. **Curious operator / log reader** — access to operational logs or the
   audit trail. Mitigated by the redaction policy (§4): logs carry no health
   values, tokens, or secrets, and this is enforced by tests.
7. **Prompt-injection via imported clinical text** (later phases) — imported
   documents are untrusted data, never instructions to any AI component.

Out of scope for the single-user Phase 1 deployment: nation-state attackers,
malicious insiders with root on the host, and physical attacks on the server.
The schema is nevertheless multi-user-safe so isolation does not depend on
"there is only one user."

---

## 2. iOS protections

- **Face ID / device-auth gate.** The app locks its UI behind
  `LocalAuthentication` (Face ID, falling back to device passcode) on launch
  and on return from background after a short grace period. This is a privacy
  screen, not the cryptographic boundary — the OS keychain and file
  protection are.
- **Keychain.** The platform JWT is stored in the iOS Keychain with
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (no iCloud Keychain sync,
  no backup migration to other devices). No token ever lands in
  `UserDefaults`, files, or logs.
- **File protection.** The local cache (recent readings for offline use)
  uses iOS Data Protection `NSFileProtectionCompleteUntilFirstUserAuthentication`
  or stricter; cached health data is excluded from iCloud backup
  (`isExcludedFromBackup = true`). No PHI is written to iCloud, iCloud Drive,
  or CloudKit in any phase without a documented decision (ADR) and privacy
  review.
- **HealthKit** data stays in HealthKit; the app reads with user-granted
  scopes and uploads only what the user connected. HealthKit entitlement
  usage strings are accurate and minimal.
- **No third-party analytics or advertising SDKs.** Crash reporting, if ever
  added, must be configured to exclude breadcrumbs/attachments that could
  carry health values, and documented before adoption.

---

## 3. Transport & backend

### 3.1 TLS

All client↔backend and backend↔provider traffic is HTTPS/TLS. In production
the platform sits behind a TLS terminator with modern cipher configuration;
iOS ATS defaults are not weakened (no `NSAllowsArbitraryLoads`). Webhook
callback URLs are HTTPS only.

### 3.2 Auth model (local vs Supabase mode)

- **Local mode** (default, `PLATFORM_MODE=demo` or self-hosted): the platform
  owns auth. Passwords are hashed with **argon2id**; login issues an HS256
  JWT signed with `AUTH_JWT_SECRET`, 24 h expiry, claims `sub` (user_id) and
  `email`. The web app never exposes the JWT to page JavaScript: its route
  handler stores it in an **httpOnly, Secure, SameSite** cookie and proxies
  API calls. iOS keeps the JWT in the Keychain.
- **Supabase mode** (future): the same auth middleware verifies Supabase
  RS256 JWTs against the project JWKS. The `AuthProvider` interface isolates
  the difference so route handlers and RLS wiring are identical in both
  modes.
- Every `/api/v1` data route requires `Authorization: Bearer <jwt>` (or the
  cookie proxy). Only `GET /health` and the Withings webhook endpoints are
  unauthenticated by design.

### 3.3 Row-level security

- Every table carrying `user_id` has RLS **enabled and forced**. Policies
  check `user_id = current_setting('app.user_id', true)::uuid`.
- The service opens each request's DB work in a transaction that first runs
  `select set_config('app.user_id', $1, true)` with the authenticated
  user_id. The setting is transaction-local, so pooled connections cannot
  leak identity between requests.
- The service role **`benhealth_app` is NOT `BYPASSRLS`** and is not a
  superuser. Only the migration runner uses the admin URL; the running
  service never does.
- Service-internal tables (`webhook_delivery`, `schema_migrations`) have RLS
  policies that deny access to non-service roles.
- RLS is tested: the suite proves user A cannot read user B's rows through
  the app role, and that an unset `app.user_id` returns nothing rather than
  everything.

### 3.4 OAuth token encryption

- Access and refresh tokens are stored only in `oauth_token` as
  `iv || tag || ciphertext` produced by **AES-256-GCM** with `TOKEN_ENC_KEY`
  (32 bytes, from env, never in VCS). A fresh random 12-byte IV is generated
  per encryption; the GCM tag authenticates the ciphertext.
- Decryption happens **only inside the connector module**. The API layer
  never serializes `oauth_token` rows; no DTO carries token material.
- **Rotation:** Withings rotates refresh tokens. On every refresh the new
  access+refresh pair is persisted **atomically before use**; the old refresh
  token is never reused (tested). `invalid_grant` marks the connection
  `error` → freshness `SYNC_ERROR`, and the user re-consents; we never retry
  a burned refresh token in a loop.
- Key rotation guidance: introduce `TOKEN_ENC_KEY_NEXT`, re-encrypt rows in a
  batch job, then promote. Losing the key is recoverable — users simply
  re-authorize — so availability never justifies weakening key handling.

### 3.5 Least-privilege database roles

- `postgres` (admin): migrations only, via `DATABASE_URL_ADMIN`.
- `benhealth_app`: runtime role; `SELECT/INSERT/UPDATE` on the specific
  tables it needs, no DDL, no `BYPASSRLS`, no superuser. Raw ingest rows are
  immutable except processing metadata; the schema and grants reflect that.
- No shared "god" connection string in application config.

### 3.6 Webhook validation & idempotency

- `HEAD /webhooks/withings` returns 200 for Withings callback verification.
- `POST /webhooks/withings` responds 200 fast; the body is **hashed** and
  inserted into `webhook_delivery` with a `unique(provider, delivery_hash)`
  constraint. Duplicate deliveries are acknowledged and dropped (tested,
  including out-of-order delivery).
- The webhook body is never trusted as data: it is only a trigger. Actual
  measurements are fetched via an authenticated `getmeas` call against a
  durable `lastupdate` cursor, so forged webhook content cannot inject
  fabricated readings, and missed webhooks are healed by the next webhook or
  a manual refresh.
- Webhook payloads are journaled but never logged verbatim.

### 3.7 CSRF / state for OAuth

- `POST /sources/withings/connect` generates a cryptographically random
  `state`, persists it server-side bound to the user with a short TTL, and
  embeds it in the authorize URL.
- `GET /integrations/withings/callback` validates `code` + `state` against
  the stored value, consumes the state single-use, and rejects
  unknown/expired/replayed states. The client secret lives only server-side;
  the code exchange never happens on a client.
- Redirect targets after callback are a fixed allowlist (app universal link /
  web dashboard), never an attacker-supplied URL. Universal links are
  configured with an apple-app-site-association file, not custom URL schemes
  alone.

### 3.8 Rate limiting

- `POST /auth/login` is rate-limited per IP and per account (with a
  small-window lockout/backoff) to blunt credential stuffing on the argon2id
  hash.
- Webhook and public endpoints have per-IP limits; expensive routes
  (backfill, refresh) have per-user limits. Limits return the standard error
  envelope with HTTP 429 and never leak whether an account exists.

---

## 4. Logging & redaction policy

**May never appear in logs, analytics, crash reports, or error strings:**

- OAuth access/refresh tokens, JWTs, cookies, `Authorization` headers
- Passwords, password hashes, `AUTH_JWT_SECRET`, `TOKEN_ENC_KEY`, any env secret
- Health values: systolic/diastolic/pulse numbers, raw ingest payloads,
  webhook bodies, HealthKit sample contents, notes
- Email addresses in request logs (user_id UUID is the correlation key)

**Allowed:** route + status + latency, user_id, connection/provider ids,
counts ("imported 12 groups"), enum states, error *codes*. Provider error
messages are logged only after passing a redaction filter, since providers
can echo request contents.

**Enforcement:** the Fastify logger is configured with redaction paths for
headers and known body fields, and — because allowlisting beats
denylisting — request/response bodies on `/bp/*`, `/ingest/*`, and
`/webhooks/*` are not logged at all. The test suite includes a **log
redaction test** (Phase 1 acceptance): it drives login, manual BP entry,
webhook delivery, and a token refresh through the app with a capturing log
sink, then asserts the captured output contains no token substrings, no
secret values, and none of the seeded BP values. `audit_log.details` is
pre-redacted at write time by construction — writers pass explicit
allowlisted fields, never whole objects.

---

## 5. Secret management

- All secrets come from environment variables: `AUTH_JWT_SECRET`,
  `TOKEN_ENC_KEY`, `BOOTSTRAP_USER_PASSWORD`, `WITHINGS_CLIENT_ID/SECRET`,
  `DATABASE_URL`(+admin). `.env` files are gitignored; **`.env.example`
  carries names and format hints, never values**.
- No secrets in source control, fixtures, test snapshots, or CI logs. Demo
  mode's published credentials (`demo@benhealth.local` / `demo-password`)
  guard only synthetic data and are the sole exception.
- Rotation guidance: `AUTH_JWT_SECRET` rotation invalidates sessions (24 h
  max lifetime bounds exposure; support overlapping verification keys if
  zero-downtime rotation is needed). `TOKEN_ENC_KEY` per §3.4. Withings
  client secret rotates in the provider console + env together. Rotate
  immediately on any suspected exposure; record rotations in the audit log
  (`actor='operator'`, no secret material in details).

---

## 6. Data rights

- **Export:** the user can export their complete record (readings, sessions,
  derived metrics, raw payload references) in a documented machine-readable
  format. Physician-facing exports (later phases) are explicit, user-initiated
  actions.
- **Permanent deletion:** distinct from the soft delete (`deleted_at`) used
  for reversible hiding. A user-initiated permanent deletion removes the
  user's rows across all layers — raw events included — and is recorded in
  `audit_log` as an action (what was deleted and when, never the values).
  The immutability rule for raw rows restricts *mutation*, not
  rights-driven erasure.
- **Revocation:** disconnecting a provider marks the connection `revoked`,
  deletes the stored token row (cascade), and — where the provider supports
  it — revokes the grant server-side. Already-ingested data remains until the
  user deletes it, and the UI says so.
- **Audit trail:** `audit_log` records logins, connection changes, exports,
  deletions, and token rotations with actor, action, entity, timestamp, and
  pre-redacted details — enough to answer "what happened to my data" without
  itself becoming a sensitive-data store.

---

## 7. Dependency & CI hygiene

- pnpm lockfile is committed; installs are `--frozen-lockfile` in CI.
- CI runs dependency vulnerability scanning (`pnpm audit` at minimum;
  Dependabot/Renovate for update PRs) and **secret scanning** (e.g. gitleaks
  or GitHub secret scanning + push protection) on every push. A leaked
  secret fails the build and triggers rotation per §5.
- Migrations run from a clean PostgreSQL in CI; RLS, webhook idempotency,
  token rotation, dedup, and log-redaction tests are all part of the Phase 1
  acceptance floor and gate merges.
- New SDKs/dependencies that could touch health data require a documented
  decision (ADR) before adoption.

---

## 8. Explicit non-claims

- **No HIPAA claim.** Ben Health OS makes no "HIPAA compliant" statement.
  As a personal, single-user tool it is likely not a covered entity, but
  regardless: no such claim is made anywhere (docs, UI, App Store copy)
  without documented controls, business-associate contracts where relevant,
  and independent legal/security review.
- **Not a medical device.** No diagnosis, no medication-change advice, no
  emergency detection beyond documented, source-cited, tested rules.
- **No advertising SDKs, no data selling, no profiling, no health data to
  general-purpose analytics.**
- No claim that an integration "works" from mocked data alone; mocked,
  sandbox, and production behavior are labeled separately.

---

## 9. App Store privacy checklist (later phases)

Before any App Store submission:

- [ ] Re-read current Apple health-data guidelines (App Review 5.1.3) and
      privacy rules; record URLs + access dates in `docs/integrations.md`.
- [ ] Published, accurate privacy policy reachable from the app and listing.
- [ ] App Privacy "nutrition label" completed truthfully (health data:
      collected, linked to user, not used for tracking).
- [ ] Privacy manifests (`PrivacyInfo.xcprivacy`) for the app and all SDKs;
      all third-party SDKs documented, minimal, and none advertising-related.
- [ ] Minimal permission requests: only the HealthKit types actually used,
      with honest purpose strings.
- [ ] Confirm no PHI in iCloud/CloudKit/backup; verify backup-exclusion
      flags on cached files.
- [ ] Disclose any AI/analytics vendors that process user data; none may be
      general-purpose analytics for health values.
- [ ] Face ID usage string (`NSFaceIDUsageDescription`) present and accurate.
- [ ] Account deletion path (App Review 5.1.1(v)): in-app permanent deletion
      per §6 works end-to-end.
- [ ] Universal links / associated domains verified over HTTPS; no
      credential flows over custom URL schemes.
- [ ] Export compliance for encryption answered correctly (standard
      exemption expected; document it).

---

*Changes to this document that alter contractual behavior (schema, API,
redaction guarantees) go through an ADR, per repository rules.*
