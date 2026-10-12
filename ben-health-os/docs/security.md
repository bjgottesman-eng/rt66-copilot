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
