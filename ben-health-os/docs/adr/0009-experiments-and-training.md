# ADR 0009 — N-of-1 experiments, training progression and subjective check-ins

**Status:** accepted (2026-10-12)

## Context
The spec asks for an N-of-1 experiment engine with baselines, interventions, adherence tracking and
ADOPT / REJECT / RETEST / INCONCLUSIVE decisions, a strength-training module and subjective
check-ins — without ever turning correlation into causation or manufacturing a conclusion from thin
data. The trend engine already defines windows, coverage gates and a change classifier
(ADR 0005, `services/analytics/src/windows.ts`); experiments must not introduce a second notion of
"meaningful".

## Decisions
1. **Reuse the trend classifier.** `experiment_evaluation/v1` pools all baseline days and all
   intervention days (phases are dated rows in `experiment_phases`), computes `windowStats` for each
   pool and classifies the difference with `classifyChange` using the metric's own `meaningfulDelta`
   and effect-size rules. Coverage gates are the metric's 7-day minimum **and** at least half of the
   pooled days; otherwise the verdict is INSUFFICIENT_EVIDENCE and the reasons say which window fell
   short.
2. **Adherence is a gate, not a decoration.** Intervention-day entries (`adhered: true/false`) are
   logged per day; below 60% the verdict is RETEST whatever the numbers show. No entries at all is a
   stated limitation, never assumed adherence.
3. **Verdict mapping.** MEANINGFUL + favourable → ADOPT (MEDIUM; HIGH only with ≥75% block
   consistency in an alternating design or an effect size ≥ 1); MEANINGFUL + unfavourable → REJECT;
   DIRECTIONAL → RETEST ("suggestive, not established"); NOISE → INCONCLUSIVE ("no detectable effect
   at this sample size, which is not the same as no effect"). Metrics without a preferred direction
   never produce ADOPT/REJECT. While any phase is open the verdict is `preliminary`.
4. **Designs.** BEFORE_AFTER (one baseline, one intervention) and ALTERNATING (repeated
   baseline/intervention blocks, optional washout) are planned from a start date by `planPhases`.
   RANDOMIZED_BLOCKS is accepted by the schema but evaluated like ALTERNATING; true randomisation
   needs the user to pick block order at design time, which the UI does not yet offer.
5. **Outcomes can be subjective.** `checkin:<dimension>` ids map the daily mean of a 1–10 self-rating
   (`symptoms` table) to a pseudo metric with the statistical rule only (`checkin_summary/v1`); the
   same loader feeds experiments, so "does X improve my perceived sleep quality" is a valid design.
6. **Decisions are the user's** and become `EXPERIMENT` memories with origin DERIVED_CALCULATION and
   verification USER_CONFIRMED; the monthly board report lists completed (last 90 days) and current
   experiments with their summaries and decisions; the reports job re-evaluates running experiments
   and raises one `EXPERIMENT_COMPLETED` alert when the last phase ends.
7. **Training math is descriptive.** `training_summary/v1` counts a training day once whether it
   came from an exercise record or logged sets, sums logged volume, estimates 1RM with Epley on
   1–12-rep sets only (null otherwise) and labels progression PROGRESSING / MAINTAINING / REGRESSING
   only when both the last 4 weeks and the 4 before have at least two estimable sessions. No
   programme is prescribed.

## Consequences
- Anything an experiment "proves" is explicitly about one person in one period; the limitation text
  travels with every evaluation and into the report.
- Exploratory cross-metric correlations are deliberately not shipped: without an experimental design
  they would be hypotheses dressed as findings. They stay NOT IMPLEMENTED until a causal-safe
  presentation is agreed.
