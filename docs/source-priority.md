# Source Priority — Canonical-Source Policy

Status: Phase 0 policy document, derived from the build brief (§5, §13) and
bound by `docs/contracts/phase1-contracts.md` (§2, §4) where Phase 1 code is
concerned. Changes to the priority chains below require an ADR.

---

## 1. What "canonical" means

Ben Health OS ingests the same physiological event from multiple pipes: a
Withings BP reading can arrive via the Withings API *and* via Apple Health;
an Oura sleep session can appear in the Oura API *and* as Apple Health
samples. The canonical-source policy decides **which record represents the
event in analytics and display** when more than one source reports it.

Canonical is a *presentation and analytics* designation, nothing more:

- **Provenance is never erased.** Every raw ingest event is immutable and
  retained forever (contracts §2, `raw_ingest_event`). Every normalized
  record keeps its `source`, `source_app`, `source_device`, external
  identifiers, and a link to its raw event.
- **Duplicates are linked, never deleted or merged.** The non-canonical
  record gets `canonical = false`, `duplicate_of = <winner id>`, and a
  `dedup_reason` naming the rule that matched (contracts §4). Both rows
  remain queryable; API consumers can request them with
  `includeDuplicates=true`.
- **Analytics read only canonical rows.** Derived metrics, summaries,
  sessions, charts, and default API responses include only records where
  `canonical = true and deleted_at is null`. This prevents double-counting
  without hiding history.
- **Canonicality is transferable.** If a higher-priority source's record
  arrives *after* a lower-priority duplicate (e.g. Apple Health syncs before
  the Withings webhook), the newly arrived record becomes canonical and the
  older row is demoted — with dependent sessions and derived metrics
  recomputed idempotently. Nothing about arrival order changes the outcome.
- **Canonical ≠ correct.** Priority encodes *expected fidelity of the
  pipeline*, not truth. A quality flag (e.g. `implausible_value`) can sit on
  a canonical record; the data-quality screen surfaces conflicts rather than
  silently resolving them. Source conflicts that dedup cannot resolve within
  tolerance are two distinct observations, both canonical, both flagged.

## 2. How priority interacts with deduplication (contracts §4)

Deduplication answers "are these two records the same measurement?" using
the evidence hierarchy (exact external id → source group/correlation id →
payload hash → metric+timestamp+value+device → cross-source tolerance match
→ user confirmation). Only **after** two records are judged duplicates does
the priority chain answer "which one is canonical?".

Order of operations, run at normalization time:

1. **Ingest raw.** Every delivery becomes a `raw_ingest_event`; an exact
   repeat (same connector + external_id + payload_hash) is recorded and
   normalization is skipped (`skipped_duplicate`).
2. **Normalize.** Produce the observation with full provenance.
3. **Match.** Apply the dedup evidence hierarchy against existing
   observations. Cross-source matching uses defined tolerances only (for BP:
   |Δ measured_at| ≤ 180 s, equal rounded systolic and diastolic, pulse both
   null or |Δ| ≤ 5). Never average values before overlap is determined;
   never coerce a missing value to zero to force a match.
4. **Rank.** Among matched duplicates, the priority chain for that metric
   picks the winner. Ties within the same priority tier keep the earliest
   canonical record and link later arrivals to it.
5. **Recompute.** Sessions and derived metrics that consumed a demoted
   record are recomputed under the same algorithm version (inputs changed,
   not the algorithm).

Priority never causes deletion, suppresses raw ingestion, or blocks a
lower-priority source from being ingested. A lower-priority source with *no*
higher-priority duplicate is fully canonical — manual entries and Apple
Health readings stand on their own when they are the only report.

## 3. Priority chains per metric (brief §5)

### 3.1 Blood pressure (Phase 1)

1. **Direct Withings API** (`bp_source = 'withings_api'`) — server-side
   OAuth, grpid identity, modification timestamps; the reference pipe.
2. **Withings-originated Apple Health** (`apple_health`, source app/bundle
   identifies Withings) — same device, one hop removed.
3. **Other validated Apple Health BP device** (`apple_health`) — a real cuff
   writing to HealthKit.
4. **Manual entry** (`manual`).

Phase 1 code implements the contracts §4 simplification
`withings_api > apple_health > manual`; distinguishing tiers 2 and 3 within
`apple_health` (by `source_app`/`sourceBundleId`) is a refinement that must
not alter the enum or the contracts ordering without an ADR.

