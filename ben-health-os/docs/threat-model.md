# Threat model (Phase 8)

Scope: the API (`services/api`), the web dashboard (`apps/web`), the Android app, the database and
the document store, and the third-party integrations (Oura, Withings, Epic FHIR, AI provider).
One user (Ben) with one account; the system must still behave as if it were multi-tenant, because
Supabase Auth, RLS and the API are shared infrastructure.

Legend for status: **MITIGATED** (control exists and is tested) · **PARTIAL** (control exists,
verification pending) · **ACCEPTED** (residual risk documented) · **OPEN** (to do).

## Assets
- Health records (observations, sleep, workouts, glucose, nutrition, labs, medications, conditions,
  documents), derived metrics, reports, recommendations, memory.
- Credentials: Supabase JWT secrets/JWKS, OAuth client secrets, encrypted OAuth tokens, job secret,
  AI provider key, Android session token.
- Integrity of calculations (one analytics implementation, versioned algorithms).

## Trust boundaries
1. Browser ↔ web app (Next.js): httpOnly session cookie; browser JS never sees the API token.
2. Web app ↔ API: bearer token over HTTPS; same-origin proxy `/api/proxy/v1/*` restricted to `/v1`.
3. Android ↔ API: bearer token from Keystore-encrypted storage; cleartext HTTP only to private LAN
   addresses in debug builds (`network_security_config`).
4. API ↔ Postgres: service connection; every user request runs in a transaction as role
   `authenticated` with `request.jwt.claims` set, so RLS applies even to the API's own queries.
5. API ↔ providers: outbound HTTPS only; inbound webhooks verified (Oura HMAC, Withings HEAD
   validation + replay-safe dedupe); FHIR endpoints pinned per organization.
6. API ↔ AI provider: outbound only, packets built in code, sharing controls applied before the call.

## Threats and controls

