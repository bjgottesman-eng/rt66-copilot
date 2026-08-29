# Ben Health OS — Product Specification (Phase 0)

Status: Phase 0 deliverable. Distilled from the owner's build brief
(`docs/brief/build-brief-v2.md`, the requirements source of truth). Where this
spec and `docs/contracts/phase1-contracts.md` differ on implementation detail,
the contracts file governs Phase 1 code. Phase sequencing lives in
`docs/roadmap.md`; source-by-source integration classification lives in
`docs/integrations.md`; architecture and security have their own docs under
`docs/`.

---

## 1. Vision and the primary question

Ben Health OS is a private, personal health operating system. It exists to
answer one question, continuously and honestly:

> "Given everything currently known about my health, physiology, behavior,
> nutrition, recovery, clinical history, medications, labs, and experiments —
> what has changed, what matters, and what should I do next?"

Today Ben's health data is fragmented across Apple Health, an Oura ring, a
Dexcom Stelo CGM, Cronometer, Function Health, a Withings BP cuff, clinical
providers, and manual observations. Each app answers a narrow question in its
own silo, with its own latency, gaps, and duplication. Ben Health OS unifies
these into:

1. a coherent longitudinal health record;
2. a source-aware executive dashboard;
3. a reliable data-quality and freshness system;
4. personal-baseline trend analysis (Ben vs. Ben, not Ben vs. population);
5. evidence-linked recommendations;
6. structured N-of-1 health experiments;
7. weekly Health CEO reports, monthly Health Board reports, and
   physician-ready summaries;
8. high-signal alerts without health-anxiety gamification.

The product's core stance is epistemic honesty: every number carries its
source, device, measurement time, ingestion time, freshness, and confidence.
The system would rather say "insufficient data" than fabricate certainty.

## 2. Non-goals and regulatory posture

Ben Health OS is a **wellness and personal-informatics product, not a medical
device**. It does not:

- diagnose disease, or infer diagnosis from incomplete data;
- alter, dose, or advise stopping medications;
- run emergency clinical logic, except under narrow, documented,
  source-cited, tested rules;
- claim causality from correlation, manufacture measurements, or overstate
  consumer-wearable precision;
- present any single fake "overall health score";
- claim HIPAA compliance without documented controls, contracts, and
  legal/security review.

**Documented-concern process.** If a requested capability would materially
change the product into regulated medical-device functionality (e.g.
diagnosis, treatment direction, autonomous medication management, emergency
triage), the concern is documented — as an ADR under `docs/adr/` describing
the capability, the regulatory risk, and safer alternatives — *before* any
implementation, and the owner decides. The same discipline applies to alert
thresholds: they must be evidence-based, source-cited, configurable, and
recheck-oriented ("re-measure after 5 minutes seated rest"), never diagnostic
("you have hypertension").

Further non-goals: no scraping of patient portals or private mobile APIs (One
Medical, Counsel Health, ChatGPT Health, and provider portals are not
developer APIs); no password handling for any provider — official OAuth only;
no advertising SDKs, profiling, or health data in general-purpose analytics;
no CloudKit/iCloud as the store of record for health data; no separate macOS
app in early phases.

## 3. Users

**Now: exactly one user — Ben.** No sharing, social features, coaching
marketplace, or multi-tenant UI. Product decisions optimize for a single
motivated owner-operator of his own health.

**Later: multi-user-safe.** The architecture must not paint us into a
single-user corner: every user-data row carries `user_id`, every table has
row-level security, and auth is behind an `AuthProvider` interface (local JWT
now, Supabase-compatible later) — see contracts §1. Multi-user *capability* is
a schema and security property, not a product feature; no multi-user UX is
built until it is actually needed.

Secondary audiences receive **outputs**, not accounts: Ben's physicians get
the Physician Brief (Phase 5); future clinicians or family members would be a
deliberate later decision.

## 4. Product surfaces

One normalized health-data platform, two client surfaces:

- **iOS app (`apps/ios`)** — primary surface and the Apple Health gateway.
  SwiftUI, Observation framework, structured concurrency, Swift Charts,
  HealthKit (including clinical record types), App Intents and
  BackgroundTasks where they earn their place. HealthKit ingestion happens
  only here. Must stay useful offline with a local cache of recent data.
  Deployment target chosen against the installed Xcode/SDK and recorded in an
  ADR; no beta-only APIs.
- **Web dashboard (`apps/web`)** — responsive Next.js + TypeScript app for
  Mac and larger screens; works in Safari on Mac/iPhone/iPad and as a PWA
  window. Reads the same normalized records as iOS; performs no HealthKit
  ingestion.
