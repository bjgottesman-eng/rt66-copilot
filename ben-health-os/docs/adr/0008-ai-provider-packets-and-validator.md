# ADR 0008 — AI analysis packets, provider adapters and the response validator

**Status:** accepted (2026-10-12)

## Context
The spec requires a provider-independent AI layer that may summarize, find patterns, prioritize,
explain, propose low-risk experiments and prepare physician questions — and must never invent
measurements, diagnose, change medication, conceal uncertainty, treat correlation as causation or
make emergency claims. Ben has no AI API key yet, and the Oura API Agreement restricts providing API
data to AI models (ADR 0006).

## Decisions
1. **Packets, not database access.** `@bho/ai` assembles an `AnalysisPacket` from already-computed
   material: 7-vs-28-day trends (monthly: 30-vs-90 with 365-day percentiles), persisted signals, the
   30-day blood-pressure summary, confirmed lab results, the pending-review count, the last complete
   glucose day and repeated-meal comparisons, 7-day nutrition means and targets, current medications,
   allergies, active conditions, preventive-care status, source freshness, active goals and the health
   memory. Every item has a stable citation id (`trend:<metric>:7v28`, `lab:<uuid>`, `signal:<n>`,
   `bp:30d`, `source:<connector>`, …), a claim type (MEASURED FACT or DERIVED TREND only — the AI
   cannot be handed a hypothesis as a fact), provenance (`sources`) and an as-of date. Raw records,
   documents, notes marked sensitive and free text never enter a packet.
2. **Sharing controls are applied in code, before any provider sees the packet.** `assemblePacket`
   with `forProvider: true` drops every item whose `sources` include an excluded connector (default
   `oura`) and records the dropped count in the packet; with `ai_sharing.enabled = false` no provider
   is called at all and the report says so (`aiNarrative.status = DISABLED`). The packet hash
   (SHA-256 over the items) is stored with the report so what was sent is auditable.
3. **Rules first, AI second.** The deterministic rules engine (`recommendation_rules/v1`) produces the
   recommendations and the three priorities from the packet; it runs with sharing off. The AI
   narrative is additive: accepted findings appear in the report, AI `RECOMMENDATION` findings enter
   the inbox as candidates (rule key `ai:<slug>`) subject to the same no-repeat rules, AI
   `HYPOTHESIS` findings are written to the health memory as `AI_HYPOTHESIS / UNVERIFIED` and never
   become facts by repetition.
4. **Structured output and a validator.** Providers must answer with the `AiResponse` schema (the
   Anthropic adapter forces a `submit_analysis` tool call). `validateAiResponse` rejects any finding
   whose citations are not packet item ids, any finding or summary matching the forbidden patterns
   (diagnosis, medication start/stop/dose change, emergency wording, causal language), and withholds
   the whole summary if it trips a pattern. Rejections are listed in the report
   ("Withheld by the validator") rather than silently dropped.
5. **Provider status is honest.** `AI_PROVIDER=none` (default) → `NOT_CONFIGURED`; `mock` → a
   deterministic in-process provider used by tests and demos (`MOCK`); `anthropic` without
   `ANTHROPIC_API_KEY` → `BLOCKED_BY_CREDENTIALS`. The Anthropic adapter is implemented but
   untested against the live API until a key exists (it never appears as OK before then).
6. **Outcomes are descriptive.** `recommendation_outcome/v1` compares the 7 days before acceptance
   with the 7 days after on the stated outcome metric and labels the change with the same
   classifier as trends; it is never presented as proof the recommendation worked.

## Consequences
- Switching providers means one adapter (`AiProvider.analyze(packet) → unknown`), nothing else.
- Reports are reproducible from the stored packet hash plus the algorithm versions in
  `algorithm_versions` (`analysis_packet`, `recommendation_rules`, `ai_response_validator`,
  `weekly_health_ceo`, `monthly_health_board`, `recommendation_outcome`).
- Live-provider behaviour (latency, refusals, schema drift) is unverified: TESTED AGAINST LIVE API
  stays pending until Ben supplies a key.
