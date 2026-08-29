# BEN HEALTH OS — Production Build Brief (Version 2.0)

> Verbatim product/engineering brief provided by the owner on 2026-08-29.
> This is the requirements source of truth; docs/ and docs/contracts/ derive
> from it. Where this brief and docs/contracts/phase1-contracts.md disagree on
> implementation detail, the contracts file governs Phase 1 code.

The application is a private personal health application called Ben Health OS.
It is initially private and single-user, for Ben. Architect it cleanly enough
that it could later support multiple users, but do not impose multi-user
complexity on the first release unless necessary for sound security or data
isolation.

The primary question the product must answer:

"Given everything currently known about my health, physiology, behavior,
nutrition, recovery, clinical history, medications, labs, and experiments,
what has changed, what matters, and what should I do next?"

The product must transform fragmented health information into:

1. A coherent longitudinal health record
2. A source-aware executive dashboard
3. A reliable data-quality and freshness system
4. Personal-baseline trend analysis
5. Evidence-linked recommendations
6. Structured health experiments
7. Weekly Health CEO reports
8. Monthly Health Board reports
9. Physician-ready summaries
10. High-signal alerts without health-anxiety gamification

It must not pretend to be a physician, diagnose disease, autonomously alter
medications, or make unsupported treatment claims. If a requested capability
would materially change the product into regulated medical-device
functionality, document that concern before implementing it.

---

## 1. Execution rules

- Work directly in the repository; build incrementally; compile and test
  continuously; do not stop at plans or pseudocode.
- Only pause for blockers only the owner can resolve (signing access, OAuth
  app credentials, callback domains, backend credentials, API keys, material
  privacy/product decisions). When blocked: explain the exact action needed,
  give setup instructions, continue all unblocked work with mocked/fixture
  data.
- Never ask for account passwords; use official OAuth only.
- Before implementing an external integration: consult current official docs,
  record URL and access date in docs/integrations.md, confirm the API/scope
  exists, do not rely on old blog posts or reverse engineering, do not scrape
  portals or private mobile APIs, do not claim an integration works until
  tested or clearly labeled mocked.
- End-of-phase reports: files changed, decisions, commands, build/test
  results, known issues, credentials still required, next slice.

## 2. Target product architecture

Two product surfaces over one normalized health-data platform.

### A. Native iPhone/iPad application (primary; Apple Health gateway)
Swift, SwiftUI, latest stable Swift language mode, Observation APIs,
async/await, Swift Charts, HealthKit, App Intents where useful,
BackgroundTasks where appropriate, secure local storage, accessibility, light
and dark mode. Detect installed Xcode/SDK before choosing deployment target;
document in an ADR. Prefer modern target; no beta-only APIs unless requested.
Must remain useful with intermittent connectivity; cache important recent data
locally.

### B. Responsive Mac/web dashboard
HealthKit ingestion does not occur on macOS. Next.js + TypeScript, disciplined
component system, accessible responsive design, well-supported charting
library. Works in Safari on Mac/iPhone/iPad and as a PWA window. No separate
macOS app in early phases without a compelling documented benefit.

### C. Secure backend
Required for server-side OAuth (Withings/Oura), protected client secrets,
webhook endpoints, token refresh. Preferred: PostgreSQL, Supabase Auth/DB or
well-supported equivalent, row-level security, server-side functions for
OAuth/refresh/webhooks/AI/document parsing, versioned migrations, generated
typed clients where appropriate. A different backend requires a written ADR.
No CloudKit/iCloud as the store for personal medical or health records. No
OAuth client secrets, LLM keys, service-role keys, or DB admin credentials in
iOS or web clients.

## 3. Core architectural principle — source-aware freshness

The app is not universally "real-time". For every connection and important
metric, maintain: measured_at, source_synced_at (when known), ingested_at,
normalized_at, last_connector_success_at, expected source latency, observed
current latency, source name/device/application, external source identifier,
freshness status, quality/confidence status. Statuses: CURRENT, RECENT,
DELAYED BY SOURCE, STALE, SYNC ERROR, NOT CONNECTED, INSUFFICIENT DATA. Never
the word LIVE unless truly a verified live stream. Charts and recommendations
reflect measurement timestamps, not receipt time.

## 4. Ben's existing health stack