- **Backend platform (`services/platform`)** — Node 22 + Fastify over
  PostgreSQL 16 with RLS. Owns auth, server-side OAuth (Withings now, Oura in
  Phase 3), encrypted token storage and rotation, webhooks, ingestion,
  normalization, deduplication, derived analytics, and later the AI layer. No
  OAuth client secrets, LLM keys, or admin credentials ever ship in a client.

A demo mode (`PLATFORM_MODE=demo`, synthetic persona in `fixtures/`) lets
every surface run end-to-end with zero external credentials and no real
health data.

## 5. Core principle: source-aware freshness

The app is not universally "real-time", and never pretends to be. Different
sources have structurally different latencies: a Withings webhook can land in
seconds; Stelo glucose is delayed by design; Oura data arrives only after the
ring syncs; labs arrive days after the draw.

Every connection and important metric therefore carries: `measured_at`,
`source_synced_at` (when known), `ingested_at`, source/device/app identity,
external source id, expected vs. observed latency, and a freshness status
drawn from the exact vocabulary **CURRENT / RECENT / DELAYED_BY_SOURCE /
STALE / SYNC_ERROR / NOT_CONNECTED / INSUFFICIENT_DATA**. The normative
classification algorithm is contracts §3 (shared TypeScript implementation,
mirrored in Swift). Rules that follow from the principle:

- The word **"LIVE" is forbidden** in all UI copy unless something is a
  verified live stream (nothing in early phases is).
- Charts and analytics are plotted against measurement time, never receipt
  time.
- Delayed-by-design is distinct from broken: a healthy connector with a quiet
  source is `DELAYED_BY_SOURCE`, not an error.
- Missing values are never coerced to zero; absent ≠ zero ≠ stale.
- Every source keeps its canonical-source priority (brief §5) with
  provenance never erased: duplicates are marked and linked, never deleted
  (dedup rules: contracts §4).

## 6. Executive domains and navigation IA

Navigation: **Today · Trends · Health CEO · Labs · Medications · Experiments
· Data Sources · Settings**.

**Today** is the daily briefing: recovery status, last meaningful refresh,
today's training recommendation, the active experiment, open health tasks,
new high-confidence signals, and the current three priorities.

Five **executive domains** structure Trends and all reporting:

1. **Recovery** — sleep, HRV, resting HR, temperature, readiness.
2. **Cardiovascular fitness** — VO2 max, training load, zones, workouts, BP.
3. **Strength & body composition** — weight, lean mass, body fat, strength
   trends.
4. **Metabolic & nutrition** — glucose patterns, time-in-range, nutrition
   quality, energy balance.
5. **Clinical & preventive risk** — labs, conditions, medications,
   preventive-care gaps.

Each domain reports a status of **GREEN / WATCH / ACTION / CLINICIAN REVIEW /
INSUFFICIENT DATA** — never a blended overall grade — and every status must
be explainable: tapping it reveals the contributing signals, their windows,
baselines, and confidence. A **Lab Explorer** exposes the full underlying
data for people who want depth; a **Data Sources** screen (brief §24) shows
per-source connection, last sync, latest measurement, coverage, expected
latency, and problems.

Design standard: premium Apple-native feel, Oura-level calm, Bloomberg-level
informational discipline. High information density where useful; no badges,
streaks, giant score rings, alarm-red walls, or engagement dark patterns.

## 7. Analytics: baselines and signals

The **personal baseline engine** (Phase 2) computes rolling windows — 7 days,
the preceding non-overlapping 28 days, 90 days, 365 days — with mean, median,
min/max, SD, CV, trend slope, personal percentile, observation counts,
completeness, and source continuity. The 7-vs-28 comparator excludes the
current 7 days. Findings are graded honestly as *statistically detectable*,
*practically meaningful*, *directionally interesting*, or *insufficient
evidence*; no significance claims without a valid method, and single
measurements are never overinterpreted.

A **deterministic signal engine** (Phase 6) runs before any AI narrative.
Each signal records type, domain, severity (INFO / WATCH / ACTION / CLINICIAN
REVIEW), confidence, window, observation references, baseline comparison,
rule version, copy, and action category. URGENT exists only for narrow,
source-cited, reviewed rules; no emergency inference from a single
consumer-device value.

## 8. Report cadence

- **Weekly Health CEO report** — the most recent 7 complete days vs. the
  preceding non-overlapping 28-day baseline. Answer-first executive summary;
  what improved; what deteriorated; sections for Recovery, Training, Body
  Composition, Metabolic & Nutrition, Blood Pressure (sessions, averages,
  trend, source/freshness, clinician-review items), and Clinical;
  experiment status; and **exactly three** top actions.
- **Monthly Health Board report** — 30d vs. 90d vs. 365d context. Executive
  status; five-domain KPI scorecard; material improvements and
  deteriorations; risk register; data-quality audit; source freshness;
  completed and active experiments; a maintain list and a stop list; exactly
  three priorities. No single overall grade.
