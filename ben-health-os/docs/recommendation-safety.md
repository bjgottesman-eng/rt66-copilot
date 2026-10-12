# Recommendation and AI safety

Applies to the rules engine (Phase 1 "What should I do today"), the signal engine (Phase 3) and the
AI layer (Phase 6).

## Claim types
Every statement is labelled: **MEASURED FACT** (an observation with provenance), **DERIVED TREND**
(a versioned calculation with coverage and confidence), **HYPOTHESIS** (exploratory, correlational),
**RECOMMENDATION** (action with evidence, confidence, effort, limitations and clinician-review status).

## Hard rules
- Never diagnose a disease; never infer a mental-health diagnosis from wearables.
- Never change, start or stop a medication or dosage; medication plans are recorded only when
  clinician-approved and are shown as such.
- Never treat correlation as causation; experiments use baselines and, where feasible,
  alternating periods (Phase 7).
- Never manufacture a conclusion when data are missing: INSUFFICIENT_EVIDENCE is a first-class
  answer; coverage minimums gate every comparison.
- Never present a single blood-pressure reading, glucose spike or readiness score as a verdict.
- No unsupported emergency claims; concerning persistent changes are routed to "discuss with your
  physician", not alarms.
- Weekly priorities are capped at three; dismissed recommendations are not repeated without new
  evidence.
- Do not encourage obsessive optimization of isolated glucose spikes or step counts; no guilt
  notifications.

## Grounding
Every recommendation row links `recommendation_evidence` entries (observations, derived metrics,
labs, guidelines, studies). The AI layer receives structured analysis packets, not the database,
and must return citations to packet items; uncited claims are rejected by the validator.

## Data-sharing controls
Profiles hold `ai_sharing.enabled` (default false) and `excludedConnectors` (default `oura`, see
ADR 0006). Journal entries marked sensitive stay on-device.

## Evidence engine (Phase 6)
Recommendations record evidence source, publication date, population, strength, applicability,
limitations and last verification date. Citations are never invented; changing guidelines are
re-fetched from official sources before use. Clinical recommendations are separated from
exploratory longevity interventions.

## Implementation (Phase 6)
- `services/ai/src/rules.ts` — `recommendation_rules/v1`: every candidate carries observation,
  reason, proposed action, confidence, claim type, limitations, clinician-review status, evidence
  entries (observation / derived metric / lab / guideline with citation and verification note) and
  the packet item ids it rests on. Blood pressure and flagged labs open as DISCUSS_WITH_CLINICIAN.
- `services/ai/src/validate.ts` — `ai_response_validator/v1`: forbidden patterns and citation checks
  applied to every provider finding and the summary.
- `services/api/src/services/intelligence.ts` — persistence with the no-repeat rules (active or
  recently completed rule → skipped; dismissed rule → skipped unless the evidence date is newer than
  the dismissal), the three-priority re-ranking, `recommendation_outcome/v1` (7 days before vs 7 days
  after acceptance, descriptive only).
- See ADR 0008 for the packet, provider and validator design.

## Experiments (Phase 7)
- One intervention per experiment, a stated hypothesis and outcome metric, and phases with dates.
  Medication changes are never experiments here.
- `experiment_evaluation/v1` pools baseline days and intervention days and applies the same change
  classifier and coverage gates as the trend engine; adherence below 60% of logged intervention days
  forces RETEST; a running experiment is always marked preliminary.
- Verdicts are ADOPT / REJECT / RETEST / INCONCLUSIVE / INSUFFICIENT EVIDENCE, each with reasons and
  limitations ("before/after design cannot separate the intervention from time trends", user-listed
  confounders, "one person, one period"). NOISE means "no detectable effect at this sample size",
  never "no effect". The decision is the user's and is recorded as a derived-calculation memory.
- Alternating designs report block consistency; before/after designs never reach HIGH confidence
  unless the effect size is at least 1.
