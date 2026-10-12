# Security and privacy

Health data is treated as highly sensitive at every layer.

## Implemented in Phase 1
- **Authentication**: Supabase Auth JWTs verified server-side via JWKS (ES256/RS256) with optional
  legacy HS256; local development uses HS256 dev tokens that production refuses.
- **Authorization**: RLS on every user table; the API runs user queries as role `authenticated`
  with claims from the verified token, never trusting request input for identity.
- **Secrets**: OAuth client secrets, JWT secrets and the token-encryption key live only in server
  environment variables (`docs/environment.md`); `.env*` files are git-ignored; no secrets in
  source. OAuth tokens (Phase 2) are stored AES-256-GCM encrypted (`services/api/src/services/crypto.ts`).
- **Logging**: request logs carry method/path/status only; bodies and health values are never
  serialized; authorization headers are redacted.
- **Android**: session token encrypted with a non-exportable Keystore key; database and
  preferences excluded from backups and device transfer; biometric/device-credential lock;
  notifications carry no measurements and are private on the lock screen; no advertising or
  analytics SDKs.
- **Web**: session token in an httpOnly, SameSite=Lax cookie; browser never calls the API
  directly; security headers (no framing, nosniff, no referrer).
- **Data ownership**: export-all (JSON) and delete-all (typed confirmation) endpoints with audit
  entries; per-connector data deletion; connector disconnect clears tokens.
- **Synthetic data only** in tests, fixtures and demo mode; demo data never mixes with real data.

## Not yet done (tracked for Phase 2/8)
- Privacy threat model document before production deployment.
- Webhook signature validation for Oura/Withings (designed; implemented with the connectors).
- Rate limiting and brute-force protection on the API edge; CSRF tokens on the web proxy for
  state-changing requests (SameSite=Lax mitigates today).
- Database encryption at rest and backup policy review for the hosted deployment (Supabase
  provides encryption at rest; confirm region/compliance posture).
- Formal review before any claim of HIPAA compliance — **no such claim is made**.
- SQLCipher for the on-device Room cache (today it relies on Android file-based encryption and
  the app sandbox; the cache holds only compact recent readings and dashboard JSON).

## Phase 5 additions (documents, clinical records)
- Uploaded lab PDFs/CSVs and generated physician briefs are written under `DOCUMENT_STORAGE_DIR`
  (`<user id>/<sha256>.<ext>`); the database stores metadata only. The directory must be backed up
  and permission-restricted together with the database; both are covered by export-all and
  delete-all.
- PDF handling reads the text layer in-process with pdf.js (`isEvalSupported: false`, no fonts, no
  rendering); bytes are validated (`%PDF-` magic) before parsing. No external OCR or AI service sees
  the file.
- Epic patient-access tokens are stored like other OAuth tokens (AES-256-GCM, rotated on refresh);
  SMART uses PKCE S256 and the `aud` parameter; the FHIR base URL is pinned per organization. There is
  no revocation endpoint in SMART patient access, so disconnect clears the stored tokens and the
  patient can revoke the app in MyChart.
- Lab values, medication names and conditions never appear in request logs (bodies are not
  serialized) or notifications.

## Phase 6 additions (AI layer, recommendations, notifications)
- AI providers receive **analysis packets**, never database access or raw records: trends, signals,
  BP summary, confirmed labs, glucose/nutrition summaries, medications, allergies, conditions,
  preventive status, source freshness, goals and memory items — each with a citation id and
  provenance. Items from excluded connectors (default Oura, ADR 0006) are removed in code before the
  provider copy is built; with `ai_sharing.enabled = false` no provider is called. The SHA-256 packet
  hash is stored with every report (`generator.providerPacketHash`) so what left the server is
  auditable; the packet itself is not logged.
- Provider responses are **validated before use**: citations must reference packet items; diagnostic,
  medication-change, emergency and causal wording is rejected; rejected findings are listed in the
  report, never shown as accepted. AI hypotheses enter the health memory only as
  `AI_HYPOTHESIS / UNVERIFIED`.
- `ANTHROPIC_API_KEY` is read from the environment on the API only; the web app and the Android app
  never hold it. Provider failures are logged without the packet contents.
- **Alerts** are created server-side with fixed, value-free titles and bodies (report ready, labs
  imported, connection expired, sync stale, permissions revoked, follow-up due, medication review
  due) and deduplicated per condition and period. The Android app posts them with
  `VISIBILITY_PRIVATE` and a public version that shows only the app name, honours the user's push
  toggle, enabled kinds and quiet hours (held, not dropped, during quiet hours), and marks them
  delivered. Nothing clinical is ever on the lock screen by default.
- Recommendations, evidence, reports, alerts and memories are user tables under RLS, included in
  export-all and delete-all.

## Phase 8 additions (hardening)
- **Threat model** in `docs/threat-model.md` (assets, trust boundaries, 22 threats with controls and
  honest status, abuse cases, residual risks for Ben to decide).
- **Rate limits** (`@fastify/rate-limit`, per user when authenticated, else per IP): login,
  imports, OAuth start, demo seed, export, delete-all, packet preview, report generation, physician
  brief generation and the internal job endpoints; 429 responses use the common error envelope with
  `retryAfterSeconds`. Limits are configurable (`RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_HEAVY_MAX`,
  `RATE_LIMIT_JOBS_MAX`; 0 disables a class).
- **Security headers** on every API response (`nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, HSTS when `PUBLIC_BASE_URL` is https)
  and HSTS on production web builds.
- **Production guards** in configuration: `AUTH_MODE=local` refused, `ALLOW_DEMO_SEED` must be
  `false`, `PUBLIC_BASE_URL` must be https, `TOKEN_ENCRYPTION_KEY` required once any connector is
  configured. Boolean environment variables are parsed strictly (`'false'` is false).
- **Readiness** (`GET /ready`): database round trip and a writable document directory; 503 with the
  failing check otherwise. `GET /health` stays a liveness probe.
- **Unknown routes** answer with the JSON error envelope; the database pool has connection and
  query timeouts so a stuck query cannot hold a worker forever.
- **Secret scan** in `scripts/verify.sh` (API-key and private-key patterns) and release signing
  material read from `~/.gradle/gradle.properties`, never from the repository.
- Still **not** claimed: HIPAA compliance, penetration testing, and physical-device verification.
