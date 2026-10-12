# Stelo, Cronometer, Function Health, clinical FHIR, Supabase, Apollo, Samsung — verification report (checked 2026-10-12)

Research notes gathered from official sources on 2026-10-12. Items marked UNVERIFIED could not be confirmed and must not be treated as facts.

## 1. Dexcom Stelo
- **Health Connect: YES (official).** Stelo FAQ: share via *Settings > Connections*; apps named are Apple Health and Google Health Connect. "Stelo sends your glucose data to health apps with a 3-hour delay." "Stelo checks your health app every 5 minutes when the Stelo app is open." https://www.stelo.com/en-us/faqs/using-stelo/how-do-i-share-my-glucose-data-with-health-apps
- **Dexcom Developer API v3 and Stelo: NOT DOCUMENTED (UNVERIFIED).** The v3 endpoint overview says the API "supports patient data from Dexcom G6, G7, G7 15-day, Dexcom ONE, and Dexcom ONE+"; Stelo is not mentioned. https://developer.dexcom.com/docs/dexcomv3/endpoint-overview
- **Latency (official):** mobile-app uploads available "with a one-hour delay in the United States"; OAuth 2.0 required; 60,000 calls/app/hour; 30-day max query window. OAuth: `/v3/oauth2/login`, `/v3/oauth2/token`, `scope=offline_access`, access token 7200 s, single-use refresh token valid up to 1 year. https://developer.dexcom.com/docs/dexcom/authentication
- **Exports:** Clarity CSV export exists for Dexcom users (https://www.dexcom.com/en-us/faqs/can-i-export-raw-data); Stelo works with Clarity (up to 90 days) https://www.stelo.com/en-us/faqs/using-stelo/does-stelo-work-with-dexcom-clarity . Whether Stelo Clarity accounts expose the CSV export: UNVERIFIED. In-app Stelo export: none found.

**Classification:** HEALTH CONNECT (primary, 3-hour source latency); FILE IMPORT (Clarity CSV, unverified for Stelo); Dexcom API = UNSUPPORTED for Stelo until documented.

## 2. Cronometer
- **Health Connect: YES (official, article updated 2026-09-30).** Cronometer *exports* to Health Connect: biometrics (blood glucose, BP, body fat, temp, body water, HR, resting HR, HRV, height, SpO2, respiratory rate, weight) and "Nutrition: Food, Water". Path: More > Connect Apps & Devices > Health Connect. https://support.cronometer.com/hc/en-us/articles/22731903751316-Health-Connect . Only one Android health app at a time. https://cronometer.com/blog/health-connect/
- **Public API: NO.** Staff: "we do not currently have plans for a public API". https://forums.cronometer.com/discussion/3365/any-chance-a-public-api-for-cronometer-will-be-available
- **Exports (official, updated 2026-09-25):** "Export your data as a .csv file… diary entries, exercises, biometrics, notes, and nutrition summaries." Daily Nutrition has an "Include diary group rows" option. https://support.cronometer.com/hc/en-us/articles/360018760151-Account-Settings . Tier gating UNVERIFIED. Column format is not officially documented; third-party notebooks show Servings columns `Day, Food Name, Amount, Energy (kcal), Category` + nutrient columns — UNVERIFIED; the importer therefore maps columns by header name with a review step.

**Classification:** HEALTH CONNECT (nutrition totals) + FILE IMPORT (CSV, header-mapped). No API is invented.

## 3. Function Health
- **PDF download: YES (official).** "Once your results are ready, you can log in and download them as a PDF to share with your healthcare provider." https://www.functionhealth.com/faq
- **CSV export:** not in the official FAQ — UNVERIFIED.
- **Lab provider:** "We partner with Quest for easily accessible labs."
- **API:** no public API found. An official AI connector exists ("Made by Function"; FAQ: "securely connect Function to vetted AI partners including ChatGPT, Claude, and Perplexity"). https://claude.com/connectors/function

**Classification:** FILE IMPORT (PDF with review-and-confirm staging; CSV if available). No API is assumed.

## 4. Clinical records
- **Weill Cornell Medicine:** Weill Cornell Connect is "MyChart® licensed from Epic" (https://weillcornell.org/weill-cornell-connect). Listed on Epic's patient-access endpoint directory as "Weill Cornell Medicine", R4 base `https://epicproxy-pub.et1089.epichosted.com/FHIRProxy/api/FHIR/R4/`. https://open.epic.com/MyApps/Endpoints
- **NYU Langone:** Epic, R4 base `https://epicfhir.nyumc.org/FHIRPRD/api/FHIR/R4`.
- **Epic patient-facing app requirements:** register on fhir.epic.com (non-production and production client IDs); standalone launch presents a MyChart login; patients authorize specific data types (revocable); PKCE S256; discover endpoints via `/.well-known/smart-configuration`. https://fhir.epic.com/Documentation?docId=oauth2 ; https://fhir.epic.com/Documentation?docId=patientfacingfhirapps . Apps "SHOULD NOT perform runtime queries for endpoint data hosted on open.epic.com" — mirror the endpoint bundle.
- **One Medical (1Life):** Apple Health Records supported; records download in app (My Health > Get My Records) or web https://www.onemedical.com/records/ . No patient-facing FHIR API or Health Connect found — UNVERIFIED (negative).
- **Health Connect medical records:** Android 16 APIs, `ExperimentalPersonalHealthRecordApi`, Play policy "still being developed"; FHIR R4/R4B; 14 resource types. https://developer.android.com/health-and-fitness/guides/medical-records

**Classification:** CLINICAL FHIR (Weill Cornell, NYU Langone via Epic patient-access, requires Epic app registration — BLOCKED BY CREDENTIALS); FILE IMPORT (One Medical record downloads).

## 5. Supabase
- **JWT verification:** asymmetric signing keys (ES256 recommended, RS256 supported); HS256 and the legacy JWT secret are "not recommended for production". JWKS: `https://<project>.supabase.co/auth/v1/.well-known/jwks.json` (edge-cached 10 min). Verify with jose `createRemoteJWKSet` + `jwtVerify`. https://supabase.com/docs/guides/auth/signing-keys , https://supabase.com/docs/guides/auth/jwts
- **RLS:** use `(select auth.uid()) = user_id`, `to authenticated`, one policy per operation; service_role bypasses RLS. https://supabase.com/docs/guides/database/postgres/row-level-security
- **CLI:** local stack "runs in Docker containers, so you need a container runtime installed first." https://supabase.com/docs/guides/local-development/cli/getting-started
- **Versions (npm, 2026-10-12):** `@supabase/supabase-js` 2.117.3 (Node ≥22); `@supabase/ssr` 0.12.7. Next.js guide: `proxy.ts` on Next 16 (`middleware.ts` ≤15); "Always use `supabase.auth.getClaims()` to protect pages". https://supabase.com/docs/guides/auth/server-side/nextjs
- **Edge Functions/cron:** Deno runtime; scheduling via pg_cron + pg_net with Vault secrets. https://supabase.com/docs/guides/functions/schedule-functions

## 6. Apollo Neuro
Official help FAQ (updated 2026-04-03): Apple Health (iOS) logs usage as Mindful Minutes; Oura data sync for SmartVibes. No Health Connect, Google Fit, or public API anywhere in the help center — UNVERIFIED (none exist as far as official docs show). **Classification:** MANUAL (experiment adherence is logged by the user).

## 7. Samsung Health / Oura
- **Samsung Health → Health Connect: YES** (official developer FAQ: since v6.22.5, enable in Samsung Health > Settings > Health Connect). https://developer.samsung.com/health/health-connect-faq.html
- **Oura → Health Connect: YES (official).** Exports: active calories, distance, exercise, steps, height, weight, sleep, heart rate, HRV; requires Gen2, or Gen3+ with membership. https://support.ouraring.com/hc/en-us/articles/10786105824531