Apple Health; Oura Ring + membership; Oura/Counsel Health premium clinician
chat; Dexcom Stelo; Cronometer Gold; Function Health; Withings BP cuff +
account; One Medical; Gil Weitzman / Weill Cornell; other providers via Apple
Clinical Health Records; ChatGPT Health; Apollo Neuro.

Do not assume every named service exposes a public API. ChatGPT Health,
Counsel Health, One Medical, and provider portals are not developer APIs and
must not be scraped. Ingest via Apple Health, HealthKit clinical-record types,
official OAuth APIs, structured imports; produce shareable summaries.

## 5. Source priority (canonical-source policy; provenance never erased)

- Blood pressure: 1) direct Withings API; 2) Withings-originated Apple Health;
  3) other validated Apple Health device; 4) manual entry.
- Oura scores/contributors: 1) direct Oura API; 2) Apple Health standardized
  measurements; 3) manual/imported. Never recreate Readiness/Sleep Score and
  present as official Oura values.
- Glucose: 1) Stelo-originated Apple Health samples; 2) other identified
  source; 3) manual import. Always show Stelo's source delay; never present as
  current live glucose.
- Nutrition: 1) Cronometer-originated Apple Health samples when complete;
  2) structured Cronometer CSV export; 3) manual. Verify actual source
  coverage; don't assume meal-level completeness.
- Labs: 1) original clinical record/structured lab result; 2) Function Health
  structured export; 3) user-supplied PDF parsed with review; 4) manual.
  AI-extracted PDF values are unverified until user review.
- Steps/activity: source-aware aggregation and deduplication; never blindly
  add overlapping counts across iPhone/Oura/Watch/apps.

## 6. Withings blood-pressure integration (Phase 1, first-class)

- Direct connection: current official Withings Public API, OAuth Authorization
  Code flow; code exchange and refresh server-side; minimum scopes; verify
  exact scope names, measurement type ids (expected 9 diastolic, 10 systolic,
  11 pulse) and notification category (expected appli=4) against current
  official docs before coding. Import historical measurements on connect.
- Webhook: HTTPS; correct callback validation incl. HEAD; parse form-encoded
  payloads; identify user and category; treat notification as a signal to
  fetch, not the record; durable lastupdate cursor heals missed notifications;
  handle duplicate/out-of-order delivery; rotate refresh tokens correctly;
  encrypted server-side token storage; no tokens or raw payloads in logs;
  idempotent processing; on-demand manual refresh. Use group id, modification
  timestamp, device id, payload hash. Store immutable raw record + normalized
  reading.
- Apple Health BP fallback: read systolic/diastolic/correlations/heart rate;
  pair from the same correlation; preserve source app and device; suppress
  clear duplicates of direct-API readings from analytics without deleting.
- Manual entry: systolic, diastolic, pulse, timestamp, arm, seated-rest
  duration, body position, cuff/device, reading number, note. Optional
  user-controlled "Also save manual readings to Apple Health" with explicit
  write permission, stable metadata identifying Ben Health OS, and
  re-import-loop prevention.
- Sessions: multi-reading sessions; show each reading, session average,
  first-reading exclusion, averaging method, spacing, source/device. Never
  silently discard readings.
- BP screen: latest reading, source, device, measured time, ingestion time,
  freshness, 7/30-day trends, morning/evening views, session averages, pulse,
  history, sync status, Connect/Reconnect, Refresh, Add Manually. No
  hypertension diagnosis from a single reading; alert thresholds
  evidence-based, source-cited, configurable, recheck-oriented; no emergency
  clinical logic without documented, tested rule sources.

## 7. Apple Health ingestion

Apple Health is the device-side health-data bus. Contextual permission
requests. Read categories (when available): recovery (sleep analysis, HR,
resting HR, HRV, respiratory rate, SpO2, temperature, mindful sessions);
activity (steps, distance, active energy, exercise time, workouts, flights,
VO2 max, walking HR average, mobility); body (mass, BMI, body fat %, lean
mass, height); cardiometabolic (glucose, BP, pulse); nutrition (energy,
protein, carbs, fat, saturated fat, fiber, sodium, potassium, micronutrients
present). Use anchored/modern query abstractions, observer queries,
background delivery where supported, persistent per-type anchors, deletion
handling, source attribution, unit normalization, on-demand backfill,
coverage reporting. Background delivery ≠ continuous real-time. Denied
permission ≠ no data ≠ stale data. Don't request unused categories. Physical
device required for background-delivery testing.

## 8. Oura (Phase 3 direct integration)

