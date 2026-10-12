# Deployment guide (Phase 8)

Everything below has been exercised locally against plain Postgres 16 with the local auth shim.
Hosted deployment (Supabase + a container host) is written from the official product
documentation and the code's configuration surface; it is **not yet verified against a live
Supabase project** because no project credentials exist (see `docs/environment.md`).

## Topology
```
Android app ──HTTPS──▶ API (Fastify, container) ──▶ Postgres (Supabase project)
Web (Next.js, container or Vercel) ──server-side──▶ API         └─ DOCUMENT_STORAGE_DIR (volume)
Oura / Withings webhooks ──HTTPS──▶ API /v1/webhooks/*
pg_cron + pg_net (or container cron) ──▶ API /internal/jobs/{reconcile,derive,reports}
```

## 1. Database (Supabase)
1. Create a project; choose the region deliberately (data residency is Ben's decision; HIPAA is not
   claimed, see `docs/security.md`).
2. Apply migrations in order with the service connection string:
   `DATABASE_URL='postgres://postgres.<ref>:<password>@<host>:5432/postgres' node scripts/db-migrate.mjs`
   The script detects `auth.uid()` and skips the local shim automatically; every applied file is
   recorded in `public.schema_migrations`, so re-running is a no-op.
3. Confirm RLS: `select tablename, rowsecurity from pg_tables where schemaname = 'public'` must show
   `true` for every user table; `supabase/migrations/20261012000300_rls.sql` lists them.
4. Keep the `postgres`/service connection string only in the API's environment. The web app and the
   Android app never hold database credentials.

## 2. API container
- Build: `pnpm install && pnpm run build:packages` then run `node services/api/dist/server.js`
  (Node 22). A minimal Dockerfile:
  ```Dockerfile
  FROM node:22-slim
  WORKDIR /app
  COPY . .
  RUN corepack enable && pnpm install --frozen-lockfile && pnpm run build:packages
  ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
  CMD ["node", "services/api/dist/server.js"]
  ```
- Required environment (`docs/environment.md`): `DATABASE_URL`, `AUTH_MODE=supabase`,
  `SUPABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `PUBLIC_BASE_URL`, `WEB_BASE_URL`, `CORS_ORIGINS`,
  `JOB_SECRET`, `DOCUMENT_STORAGE_DIR` (mounted volume), `ALLOW_DEMO_SEED=false`, plus connector and
  AI credentials when available. In production the API refuses to start with `AUTH_MODE=local`
  and with a default `LOCAL_JWT_SECRET`.
- Probes: `GET /health` (liveness: process up) and `GET /ready` (readiness: database round trip,
  document directory writable). Both are unauthenticated and carry no user data.
- Limits (Phase 8): 8 MiB bodies (32 MiB for Health Connect batches), rate limits per IP/user on
  auth, imports, OAuth start, demo, jobs and report generation; security headers on every response.
- Logs: pino JSON to stdout; request lines carry method/url/status/duration and a request id, never
  bodies or tokens. Ship them to the host's log drain; retention is an operational choice.
- Graceful shutdown on SIGTERM: in-flight requests finish, the pool drains.

## 3. Web container
- `pnpm --filter @bho/web build` then `node apps/web/node_modules/next/dist/bin/next start`.
- Environment: `API_BASE_URL` (internal URL of the API), `NEXT_PUBLIC_AUTH_MODE=supabase`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- The session cookie is httpOnly/SameSite=Lax and `Secure` when served over HTTPS; the web app only
  ever talks to the API server-side or through `/api/proxy/v1/*`.

## 4. Scheduled jobs
Call the internal endpoints with the `x-job-secret` header:
| Job | Endpoint | Cadence |
|---|---|---|
| Connector reconciliation (Oura/Withings/FHIR) | `POST /internal/jobs/reconcile` | hourly |
| Derived metrics and signals | `POST /internal/jobs/derive` | nightly, after the day closes in Ben's time zone (e.g. 03:15 local) |
| Reports, alerts, experiments | `POST /internal/jobs/reports` | daily, after derive (e.g. 04:00 local) |

With pg_cron + pg_net on Supabase:
```sql
select cron.schedule('bho-derive', '15 7 * * *', $$
  select net.http_post(url := 'https://api.example.com/internal/jobs/derive',
                       headers := '{"x-job-secret": "<JOB_SECRET>"}'::jsonb, body := '{}'::jsonb);
$$);
```
(07:15 UTC = 03:15 America/New_York during daylight time; adjust per season or run twice.)
A container cron with `curl -X POST -H "x-job-secret: $JOB_SECRET" …` is equivalent.

## 5. Backups and restore
- Database: Supabase daily backups (plan-dependent) plus `pg_dump` on a schedule if PITR is not
  included. Restore test: dump → `psql` into a scratch database → `node scripts/db-migrate.mjs`
  (no-op) → start the API against it → `GET /ready`.
- Documents: snapshot the `DOCUMENT_STORAGE_DIR` volume with the database (files are addressed by
  sha256 inside `<user id>/`, so a restore never needs renaming).
- Export-all (`GET /v1/me/export`) is the user-facing backup and works at any time.

## 6. Connector registration (when Ben provides credentials)
- Oura: redirect URI `<PUBLIC_BASE_URL>/v1/oauth/oura/callback`; webhook verification token
  `OURA_WEBHOOK_VERIFICATION_TOKEN`; subscriptions are (re)created by the API after connect.
- Withings: redirect URI `<PUBLIC_BASE_URL>/v1/oauth/withings/callback`; notification callback
  `<PUBLIC_BASE_URL>/v1/webhooks/withings` must be public HTTPS.
- Epic: patient-facing app with the non-production client id first (`EPIC_CLIENT_ID`); redirect URI
  `<PUBLIC_BASE_URL>/v1/oauth/clinical_fhir/callback`.
- AI: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`; sharing stays off until Ben enables it.
Each connector flips from BLOCKED BY CREDENTIALS to TESTED AGAINST LIVE API only after a real
round trip is observed and recorded in `docs/testing.md`.

## 7. Android release
- Build: `./gradlew :app:assembleRelease` with a signing config supplied through
  `~/.gradle/gradle.properties` (`BHO_KEYSTORE`, `BHO_KEYSTORE_PASSWORD`, `BHO_KEY_ALIAS`,
  `BHO_KEY_PASSWORD`); the release build type enables R8 and uses the production
  `bho.apiBaseUrl` property (HTTPS only; cleartext is debug-only).
- Play Console: the Health Connect data-type declaration and the privacy policy URL
  (`PermissionsRationaleActivity` already shows the in-app policy) are required before review;
  `READ_HEALTH_DATA_HISTORY` and `READ_HEALTH_DATA_IN_BACKGROUND` need their justification text.
- Versioning: `versionCode`/`versionName` in `apps/android/app/build.gradle.kts`.
- Toolchain upgrade (AGP 9 / Gradle 9 / compileSdk 37) remains deferred per ADR 0003 until it can
  be verified on the build machine and the device.

## 8. Go-live checklist
- [ ] `AUTH_MODE=supabase`, `ALLOW_DEMO_SEED=false`, `NODE_ENV=production`
- [ ] `TOKEN_ENCRYPTION_KEY` generated and stored in the host's secret manager
- [ ] `/ready` green from the web container and from the phone's network
- [ ] Jobs scheduled and a first manual run of each returns 200
- [ ] Backups configured and one restore rehearsal done
- [ ] Connector redirect URIs registered; webhook endpoints reachable over HTTPS
- [ ] Device verification pass (`docs/device-setup.md`) recorded in `docs/testing.md`
