# Oura API v2 — verification report (checked 2026-10-12)

Research notes gathered from official Oura documentation on 2026-10-12. Items marked UNVERIFIED could not be confirmed and must not be treated as facts.

**Primary sources:** auth docs [S1](https://cloud.ouraring.com/docs/authentication); OpenAPI spec v1.41 loaded by `/v2/docs` [S2](https://cloud.ouraring.com/v2/static/json/openapi-1.41.json); error handling [S3](https://cloud.ouraring.com/docs/error-handling); getting started [S4](https://cloud.ouraring.com/docs/); API Agreement [S5](https://cloud.ouraring.com/legal/api-agreement); Member Care article (updated Oct 1 2026) [S6](https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API); Partner Support article (updated Oct 5 2026) [S7](https://partnersupport.ouraring.com/hc/en-us/articles/20949682312211-The-Oura-API); Counsel blog [S8](https://ouraring.com/blog/counsel-integration-oura-app/). Older spec versions (1.35–1.40) now 404; 1.41 is the only hosted spec.

## 1. OAuth2
- **Authorize:** `https://cloud.ouraring.com/oauth/authorize`; **Token:** `https://api.ouraring.com/oauth/token`; **Revoke:** `https://api.ouraring.com/oauth/revoke?access_token=…` [S1][S2]. **New universal link** `https://developer.ouraring.com/authorize` "for new OAuth clients"; on supported mobile devices it opens consent inside the Oura app [S1].
- **Grants:** `authorization_code` + `refresh_token` (server-side); an implicit "client-side only flow" (`response_type=token`) is still documented, no refresh, token "currently set to 30 days" [S1].
- **PKCE:** `code_challenge` marked **"Recommended"** (not required); `code_challenge_method` must be `S256`; verifier 43–128 chars; `code_verifier` required at exchange if a challenge was sent [S1].
- **Tokens:** response has `token_type=bearer`, `access_token`, `expires_in`, `refresh_token`; "The refresh token is single-use" [S1]. Lifetime: example `expires_in=2592000` (30 d) [S1]; spec FAQ says tokens "typically last 30 days" but its troubleshooting section says "typically 24 hours" — **official docs are inconsistent** [S2]. Auth codes valid 10 min [S2]. Client auth via body params or HTTP Basic, `application/x-www-form-urlencoded` [S1].
- **Registration:** create apps in the new portal `https://developer.ouraring.com/`; "previous developer portal" `https://cloud.ouraring.com/oauth/applications` remains for editing existing apps [S7]. Apps capped at **10 users until approved by Oura** [S2][S4].
- **Redirect URI:** registered URIs "act as a whitelist"; must match exactly, URL-encoded; may be omitted only if exactly one is registered; the token request must repeat the same value [S1].
- **PATs:** "personal access tokens were deprecated in December 2025 and are no longer available for use" [S2].

## 2. Scopes
Spec lists 9: `email`, `personal` (gender/age/height/weight), `daily` (daily sleep/activity/readiness summaries), `heartrate` (time-series HR), `workout`, `tag`, `session`, `spo2` (daily sleep SpO2 average), `heart_health` ("Heart health data") [S2]. The auth page lists only the first 8 [S1]. `scope` omitted = all scopes requested; users can toggle scopes at consent. **No per-endpoint scope mapping exists** in the spec; mapping of `heart_health` to `daily_cardiovascular_age`/`vO2_max`, and which scope gates `daily_stress`, `daily_resilience`, `sleep_time`, `rest_mode_period`, `ring_configuration`, `enhanced_tag`: **UNVERIFIED** (undocumented).

## 3. Endpoints (`GET https://api.ouraring.com/v2/usercollection/…`) [S2]
- **`start_date`/`end_date` + `next_token` + `fields`:** `daily_activity`, `daily_cardiovascular_age`, `daily_readiness`, `daily_resilience`, `daily_sleep`, `daily_spo2`, `daily_stress`, `enhanced_tag`, `rest_mode_period`, `session`, `sleep`, `sleep_time`, `tag` (deprecated → enhanced_tag), `vO2_max` (capital O), `workout`. Params accept `date` or `date-time`.
- **`start_datetime`/`end_datetime` + `next_token` + `latest` + `fields`:** `heartrate`, `ring_battery_level` (`+` in offsets must be `%2B`).
- **`ring_configuration`:** `fields`, `next_token` only. **`personal_info`:** none.
- Every collection also has `/{document_id}`. Responses: `{"data":[…],"next_token":…}`. Default range when dates omitted: not stated — UNVERIFIED.

## 4. Fields [S2]
- **`sleep`:** `id, day, bedtime_start, bedtime_end, period, type, time_in_bed, total_sleep_duration, deep/light/rem_sleep_duration, awake_time, efficiency, latency, restless_periods, average_breath, average_heart_rate, average_hrv, lowest_heart_rate, heart_rate{interval,items[],timestamp}, hrv{…}, movement_30_sec, sleep_phase_5_min, sleep_phase_30_sec, app_sleep_phase_5_min, readiness{score, contributors{…}, temperature_deviation, temperature_trend_deviation}, readiness_score_delta, sleep_score_delta, sleep_algorithm_version, sleep_analysis_reason, low_battery_alert, ring_id (deprecated, null)`. No standalone temperature field; temperature lives in nested `readiness`.
- **`daily_readiness`:** `score, temperature_deviation, temperature_trend_deviation, day, timestamp, contributors{activity_balance, body_temperature, hrv_balance, previous_day_activity, previous_night, recovery_index, resting_heart_rate, sleep_balance, sleep_regularity}`.
- **`daily_sleep`:** `score, day, timestamp, contributors{deep_sleep, efficiency, latency, rem_sleep, restfulness, timing, total_sleep}`.
- **`daily_activity`:** `score, steps, active_calories, total_calories, target_calories, average_met_minutes, {high,medium,low,sedentary}_met_minutes, {high,medium,low}_activity_time, sedentary_time, resting_time, non_wear_time, met{sample}, class_5_min, equivalent_walking_distance, meters_to_target, target_meters, inactivity_alerts, contributors{…}`.

## 5. Webhooks [S2]
- Routes: `GET/POST /v2/webhook/subscription`, `GET/PUT/DELETE /v2/webhook/subscription/{id}`, `PUT /v2/webhook/subscription/renew/{id}`; auth = headers **`x-client-id` + `x-client-secret`** (no bearer).
- Create body: `callback_url, verification_token, event_type (create|update|delete), data_type`; one subscription per (event_type, data_type). `data_type` enum: `tag, enhanced_tag, workout, session, sleep, daily_sleep, daily_readiness, daily_activity, daily_spo2, sleep_time, rest_mode_period, ring_configuration, daily_stress, daily_cardiovascular_age, daily_resilience, vo2_max, meal`.
- **Verification:** Oura `GET`s `callback_url?verification_token=…&challenge=…`; respond JSON `{"challenge":"…"}`.
- **Events:** `POST` with headers `x-oura-signature` (HMAC-SHA256, uppercase hex, over `timestamp + JSON body`, keyed by client secret) and `x-oura-timestamp`; body `{event_type, data_type, object_id, event_time, user_id}`. Respond 2xx within 10 s; 10 retries per failure class, "about an hour"; HTTP 410 auto-cancels.
- Subscription objects carry `expiration_time` and must be renewed; the lifetime is not stated — UNVERIFIED.

## 6. Rate limits & sandbox
- "5000 requests in a 5 minute period" [S3][S2 FAQ]; two layers (per-token, per-application) with 429 headers `Retry-After, X-RateLimit-Limit, X-RateLimit-Window, X-RateLimit-Reset, X-RateLimit-Tier` [S2].
- Sandbox: `/v2/sandbox/usercollection/<type>` for 18 types (all except `personal_info`), fake generated data, shares your rate limit [S2]. Any non-empty bearer token works against the sandbox.

## 7. Membership & terms
- "Gen3 and later users without active Oura Membership can't access their data through the Oura API"; 403 = "user's Oura subscription has expired" [S6][S7][S2].
- **API Agreement, effective June 8 2026** [S5]: §4(a) prohibits (ii) competitive use/benchmarking, (iii)-(iv) AI training/embeddings, (vi) selling/sharing user data, (vii) advertising/commercial targeting, (ix) competing products, (xiii) charging users for MCP-related access, (xvi) scraping; **§4(d) LLM use only via Oura's "MCP Server", API may not "prompt, or otherwise provide input" to AI models**; §2(d) aggregators need a separate written agreement; §3(h) Oura may introduce fees incl. "differentiated pricing for business users".

> Product consequence (see docs/integrations.md and docs/recommendation-safety.md): Oura-API-sourced records are excluded from AI analysis packets by default. The AI data-sharing controls carry a per-source switch, and the Oura switch stays off until the user has reviewed the API Agreement.

## 8. Latency & timestamps [S2]
Pipeline: ring → app sync → cloud processing → API. Sleep/sleep_time/readiness sync only when the user opens the app; daily activity, stress, heart rate sync in background; webhooks ≈30 s after sync. "All timestamps … use ISO 8601 format with timezone information"; date params "interpreted in the user's local timezone"; `heartrate.timestamp` is UTC plus `timestamp_unix` (ms); `sleep_time` exposes `day_tz` offset seconds.

## 9. Oura Advisor / Counsel Health
Zero occurrences of "advisor"/"counsel" in spec 1.41 or docs. Counsel is an in-app Oura Labs feature from June 16 2026 [S8]. API exposure of Advisor/Counsel data: **UNVERIFIED (not documented)**.