Current API version, OAuth2 (no deprecated personal tokens), webhooks over
polling. Import daily sleep/readiness/activity, sessions/stages, resting HR,
HRV, temperature deviation, SpO2, stress/recovery where exposed, workouts,
tags/sessions. Preserve original scores and contributors. Some data arrive
only after ring sync — show measured period and last-sync freshness. Don't
double-count against Apple Health.

## 9. Dexcom Stelo

Apple Health is the initial supported path; data are source-delayed — disclose
visibly (measurement timestamp, most recent Stelo timestamp, estimated delay,
last ingestion). Never "live". Features: 24-h chart, daily mean, variability,
configurable time-in-range, overnight pattern, meal/exercise/sleep
annotations, repeated-meal comparisons, 7-day overlays, experiment
comparisons. CGM values carry uncertainty; do not gamify flatness. No
scraping; direct Dexcom integration only if an official API expressly permits.

## 10. Cronometer

Pathways: nutrition samples actually in Apple Health; user-authorized CSV
export/import. Versioned importer: preserve original file, hash, staging
table, preview, new/duplicate/conflict identification, confirmation for
questionable rows, importer version retained, rerunnable/idempotent. No
private/undocumented API; ADR before replacing the import route.

## 11. Function Health and clinical records

No assumed public Function API. Pathways: structured downloads when
available, PDF import, CSV import, Apple Clinical Health Records, manually
reviewed entry. General laboratory-import framework (analyte, canonical id,
display name, value, unit, reference range, abnormal flag, specimen/result
dates, laboratory, ordering source, original document, extraction confidence,
user-verification status). Clinical Records: minimum read permissions,
read-only, preserve original FHIR JSON where appropriate, normalize discrete
observations, retain provenance, handle updates/corrections, never assume
completeness. No portal scraping.

## 12. Normalized data architecture

Three layers: (1) immutable raw ingestion (connector, external id, source
user/device ids, payload hash, event type, received time, source modification
time, parser version, processing state); (2) source-neutral normalized
observations (entities incl. User, SourceConnection, SourceDevice,
SyncCursor, RawIngestEvent, Observation, BloodPressureReading,
BloodPressureSession, GlucoseSample, SleepSession, SleepStage, Workout,
DailyActivity, BodyMeasurement, NutritionDay, Meal, NutrientObservation,
LabResult, LabPanel, Medication, MedicationSourceRecord,
MedicationReconciliation, Condition, ClinicalEvent, Document, Symptom,
JournalEntry, HealthGoal, HealthExperiment, ExperimentPhase, Recommendation,
RecommendationEvidence, Alert, DerivedMetric, AlgorithmVersion,
WeeklyHealthReport, MonthlyHealthReport, PhysicianBrief); (3) derived
analytics (algorithm name/version, input refs, calculation time, coverage,
value, unit, confidence, invalidation). Never silently overwrite history on
algorithm change.

## 13. Deduplication and conflict resolution

First-class subsystem; never silently merge/delete. Evidence hierarchy:
1) same source + exact external id; 2) same source group/correlation id;
3) same payload hash; 4) same metric+timestamp+value+device; 5) cross-source
match within defined tolerance; 6) user-confirmed. For Withings BP
cross-source: compare systolic, diastolic, pulse, measured time, device,
grpid. Retain both raws; one normalized canonical + linked duplicate. Tests:
direct+Apple duplicate, multiple webhook delivery, backfill after webhook,
manual equal to device reading, corrected Withings measurement, deleted Apple
Health measurement, same-day multiple legitimate readings. Never convert
missing to zero; never average before overlap determination.

## 14. Dashboard information architecture

Nav: Today, Trends, Health CEO, Labs, Medications, Experiments, Data Sources,
Settings. Today: recovery status, last meaningful refresh, today's training
recommendation, active experiment, health tasks, new high-confidence signals,
three priorities. Five executive domains: Recovery; Cardiovascular fitness;
Strength/body composition; Metabolic/nutrition; Clinical & preventive risk
(details per brief §14). Lab Explorer for full data; no single fake overall
health score. Domain statuses: GREEN, WATCH, ACTION, CLINICIAN REVIEW,
INSUFFICIENT DATA — every status explainable.

## 15. Personal baseline engine

