# Environment variables and required credentials

## API (`services/api`)
| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Local: `postgres://bho:bho@127.0.0.1:5432/ben_health_os`. Hosted: the Supabase project's connection string (service connection; the API switches to role `authenticated` per request). |
| `AUTH_MODE` | yes | `local` (dev tokens, refused in production) or `supabase`. |
| `LOCAL_JWT_SECRET` | local | ≥16 chars; signs dev tokens. |
| `SUPABASE_URL` | supabase | `https://<project>.supabase.co`; JWKS is derived from it. |
| `SUPABASE_JWKS_URL` | optional | Override JWKS endpoint. |
| `SUPABASE_JWT_SECRET` | optional | Legacy HS256 fallback only. |
| `TOKEN_ENCRYPTION_KEY` | Phase 2 | base64 of 32 random bytes (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`); encrypts OAuth tokens at rest. |
| `ALLOW_DEMO_SEED` | optional | default true; set false in production. |
| `CORS_ORIGINS` | optional | comma-separated web origins. |
| `PUBLIC_BASE_URL` | Phase 2 | public HTTPS URL for OAuth redirects and webhooks. |
| `WEB_BASE_URL` | Phase 2 | where OAuth callbacks redirect web users (default `http://localhost:3000`). |
| `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET` | Phase 2 | from https://developer.ouraring.com/; redirect URI `<PUBLIC_BASE_URL>/v1/oauth/oura/callback`. Enables the Oura connector. |
| `OURA_WEBHOOK_VERIFICATION_TOKEN` | Phase 2 | random string used in the Oura subscription handshake (defaults to a random per-process value; set it so restarts keep subscriptions valid). |
| `OURA_HISTORY_DAYS` | optional | initial import depth (default 90). |
| `OURA_API_BASE`, `OURA_AUTH_BASE` | tests | override endpoints (mock servers). |
| `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET` | Phase 2 | from https://developer.withings.com/dashboard/; redirect URI `<PUBLIC_BASE_URL>/v1/oauth/withings/callback`; notification callback `<PUBLIC_BASE_URL>/v1/webhooks/withings` must be public HTTPS. |
| `WITHINGS_HISTORY_DAYS` | optional | initial import depth (default 730). |
| `WITHINGS_API_BASE`, `WITHINGS_ACCOUNT_BASE` | tests | override endpoints (mock servers). |
| `JOB_SECRET` | Phase 2/3 | shared secret for `POST /internal/jobs/reconcile` (hourly) and `POST /internal/jobs/derive` (nightly) via header `x-job-secret`; schedule with pg_cron + pg_net or a container cron. |
| `PORT`, `HOST`, `LOG_LEVEL`, `NODE_ENV` | optional | defaults 8787 / 0.0.0.0 / info / development. |

## Web (`apps/web`)
`API_BASE_URL` (server-side), `NEXT_PUBLIC_AUTH_MODE` (`local`|`supabase`),
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (supabase mode).

## Android
Build property `bho.apiBaseUrl` (default `http://10.0.2.2:8787` for the emulator); the URL is also
editable in Settings. For a physical phone use `http://<your-machine-lan-ip>:8787` on the same
Wi-Fi, or an HTTPS deployment. Cleartext HTTP to private LAN addresses is allowed by the debug
build only.

## Credentials and approvals Ben must provide (nothing else is blocked)
1. **Supabase project** (URL, publishable key, database connection string) — for hosted auth and
   database. Local mode works without it.
2. **Oura developer app** at https://developer.ouraring.com/ (client id/secret, redirect URI
   `<PUBLIC_BASE_URL>/v1/oauth/oura/callback`); the app is limited to 10 users until Oura review.
   Active Oura Membership on the account.
3. **Withings developer app** at https://developer.withings.com/dashboard/ (client id/secret,
   redirect URI `<PUBLIC_BASE_URL>/v1/oauth/withings/callback`, HTTPS callback URL for notifications).
4. **Epic patient-facing app registration** at https://fhir.epic.com (Phase 5) for Weill Cornell /
   NYU Langone FHIR access.
5. **Google Play Console** health declaration + privacy policy URL before a store release (Phase 8).
6. **AI provider API key** (Phase 6) — a consumer ChatGPT/Claude subscription is not an API.
7. The **Samsung Galaxy S26 Ultra** itself for TESTED ON PHYSICAL DEVICE verification
   (`docs/device-setup.md`).
