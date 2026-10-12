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