Rolling windows 7d / preceding non-overlapping 28d / 90d / 365d. Stats: mean,
median, min, max, SD, CV, trend slope, personal percentile, n observations,
days with data, completeness %, source continuity. 7v28 comparator excludes
current 7. No significance claims without valid method. Distinguish
statistically detectable / practically meaningful / directionally interesting
/ insufficient evidence. Don't overinterpret single measurements.

## 16. Deterministic signal engine

Deterministic, testable signals before AI narrative (examples in brief §16).
Each signal: type, domain, severity (INFO/WATCH/ACTION/CLINICIAN REVIEW),
confidence, window, observation refs, baseline comparison, rule version,
copy, action category, clinician-review flag. URGENT only for narrow,
source-cited, reviewed rules. No emergency inference from a single
consumer-device value.

## 17. AI recommendation layer

AI explains and prioritizes verified analytics; never primary calculator.
Server-side provider abstraction; no LLM key in app; consumer accounts ≠ API
access. Bounded Health Analysis Packet (relevant derived metrics,
completeness, signals, goals, reconciled meds, selected conditions/lab
trends, behavior, experiments, prior accepted recommendations) — never the
full raw DB by default. Imported clinical text/PDFs/notes are untrusted data,
never instructions. Structured output required. Every recommendation: title,
domain, observation, evidence refs, interpretation, confidence, proposed
action, why it matters, clinician-review status, what could change the
conclusion, expiration/review date. Label MEASURED FACT / DERIVED TREND /
HYPOTHESIS / RECOMMENDATION. Allowed: summarize, prioritize, explain, propose
low-risk experiments, prep clinician questions, identify patterns, flag for
review. Forbidden: diagnose from incomplete data, claim causality from
correlation, change medication dose, advise stopping prescriptions, conceal
uncertainty, manufacture measurements, overstate wearable precision, issue
unsupported emergency instructions. Every factual statement traceable to
observation/derived-metric ids.

## 18. Recommendation inbox

Statuses: NEW, ACCEPTED, DOING, SNOOZED, DISMISSED, COMPLETED, DISCUSS WITH
CLINICIAN, SUPERSEDED. Track creation date, evidence, confidence, acceptance,
execution, outcome change, routine-promotion. Bounded volume; weekly report
selects exactly three priority actions.

## 19. Health experiment engine

Structured N-of-1 experiments (examples: Apollo Neuro before sleep,
post-dinner walk, earlier dinner, caffeine cutoff, alcohol elimination,
protein-forward breakfast, fiber before carbohydrate, fixed bedtime, more
Zone 2). Each: question, hypothesis, intervention, baseline period,
intervention period, primary/secondary outcomes, adherence measure,
confounders, exclusion days, analysis method, result, confidence, decision
(ADOPT/REJECT/RETEST/INCONCLUSIVE). Never permanently recommend because the
device is owned.

## 20. Weekly Health CEO report

Most recent 7 complete days vs preceding non-overlapping 28-day baseline.
Structure: Executive Summary (answer-first paragraph); What Improved; What
Deteriorated; Recovery; Training; Body Composition; Metabolic & Nutrition;
Blood Pressure (sessions, averages, trend, source/freshness,
clinician-review items); Clinical; Experiments; Top Three Actions (exactly
three).

## 21. Monthly Health Board report

30d vs 90d vs 365d context. Executive status; five-domain KPI scorecard;
material improvements/deteriorations; risk register; data-quality audit;
source freshness; completed/active experiments; maintain list; stop list;
exactly three priorities. No single overall grade.

## 22. Medication reconciliation

Preserve per source record: original name, normalized medication, dosage,
frequency, route, prescriber/source, recorded status, first/last seen, source
record id. Reconcile as CURRENT / CURRENT PRN / PAST / UNCERTAIN / DUPLICATE
SOURCE RECORD. EHR "active" ≠ currently taken. Physician-facing lists only
from reconciled records. Never auto-recommend medication changes.

## 23. Physician mode

One-page-preferred Physician Brief: current concerns, reconciled meds,
relevant conditions, material symptoms, BP trend, weight/body-comp trend,
activity/VO2 trend, key lab trends, changes since prior visit,
preventive-care gaps, questions. No raw wearable dumps. PDF + secure export.

## 24. Data-quality screen

Source | Connection | Last Sync | Latest Measurement | Coverage | Expected
Latency | Problems — for Apple Health, Withings, Oura, Stelo, Cronometer,
Function, Clinical Records. Detect stale feeds, expired OAuth, missed webhook
recovery, duplicates, impossible values, unit mismatch, source switching,
missing periods, unexpected latency, low-confidence extraction, source
conflicts. Flag and explain; never silently clean.

