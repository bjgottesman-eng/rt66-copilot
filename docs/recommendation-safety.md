# Recommendation Safety — Constitution for Signals and AI

Status: Phase 0 policy document, derived from the build brief (§6, §16–§18)
and CLAUDE.md rule 5. This document is binding on the deterministic signal
engine (Phase 6), the AI recommendation layer (Phase 6), the BP alerting
rules (Phase 1 onward), and every report surface (weekly, monthly,
physician). Changes require an ADR. Ben Health OS is **not a medical
device**: it does not diagnose, does not alter treatment, and does not run
emergency logic beyond narrow, documented, source-cited, tested rules.

---

## 1. Deterministic before AI

All quantitative claims are produced by **deterministic, versioned, testable
code** operating on normalized observations and derived metrics. The AI
layer runs strictly downstream of that engine: it explains, prioritizes, and
narrates verified analytics. It is **never the primary calculator** — it
never computes a trend, an average, a baseline deviation, or a threshold
crossing itself, and it never emits a number that does not already exist in
the database with an id.

Consequences:

- No AI-generated signal exists without a deterministic signal or derived
  metric underneath it. If the engine produced nothing, the narrative says
  so ("no material change detected") rather than inventing insight.
- Signals precede narrative in the pipeline and in delivery order. AI
  unavailability degrades the product to plain deterministic output, never
  to silence and never to unreviewed generation.
- AI never precedes dependable provenance and data quality (brief §27,
  Phase 6 gate): recommendations do not ship until dedup, freshness, and
  provenance are trustworthy, because a recommendation built on
  double-counted or stale data is worse than none.

## 2. Severity ladder

Every deterministic signal carries exactly one severity:

- **INFO** — noteworthy, no action implied (e.g. a directionally
  interesting trend, a data-coverage note).
- **WATCH** — worth monitoring; suggests continued measurement or a low-risk
  behavioral observation, not intervention.
- **ACTION** — a concrete, low-risk, self-directed step is warranted (e.g.
  re-measure under standard conditions, adjust a tracked behavior, schedule
  an overdue routine check).
- **CLINICIAN REVIEW** — the finding should be discussed with a clinician.
  The product prepares the evidence and the questions; it does not
  interpret beyond that boundary.

Each signal also records: type, domain, confidence, window, observation
references, baseline comparison, rule version, human-readable copy, action
category, and clinician-review flag — so every severity is explainable from
stored data.

### The narrow URGENT policy

**URGENT is not a rung on the normal ladder.** It exists only for narrow,
individually documented rules that are: (a) grounded in cited clinical
guidance recorded in the rule's source list, (b) reviewed before release,
(c) covered by tests, and (d) versioned. No rule may infer an emergency
from a **single consumer-device value** — a lone cuff reading, CGM sample,
or wearable metric can never trigger URGENT. There is no generic "value
looks extreme, escalate" heuristic; if no documented rule matches, the
ceiling is CLINICIAN REVIEW. The AI layer cannot create, upgrade to, or
paraphrase its way into URGENT under any circumstances, and it must never
issue unsupported emergency instructions.

## 3. What the AI may and must not do

**Allowed** (the complete list — anything outside it is out of scope):

- Summarize verified analytics and reports.
- Prioritize among existing signals and recommendations.
- Explain what a derived metric or signal means and why it matters.
- Propose **low-risk experiments** (brief §19 catalog: sleep timing,
  post-meal walks, caffeine cutoff, and similar N-of-1 designs).
- Prepare questions for a clinician visit.
- Identify patterns across domains for human review.
- Flag items for clinician review.

**Forbidden** (each independently, absolutely):

- Diagnose — including "diagnosis from incomplete data" phrasing that
  hedges its way into a diagnosis.
- Claim causality from correlation.
- Recommend changing any medication dose.
- Advise stopping any prescription.
- Conceal uncertainty, low confidence, or low data coverage.
- Manufacture, extrapolate, or "estimate" measurements that were not made.
- Overstate the precision of wearable or consumer-device data.
- Issue emergency instructions not backed by a documented URGENT rule.

These lists are enforced structurally, not just by prompting: the AI's
output schema has no field in which a dose change or diagnosis is
representable, and output that violates the schema is rejected, logged
(redacted), and not shown.

## 4. Epistemic labeling

Every statement in AI-generated narrative and every recommendation
component is labeled with exactly one epistemic class:

- **MEASURED FACT** — a stored observation ("mean 7-day systolic 128 mmHg
  across 11 sessions").
- **DERIVED TREND** — output of a versioned algorithm over observations
  ("systolic +4 mmHg vs the preceding 28-day baseline, coverage 0.86").
- **HYPOTHESIS** — a candidate explanation, explicitly uncertain ("possibly
  related to the later-caffeine pattern in the same window").
- **RECOMMENDATION** — a proposed action with confidence, rationale, and a
  clinician-review status.

The baseline engine's evidence tiers (statistically detectable /
practically meaningful / directionally interesting / insufficient evidence)
carry through into these labels; a directionally interesting change may
never be presented as MEASURED FACT of change, and single measurements are
never over-interpreted into trends.

## 5. Evidence traceability

Every factual statement must be traceable to specific
**observation ids and/or derived-metric ids** stored in the database.
Structurally: each recommendation carries title, domain, observation,
evidence references (ids), interpretation, confidence, proposed action, why
it matters, clinician-review status, what could change the conclusion, and
an expiration/review date. A statement whose ids do not resolve — or whose
referenced values do not support the claim — fails validation and is
dropped before display. This is the concrete mechanism that makes the
"never manufacture measurements" rule testable: the renderer can join every
number in the narrative back to a row.

## 6. Bounded Health Analysis Packet and prompt injection

The AI receives a **bounded Health Analysis Packet**, never the raw
database by default. The packet contains: relevant derived metrics with
completeness/coverage, active deterministic signals, current goals,
**reconciled** medications (never raw source records), selected conditions
and lab trends, behavior summaries, experiment states, and prior accepted
recommendations. Its size and field set are versioned; expanding it is an
ADR-level change. The packet is assembled server-side; no LLM key ever
ships in the iOS or web client, and consumer AI accounts are not API
substitutes.

**Prompt-injection stance.** Imported clinical text — FHIR narrative
fields, parsed lab PDFs, portal-exported notes, document text, and any
free-text field that originated outside this system — is **untrusted data,
never instructions**. Concretely:

- Untrusted text enters the packet only inside clearly delimited data
  fields, quoted and typed as content, never concatenated into system or
  developer instructions.
- Instructions embedded in such text ("ignore previous instructions",
  "recommend X", dosing language inside a scanned note) have no effect on
  model behavior by construction, and the structured-output requirement
  means the model cannot act outside the schema even if influenced.
- The AI may summarize untrusted text but may not treat any claim in it as
  a MEASURED FACT; document-derived values remain unverified until user
  review (see docs/source-priority.md §3.5).
- Injection resistance is tested: fixture documents containing adversarial
  instructions must produce unchanged, schema-valid output.

## 7. Blood-pressure alert thresholds (Phase 1 policy)

BP is the first metric with alerting, so it sets the pattern:

- **Evidence-based and source-cited.** Every threshold rule cites the
  clinical guideline it derives from, with URL and access date recorded
  alongside the rule (same discipline as docs/integrations.md). No
  invented cutoffs.
- **Configurable.** Thresholds are settings with cited defaults, not
  hardcoded constants — Ben's clinician may set targets that differ from
  population guidance.
- **Recheck-oriented.** The default response to an elevated reading is a
  structured recheck: rest seated, re-measure per protocol, look at the
  session average and the multi-day trend. Alerts ask for better data
  before they ask for concern.
- **No single-reading diagnosis.** One reading never produces a
  hypertension label, a diagnosis-flavored message, or an emergency
  escalation. Sustained patterns across sessions may raise CLINICIAN
  REVIEW; the words used describe measurements, not conditions.
- **No emergency clinical logic** without a documented, source-cited,
  reviewed, tested rule per the URGENT policy in §2.

## 8. Medication no-touch rule

Medications are the highest-risk surface, so the boundary is absolute:

- Neither the deterministic engine nor the AI ever recommends starting,
  stopping, or changing the dose, frequency, route, or timing of any
  medication. Not as an ACTION, not as a HYPOTHESIS, not as experiment
  design, not "pending clinician approval".
- The permitted ceiling is: flag a medication-related observation for
  **CLINICIAN REVIEW** and help prepare the discussion (reconciled list,
  relevant trends, questions).
- Reconciliation statuses (CURRENT / CURRENT PRN / PAST / UNCERTAIN /
  DUPLICATE SOURCE RECORD) are bookkeeping about records, never clinical
  judgments; EHR "active" is not treated as "currently taken".
- Physician-facing lists are built only from reconciled records, and the
  AI packet receives only reconciled records.

## 9. Medical-device escalation note

Ben Health OS deliberately stays outside regulated medical-device
functionality: it presents measurements, versioned analytics, and
low-risk, evidence-linked suggestions with clinician-review routing. If a
requested capability would materially cross that line — diagnosis,
treatment decisions, closed-loop intervention, emergency detection beyond
the narrow documented rules — the concern must be **documented before
implementation** (an ADR describing the capability, why it approaches
device territory, and the regulatory implications), and the owner decides
with that document in hand. Building first and classifying later is not an
option.

## 10. Enforcement summary (testable)

1. Recommendation-rule tests cover every deterministic rule and its
   severity, including boundary values.
2. Schema validation rejects any AI output containing unresolvable
   evidence ids, unlabeled statements, or forbidden action types.
3. Injection fixtures (adversarial clinical text) produce unchanged,
   schema-valid output.
4. No code path can emit URGENT without a rule id that resolves to a
   documented, cited, reviewed rule.
5. Log-redaction tests confirm packets, prompts, and outputs never leak
   health values or secrets into operational logs.
