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