## 25. Security and privacy

Face ID/device auth; Keychain; strong iOS data protection; TLS; RLS;
single-user isolation; server-side secret management; encrypted OAuth
tokens; no secrets in source control; no sensitive values in
analytics/crash logs; redacted operational logs; explicit export; explicit
permanent deletion; connection revocation; audit trail; least-privilege
roles; webhook validation; CSRF protection for OAuth; secure universal
links; rate limiting; dependency vulnerability scanning. No advertising
SDKs; no selling/profiling; no health data to general-purpose analytics; no
"HIPAA compliant" claims without documented controls, contracts, and
legal/security review. App Store prep requires current Apple health-data and
privacy rules, working privacy policy, minimal data requests, documented
SDKs, no PHI in iCloud, disclosed AI/analytics vendors.

## 26. Design standard

Premium Apple-native feel; Oura-level calm; Bloomberg-level informational
discipline; family-office dashboard sophistication. No interface copying.
Restrained, calm, premium; high information density where useful; excellent
hierarchy and typography; legible charts; subtle status indicators; no
childish badges, streak shame, giant fake score rings, excessive red alerts,
or dark-pattern engagement loops.

## 27. Phased delivery

- Phase 0: feasibility/architecture docs (product-spec, architecture,
  data-model, security, integrations, source-priority,
  recommendation-safety, roadmap, ADRs, root CLAUDE.md). Integration doc
  classifies each source: VERIFIED DIRECT API / APPLE HEALTH / CLINICAL
  HEALTH RECORDS / FILE IMPORT / MANUAL ENTRY / NOT CURRENTLY SUPPORTED.
- Phase 1: BP + platform foundation (iOS shell, secure auth, local cache,
  backend + migrations, source-connection model, Withings OAuth, historical
  import, webhook, durable lastupdate, Apple Health BP fallback, manual
  entry, dedup, BP screen, freshness, minimal web BP dashboard, demo mode,
  automated tests). First production-quality milestone.
- Phase 2: Apple Health executive dashboard (steps, activity, workouts,
  sleep, HR, resting HR, HRV, weight/body comp, glucose, baseline engine,
  five-domain dashboard, data-quality screen).
- Phase 3: Oura direct (OAuth, webhooks, scores, stress/recovery, dedup,
  freshness).
- Phase 4: nutrition + labs (Cronometer AH + CSV, lab framework, Function
  import, Clinical Records, Lab Explorer).
- Phase 5: medication + physician workflow (reconciliation, preventive
  tracking, Physician Brief, PDF).
- Phase 6: signals + recommendations (deterministic engine, inbox, AI
  packet, structured narrative, weekly/monthly reports). AI never precedes
  dependable provenance/quality.
- Phase 7: experiments engine.
- Phase 8: polish (widgets, App Intents, shortcuts, notifications, PDF
  improvements, Watch companion, offline, App Store prep).

## 28. Phase 1 acceptance criteria

iOS: compiles with installed stable Xcode; demo mode in Simulator; runs on
device when signing available; OAuth-only Withings; historical import;
mocked webhook idempotent; genuine new measurement imported when credentials
available; latest reading shows source/device/measured/ingested/freshness;
Apple Health BP import on device; API+AH duplicates don't double-count;
manual entry works; optional AH write tested separately; charts show history
and session averages; usable when Withings unavailable; sync failures
identified.

Backend: migrations from clean DB; RLS tests; tokens never in client logs;
safe refresh rotation; idempotent webhooks; required validation; missed
webhook recovered via durable cursor; raw vs normalized distinct; duplicate
processing tested; .env.example names only.

Web: secure auth; same normalized records; source + freshness; responsive
Safari.

Quality: unit + integration tests pass; formatter/linter passes; no
hardcoded production secrets; README with complete setup; honest known
limitations. Mocked/sandbox/production behavior labeled separately.

## 29. Testing requirements

Unit, integration, UI (core workflows), fixture-based connector, migration,
dedup, trend-calculation, recommendation-rule, permission-state,
token-rotation, webhook replay, timezone/DST, unit-conversion,
corrupted-import tests. Synthetic fixtures only; never commit real health
data; demo persona with realistic fictional longitudinal records. CI: iOS
build where feasible, web build, tests, linting, dependency checks, secret
scanning.
