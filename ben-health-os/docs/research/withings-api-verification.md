# Withings Public API for BPM blood-pressure import — verification report (checked 2026-10-12)

Research notes gathered from official Withings documentation on 2026-10-12. Items marked UNVERIFIED could not be confirmed and must not be treated as facts.

Primary sources: OpenAPI spec https://developer.withings.com/openapi.yaml (rendered at https://developer.withings.com/api-reference/), the official AI reference https://developer.withings.com/llms.md, and the Public API guide pages below. Many old guide URLs now redirect to the home page.

## 1. Developer registration
- Dashboard: https://developer.withings.com/dashboard/ (self-service; "No contract required"). Create a Withings account (ideally a shared org account), create the app to get `client_id`/`client_secret`. Only one environment for WiFi/BLE devices: "EU Medical Cloud / Public Cloud", endpoint https://wbsapi.withings.net, "There are no prerequisites, and free access is provided" — https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/developer-account/create-your-accesses-no-medical-cloud/
- Public API is for "individuals and companies—whether or not they have a Withings contract".
- Plans (https://developer.withings.com/developer-guide/v3/withings-solutions/withings-api-plans/): "Start for Free" = self-serve, **10 active users**, more after a Withings review (needs client ID, demo link, privacy-policy URL). Enterprise = unlimited users, US-hosted/HIPAA, contract. **New: "Withings+ becomes required on the Start for Free API plan from October 12, 2026"** — end-user accounts created after that date need a Withings+ membership to share data with free-plan apps (pre-existing accounts grandfathered; Enterprise lifts it). "Can my users share through Apple Health or Google Health instead? No. The requirement covers those routes too."

> Product consequence: Ben's existing Withings account should be grandfathered; the Data Sources screen must surface a clear "membership required" state if the API returns an authorization error tied to this policy.

## 2. OAuth2
- Authorize: `https://account.withings.com/oauth2_user/authorize2?response_type=code&client_id=…&scope=user.info,user.metrics,user.activity&redirect_uri=…&state=…` (+ optional `mode=demo`). Code "only valid for 30 seconds". Scopes: `user.info` (account info, linked devices, goals), `user.metrics` (health measurements, heart recordings…), `user.activity` (activity & sleep), `user.sleepevents` (bed in/out notifications).
- Token: `POST https://wbsapi.withings.net/v2/oauth2`, `action=requesttoken`; `grant_type=authorization_code` + `client_id, client_secret, code, redirect_uri`; refresh: `grant_type=refresh_token` + `client_id, client_secret, refresh_token`. Response body: `userid, access_token, refresh_token, expires_in (10800 seconds), scope, csrf_token, token_type: Bearer`.
- Lifetimes: access token "Expires after 3 hours"; refresh token "Expires after 1 year"; "each time you request a new access_token, you also receive a new refresh_token"; the old refresh token "Expires 8 hours after new issuance or once the new access_token is used"; "Always replace the previous refresh_token". Refresh on status 343.
- Signature/nonce (`action=getnonce`, HMAC-SHA256 of sorted params) is only needed for contracted-partner services; for Health Data calls "use a valid access_token in the header but don't use signature and nonce". Not needed for a BPM import.

## 3. Measure API (`measure-getmeas`)
- `POST https://wbsapi.withings.net/measure`, `action=getmeas`, Bearer header. Params: `meastype` (int), `meastypes` (comma list), `category` (1 real measures, 2 objectives), `startdate`/`enddate` (unix ts), `lastupdate` ("data that were updated or created after this date… Use this instead of startdate + enddate"), `offset`.
- Response `body`: `updatetime`, `timezone`, `measuregrps[]`, `more`, `offset`. Each measuregrp: `grpid, attrib, date (UNIX ts taken), created, modified, category, deviceid, hash_deviceid, model (e.g. "BPM Connect"), measures[]`. Each measure: `value, type, unit, algo, fm`; real = `value * 10^unit`. A BP reading = one group with systole, diastole, heart-rate measures.
- meastype: 1 Weight kg; 4 Height; 5 Fat Free Mass; 6 Fat Ratio %; 8 Fat Mass Weight; **9 Diastolic (mmHg); 10 Systolic (mmHg); 11 Heart Pulse (bpm)**; 12 Temperature; 54 SpO2 %; 71 Body Temperature; 73 Skin Temp; 76 Muscle Mass; 77 Hydration; 88 Bone Mass; 91 PWV; 123 VO2max; 130 AFib result; 135–139 ECG intervals; 155 Vascular age; 226 BMR; 227 Metabolic age.
- attrib: 0 captured by device, known to belong to this user; 1 device-captured but ambiguous (may belong to other users); 2 entered manually; 4 manual during user creation (may be inaccurate); 5 "Measure auto, it's only for the Blood Pressure Monitor. This device can make many measures and computed the best value"; 7 user-confirmed; 8 same as 0; 15 guided conditions (NHS).

## 4. Pagination / incremental sync
`offset`: "When a first call returns more:1 and offset:XX, set value XX… to retrieve next available rows". "You MUST loop until more = 0"; "The updatetime in each response is your next lastupdate value"; "Do not poll more than once every 10 minutes per user".

## 5. Notifications (webhooks)
- `POST https://wbsapi.withings.net/notify`; actions `subscribe` (callbackurl, appli, optional comment; per user), `get`, `list`, `revoke`, `update`.
- appli (https://developer.withings.com/developer-guide/v3/data-api/notifications/notification-content/): 1 weight & body comp; 2 temperature; **4 "Blood pressure & heart rate"** (9/10/11 + SpO2); 16 activity; 44 sleep summary; 46 user profile change; 50/51/52 bed in/out/inflated; 53 unassociated device; 54 ECG; 55 ECG failed; 58 glucose; 60 survey; 61 stethoscope; 62 HRV; 63 urine; 98–100 bed polls. Caution: llms.md prints a conflicting appli table — trust the dedicated page/spec.
- Callback: HTTPS only, no IP/localhost, ports 80/443, ≤255 chars, "Must respond to HTTP HEAD requests… Withings sends a HEAD request to verify your URL… before registering it" (2xx); otherwise the app is "limited to 10 linked users".
- Payload: `application/x-www-form-urlencoded` POST with `userid, appli, startdate, enddate` (e.g. `userid=12345&appli=4&startdate=1530576000&enddate=1530576120`); **no values** — fetch via getmeas using the payload's range.
- Delivery: return 2xx "within a few seconds"; if not HTTP<400, retries at +10s, +1min, +1h, +4h, 2 HTTP attempts per cycle (10 total); after 4 consecutive failures warning emails; after 20 days unresolved the subscription is auto-cancelled; "Missed notifications are not redelivered" → backfill with lastupdate; typical delay <2 min, no SLA on the standard plan.

## 6. Rate limits & errors
- Live plans page: Start for Free "Standard rate limits"; Enterprise "1,500+ requests/minute". The "120 requests/minute per project" figure is UNVERIFIED on the live page.
- Envelope `{status, body}`; `status` 0 = success. Families: 100..102/200/401 Authentication failed; 2xx/3xx Invalid params (incl. 247 invalid userid, 250 userid mismatch, 286 no such subscription, 293 callback URL wrong, 294 no callback, 304 auth code wrong, 305 missing param, 342 bad client credentials, 343 bad access token); 214/277/2553/2555 Unauthorized; 522 Timeout; **601 "Too many request"**; 2554 Not implemented.

## 7. Google Health Connect
Official article "Exporting Withings data into Health Connect" (Profile → Settings → "Export health data to Health Connect"): https://support.withings.com/hc/en-us/articles/27322856325905 — lists no data types. BPM Vision FAQ says the app "syncs with: Apple Health, Google Health Connect, Samsung Health": https://support.withings.com/hc/en-us/articles/33546946659601. Whether blood pressure specifically is written to Health Connect: UNVERIFIED. The system therefore deduplicates BP across Withings API and Health Connect defensively rather than assuming either path.

## 8. Device provenance
measuregrp `deviceid`/`hash_deviceid` + `model`. `POST https://wbsapi.withings.net/v2/user action=getdevice` (scope user.info) → `devices[]`: `type, model, model_id, battery` (high/medium/low), `deviceid, hash_deviceid, timezone`, `first_session_date, last_session_date`. model_id 1060 = "Google Health Connect" source.

## 9. Timezone
`date/created/modified` are UNIX timestamps; `timezone` is a body-level string (e.g. "America/New_York") — there is no per-measuregrp timezone field. Device timezone is available via getdevice.