| # | Threat | Control | Status |
|---|---|---|---|
| T1 | Stolen or replayed bearer token | Short-lived Supabase JWTs (local mode: dev tokens, refused in production); tokens never logged (`redact`); Android stores the token AES-GCM under a Keystore key with biometric lock; web keeps it httpOnly + SameSite=Lax + Secure in production | MITIGATED (web/API), PARTIAL (Android, device pending) |
| T2 | Cross-user data access (IDOR / RLS bypass) | RLS on every user table with `(select auth.uid()) = user_id`; API never uses the service role for user reads; isolation tests in every API suite (`measurements_account`, `clinical`, `intelligence`, `experiments`) | MITIGATED |
| T3 | Forged webhook delivering fake measurements | Oura: HMAC signature + timestamp, single-use event ids; Withings: HEAD validation and `appli`/`userid` lookup, unknown users ignored, duplicate deliveries processed once; raw events immutable so a bad batch can be audited | MITIGATED (mock-tested) |
| T4 | OAuth state fixation / code injection | PKCE S256 everywhere, single-use `oauth_states` rows with expiry, `aud` parameter for SMART, redirect URIs pinned to `PUBLIC_BASE_URL` | MITIGATED (mock-tested) |
| T5 | Token theft from the database | OAuth tokens AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY` (never in the DB), rotated on refresh, ciphertext excluded from exports | MITIGATED |
| T6 | Health values leaking into logs or crash reports | Request serializers emit method/url/status only; bodies never serialized; no analytics/crash SDKs in the app; provider errors logged without packet contents | MITIGATED |
| T7 | Lock-screen exposure | Alert titles/bodies are fixed strings without values; Android uses `VISIBILITY_PRIVATE` with a public version that shows only the app name; quiet hours and per-kind opt-outs | MITIGATED (device verification pending) |
| T8 | Malicious uploaded document (PDF parser exploit, zip bomb, oversized body) | `%PDF-` magic check, pdf.js with `isEvalSupported: false`, no font/render pipeline, 8 MiB default body limit (32 MiB for Health Connect batches), files stored outside the DB with sha256 names and user-scoped directories | MITIGATED |
| T9 | Prompt injection through imported text reaching the AI provider | Packets contain structured items with controlled text templates; free text from documents, notes and journal entries is never placed in a packet; provider output is validated (citations + forbidden patterns) and never executed | MITIGATED |
| T10 | AI provider receiving excluded data (Oura terms) or data without consent | Sharing controls applied in code (`applySharingControls`), provider not consulted when `ai_sharing.enabled = false`; dropped-item count and packet hash recorded | MITIGATED (tested) |
| T11 | Credential stuffing / brute force on login, abusive import or job endpoints | Supabase Auth handles sign-in in production; API rate limits on auth, import, OAuth start, job and demo endpoints (`@fastify/rate-limit`) | MITIGATED (Phase 8) |
| T12 | Job endpoints triggered by outsiders | `JOB_SECRET` compared in constant time; 503 when unset; rate limited | MITIGATED |
| T13 | CSRF against the web proxy | Session cookie SameSite=Lax; the proxy forwards JSON only; state-changing routes require the bearer token the browser cannot read; CORS restricted to `CORS_ORIGINS` | MITIGATED |
| T14 | Clickjacking / MIME sniffing / referrer leakage | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, restrictive Permissions-Policy on the web; API sends the same headers (Phase 8) | MITIGATED |
| T15 | Secrets committed to the repository | `.env*` ignored, config via environment only, verify script greps for key-shaped strings (Phase 8) | MITIGATED |
| T16 | Real medical records committed as fixtures | All fixtures synthetic (`@bho/fixtures`), demo mode flagged in the UI and the profile; the seed refuses to overwrite real data | MITIGATED |
| T17 | Lost or corrupted data | Raw ingest events immutable; append-only migrations; backup guidance for Postgres + `DOCUMENT_STORAGE_DIR` (`docs/deployment.md`); export-all works at any time | PARTIAL (backups are operational, not automated here) |
| T18 | Wrong calculations shown as facts | One analytics implementation, versioned algorithms, coverage gates, INSUFFICIENT_EVIDENCE first-class, unit tests per rule, no composite scores | MITIGATED |
| T19 | Android background sync silently stops (Doze, revoked permissions) | WorkManager periodic work with retry, sync reports to the API, REVOKED/STALE freshness and alerts, foreground sync on launch | PARTIAL (device verification pending) |
| T20 | Dependency supply chain | Pinned versions in lockfiles, Gradle mirror pins, no postinstall scripts beyond known packages; upgrade cadence noted in ADR 0003 | ACCEPTED (no automated audit yet) |
| T21 | Denial of service through expensive endpoints (reports, packet preview, exports) | Report generation idempotent per period and rate limited; sources statistics query rewritten (per-row subquery removed); export streams one table at a time | PARTIAL |
| T22 | Compliance claims | The project does **not** claim HIPAA compliance; hosting choices (Supabase region, BAA) are Ben's decision with legal review | ACCEPTED |

## Abuse cases walked through
- *An attacker obtains Ben's phone unlocked.* The app is biometric-locked after 60 s; notifications
  show no values; the token can be revoked by signing out on the web (delete-all also clears
  connections). Residual risk: screenshots or an unlocked session window.
- *A compromised wearable vendor pushes fabricated data.* Data carries provenance and is deduplicated
  against other sources; the dashboard shows the source on every value; raw events let Ben delete
  one source's data without touching the rest.
- *A malicious PDF from a lab portal.* Only the text layer is read; the parser runs without eval or
  rendering; extracted rows are staged for review, never trusted.
- *A prompt-injection line inside a lab PDF ("ignore previous instructions…").* Lab text never
  reaches the packet; only mapped analyte values with controlled wording do. Even if a provider
  returned instructions, the validator only accepts findings with citations and safe wording and the
  app never acts on provider output automatically.

## Residual risks and decisions for Ben
1. Hosting and legal: Supabase project region and whether a BAA is needed; HIPAA is not claimed.
2. Device verification: biometric lock, background sync and notification privacy on the Galaxy
   S26 Ultra remain TESTED ON PHYSICAL DEVICE pending.
3. Backups: schedule Postgres and document-store backups on the host (guide in
   `docs/deployment.md`).