- **Physician Brief** (physician mode, Phase 5) — one page preferred:
  current concerns, reconciled medications (from reconciled records only —
  EHR "active" ≠ currently taken), relevant conditions, material symptoms,
  BP / weight / activity / key lab trends, changes since the prior visit,
  preventive-care gaps, and prepared questions. PDF plus secure export; no
  raw wearable dumps.

## 9. Recommendations and experiments

**Recommendation model (Phase 6).** AI explains and prioritizes verified
analytics; it is never the primary calculator and never invents
measurements. It receives a bounded **Health Analysis Packet** — relevant
derived metrics, completeness, signals, goals, reconciled medications,
selected conditions and lab trends, behavior, experiments, and prior
accepted recommendations — never the raw database by default. Imported
clinical text, PDFs, and notes are untrusted *data*, never instructions.
Output is structured: every recommendation carries title, domain,
observation, evidence references, interpretation, confidence, proposed
action, why it matters, clinician-review status, what could change the
conclusion, and an expiration/review date. Statements are labeled
**MEASURED FACT / DERIVED TREND / HYPOTHESIS / RECOMMENDATION**, and every
factual claim is traceable to observation or derived-metric ids. The
forbidden list in brief §17 (no diagnosis, no medication changes, no
concealed uncertainty, no unsupported emergency instructions) is binding.

Recommendations land in an **inbox** with statuses NEW, ACCEPTED, DOING,
SNOOZED, DISMISSED, COMPLETED, DISCUSS WITH CLINICIAN, SUPERSEDED — with
tracked evidence, confidence, acceptance, execution, and outcome. Volume is
bounded; the weekly report selects exactly three priority actions.

**Experiment engine (Phase 7).** Structured N-of-1 experiments (e.g. Apollo
Neuro before sleep, post-dinner walk, earlier caffeine cutoff, fixed
bedtime). Each defines question, hypothesis, intervention, baseline and
intervention periods, primary/secondary outcomes, adherence measure,
confounders, exclusion days, and analysis method, and ends in a decision:
**ADOPT / REJECT / RETEST / INCONCLUSIVE**. Owning a device is never a
reason to permanently recommend it.

## 10. Success criteria per phase

Full sequencing is in `docs/roadmap.md`; Phase 1's normative acceptance
tests are contracts §9 and brief §28. Per-phase success in product terms:

- **Phase 0 (this phase)** — feasibility and architecture docs exist
  (product spec, architecture, data model, security, integrations, source
  priority, recommendation safety, roadmap, ADRs, root CLAUDE.md);
  `docs/integrations.md` classifies every source as VERIFIED DIRECT API /
  APPLE HEALTH / CLINICAL HEALTH RECORDS / FILE IMPORT / MANUAL ENTRY / NOT
  CURRENTLY SUPPORTED.
- **Phase 1 — BP + platform foundation.** Withings OAuth end-to-end
  (historical import, idempotent webhook, durable cursor, safe token
  rotation), Apple Health BP fallback, manual entry, dedup with canonical
  linking, session averaging, the BP screen with source/device/freshness, a
  minimal web BP view, demo mode, and the full contracts-§9 testing floor
  (migrations, RLS, webhook idempotency, dedup scenarios, freshness table
  tests, log redaction). First production-quality milestone.
- **Phase 2 — Apple Health executive dashboard.** Broad HealthKit ingestion
  (activity, sleep, HR/HRV, body composition, glucose), the baseline
  engine, the five-domain dashboard with explainable statuses, and the
  data-quality screen.
- **Phase 3 — Oura direct.** OAuth2 + webhooks, official scores and
  contributors preserved verbatim, sync-latency freshness, no
  double-counting against Apple Health.
- **Phase 4 — Nutrition + labs.** Cronometer (Apple Health + idempotent CSV
  importer), the general lab framework with extraction-confidence and
  user-verification status, Function imports, Clinical Health Records, Lab
  Explorer.
- **Phase 5 — Medications + physician workflow.** Medication reconciliation
  (CURRENT / CURRENT PRN / PAST / UNCERTAIN / DUPLICATE SOURCE RECORD),
  preventive-care tracking, the Physician Brief as PDF.
- **Phase 6 — Signals + recommendations.** Deterministic signal engine,
  recommendation inbox, bounded AI packet, weekly CEO and monthly Board
  reports. AI ships only after provenance and data quality are dependable.
- **Phase 7 — Experiments.** The N-of-1 engine with honest analysis and
  decisions.
- **Phase 8 — Polish.** Widgets, App Intents, notifications, Watch
  companion, offline hardening, App Store preparation under current Apple
  health-data and privacy rules.

Cross-cutting success at every phase: tests pass from a clean database, no
secrets or real health data in the repo, mocked vs. sandbox vs. production
behavior labeled separately, and every claim the UI makes remains
explainable.