A manual entry equal to a device reading within tolerance is a duplicate of
the device reading (device wins). The optional "save manual readings to
Apple Health" flow must stamp stable Ben Health OS metadata so the
re-imported sample is recognized as our own write and linked, never
re-counted.

### 3.2 Oura scores and contributors (Phase 3)

1. **Direct Oura API** — the only legitimate source of Readiness/Sleep
   scores and contributors.
2. **Apple Health standardized measurements** (HR, HRV, sleep stages, etc.)
   originated by Oura.
3. **Manual/imported.**

Hard rule: never recompute a Readiness or Sleep Score from components and
present it as an official Oura value. If the direct API is not connected,
the score is absent (`NOT_CONNECTED` / `INSUFFICIENT_DATA`), not
approximated.

### 3.3 Glucose (Stelo)

1. **Stelo-originated Apple Health samples** (identified by source app).
2. **Other identified source.**
3. **Manual import.**

Stelo data are source-delayed by design. Every glucose surface shows the
measurement timestamp, the most recent Stelo sample time, the estimated
delay, and last ingestion time; the freshness status will typically be
`DELAYED_BY_SOURCE`, and the word "live" (like "LIVE") never appears.

### 3.4 Nutrition (Cronometer)

1. **Cronometer-originated Apple Health samples — when coverage is
   complete.** Coverage is verified, not assumed: if Apple Health carries
   only calorie totals while the CSV carries meal-level micronutrients, the
   richer verified source is preferred for those fields.
2. **Structured Cronometer CSV export** (versioned, hashed, staged,
   previewed, idempotent importer).
3. **Manual.**

Nutrition dedup operates per nutrient-day/meal; the completeness check is
part of canonical selection, recorded in `coverage`/quality metadata.

### 3.5 Labs

1. **Original clinical record / structured lab result** (Apple Clinical
   Health Records FHIR, structured downloads).
2. **Function Health structured export.**
3. **User-supplied PDF, AI-parsed** — values are **unverified until user
   review**; extraction confidence and verification status are stored, and
   unverified values never feed alerts or recommendations as facts.
4. **Manual entry.**

The same analyte from the same specimen via two routes is a duplicate; the
higher tier is canonical and the lab framework keeps both with the original
document reference.

### 3.6 Steps / activity

No fixed single chain — **source-aware aggregation with deduplication**.
iPhone, Apple Watch, Oura, and third-party apps all report overlapping step
and energy counts; overlapping intervals from multiple sources are never
blindly summed. Per interval, one source is selected (generally the
dedicated wearable over phone estimation, mirroring Apple Health's own
source ordering where the user has expressed one), the rest are linked as
overlapping, and the selection is recorded so daily totals are explainable.

## 4. Source priority table

| Metric family | 1st (canonical preferred) | 2nd | 3rd | 4th | Notes |
|---|---|---|---|---|---|
| Blood pressure | Withings direct API (`withings_api`) | Withings-originated Apple Health | Other validated AH BP device | Manual (`manual`) | Contracts §4 enum: `withings_api > apple_health > manual` |
| Oura scores/contributors | Oura direct API | Apple Health (Oura-originated standardized data) | Manual/imported | — | Never recreate official scores |
| Glucose | Stelo-originated Apple Health | Other identified source | Manual import | — | Always disclose source delay; never "live" |
| Nutrition | Cronometer-via-Apple-Health *if coverage complete* | Cronometer CSV export | Manual | — | Verify coverage; don't assume meal-level completeness |
| Labs | Original clinical record / structured result | Function Health structured export | Parsed PDF (unverified until reviewed) | Manual | Extraction confidence + user-verification tracked |
| Steps/activity | Source-aware interval selection (wearable ≥ phone) | — | — | — | Never sum overlapping counts across sources |

## 5. Invariants (testable)

1. Ingesting the same measurement through any two pipes, in either order,
   yields exactly one canonical record and one linked duplicate.
2. Row counts never decrease from dedup; only `canonical`, `duplicate_of`,
   `dedup_reason` change, plus recomputed derived rows.
3. Every canonical decision is explainable from stored fields alone
   (`source`, `dedup_reason`, external ids) — no hidden state.
4. Removing the higher-priority source (revoked connection) does not delete
   or promote anything retroactively; existing links stand.
5. A demotion triggers recomputation of dependent sessions/derived metrics;
   results are identical regardless of arrival order (idempotence).
