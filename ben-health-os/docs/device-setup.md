# Physical device setup — Samsung Galaxy S26 Ultra (Android 17)

## 1. Backend reachable from the phone
- Run Postgres + API on your Mac: `pnpm run db:reset && pnpm --filter @bho/api build && pnpm run dev:api`.
- Find the Mac's LAN IP (`ipconfig getifaddr en0`) and confirm from the phone's browser that
  `http://<ip>:8787/health` returns `{"status":"ok"}` (same Wi-Fi; macOS firewall may prompt).
- Optional: run the web dashboard too (`pnpm run dev:web`) and sign in with the same email.

## 2. Install the app
- Enable Developer options → USB debugging on the phone.
- `cd apps/android && ./gradlew :app:installDebug` (or open in Android Studio and Run).
- The debug build id is `com.benhealthos.app.debug`.

## 3. Onboarding on the phone
1. API base URL: `http://<ip>:8787`; email: any address (local mode). "Continue" verifies `/v1/me`.
2. Health Connect: the app reports availability. On Android 14+ Health Connect is built in; if the
   app says "install/update", follow the Play Store link.
3. Tap **Grant Health Connect access** → the system sheet lists the 21 read permissions plus
   background and history reads when the device supports them. Granting a subset is fine; missing
   permissions show as NOT CONNECTED for those metrics.
4. **Sync now** runs the initial backfill (30 days, or up to a year with history permission) and
   shows per-type results. Then Finish.

## 4. Make sure the writers are feeding Health Connect
- Oura app: Settings → Health Connect → enable export (membership required).
- Samsung Health: Settings → Health Connect → sync on.
- Withings app: Profile → Settings → "Export health data to Health Connect".
- Stelo app: Settings → Connections → Health Connect (3-hour delay by design).
- Cronometer: More → Connect Apps & Devices → Health Connect (one Android health app at a time).

## 5. What to verify (and report back)
- Data Sources → Health Connect: granted count, devices discovered (Oura ring, phone, Withings
  cuff/scale, Stelo, Cronometer), per-type sync state, no "manifest is missing" warning.
- Today: values with "via Health Connect" sources and realistic freshness; steps not doubled.
- Background: leave the phone overnight; the sync log should show PERIODIC entries if the
  background-read permission was granted, otherwise only APP_OPEN/MANUAL entries (expected).
- Lock: background the app for > 60 s → biometric prompt on return.
- Export: Settings → Export all (JSON) shares a file with every table.

## Known caveats
- Health Connect enforces undocumented rate quotas; if a sync reports "rate limited", wait and
  retry (the worker backs off automatically).
- Records older than 30 days before the first grant are only available with the history permission.
- Cleartext HTTP is for the LAN development setup only; use HTTPS for any remote deployment.
