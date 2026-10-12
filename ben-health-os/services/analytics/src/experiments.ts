/**
 * N-of-1 experiment evaluation (algorithm `experiment_evaluation`, version 1).
 *
 * Design: an experiment has phases (BASELINE / INTERVENTION / WASHOUT) with dates. All baseline days
 * are pooled, all intervention days are pooled, and the same window statistics and change classifier
 * as the trend engine compare them. Coverage gates and adherence decide whether a verdict is allowed.
 * The verdict is a statement about this person's data in this period, never a causal claim: a
 * before/after design cannot separate the intervention from time trends, and the limitations say so.
 */
import type { MetricDefinition } from '@bho/shared-config';
import { addDays, daysBetween } from './time.js';
import type { ChangeClass, WindowStats } from '@bho/contracts';
import { classifyChange, windowStats, type DailyPoint } from './windows.js';
import { effectSize } from './stats.js';

export type ExperimentPhaseKind = 'BASELINE' | 'INTERVENTION' | 'WASHOUT';
export type ExperimentDesign = 'BEFORE_AFTER' | 'ALTERNATING' | 'RANDOMIZED_BLOCKS';
export type ExperimentVerdict = 'ADOPT' | 'REJECT' | 'RETEST' | 'INCONCLUSIVE' | 'INSUFFICIENT_EVIDENCE';

export interface AdherenceEntry {
  date: string;
  adhered: boolean;
  note?: string | null;
}

export interface ExperimentPhaseInput {
  phase: ExperimentPhaseKind;
  sequence: number;
  startDate: string;
  /** Inclusive; null = open-ended (still running). */
  endDate: string | null;
  adherence: AdherenceEntry[];
}

export interface PhaseEvaluation {
  phase: ExperimentPhaseKind;
  sequence: number;
  from: string;
  to: string;
  complete: boolean;
  stats: WindowStats;
  adherenceRate: number | null;
  adherenceDays: number;
}

export interface SecondaryOutcome {
  metricId: string;
  label: string;
  unit: string;
  baselineMean: number | null;
  interventionMean: number | null;
  delta: number | null;
  deltaPct: number | null;
  changeClass: ChangeClass;
  favourable: boolean | null;
}

export interface ExperimentEvaluation {
  algorithm: 'experiment_evaluation';
  version: 1;
  evaluatedAt: string;
  asOfDate: string;
  design: ExperimentDesign;
  metricId: string;
  label: string;
  unit: string;
  phases: PhaseEvaluation[];
  baseline: WindowStats | null;
  intervention: WindowStats | null;
  washout: WindowStats | null;
  delta: number | null;
  deltaPct: number | null;
  effectSize: number | null;
  changeClass: ChangeClass;
  favourable: boolean | null;
  /** ALTERNATING designs only: share of intervention blocks moving in the same direction as the pooled effect. */
  consistency: number | null;
  adherenceRate: number | null;
  complete: boolean;
  preliminary: boolean;
  verdict: ExperimentVerdict;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  limitations: string[];
  secondary: SecondaryOutcome[];
  summary: string;
}

export interface ExperimentEvaluationInput {
  design: ExperimentDesign;
  metric: MetricDefinition;
  daily: DailyPoint[];
  phases: ExperimentPhaseInput[];
  /** Today's local date: decides whether phases are complete and whether a verdict is preliminary. */
  asOfDate: string;
  secondary?: Array<{ metric: MetricDefinition; daily: DailyPoint[] }>;
  confounders?: string[];
  evaluatedAt?: string;
}

const MIN_COVERAGE_RATIO = 0.5;

function favourableOf(metric: MetricDefinition, delta: number | null): boolean | null {
  if (delta === null || delta === 0) return null;
  if (metric.direction === 'higher_better') return delta > 0;
  if (metric.direction === 'lower_better') return delta < 0;
  return null;
}

/** Pools the daily points of several phases into one window-like statistic (gaps between phases do not count as days). */
function pooled(daily: DailyPoint[], phases: PhaseEvaluation[]): WindowStats | null {
  if (!phases.length) return null;
  const points = daily.filter((d) => phases.some((p) => d.localDate >= p.from && d.localDate <= p.to));
  const days = phases.reduce((n, p) => n + daysBetween(p.from, p.to) + 1, 0);
  const w = windowStats(points, phases[0]!.from, phases[phases.length - 1]!.to);
  return { ...w, days, daysWithData: points.length, coverage: days > 0 ? points.length / days : 0 };
}

function phaseEval(daily: DailyPoint[], p: ExperimentPhaseInput, asOfDate: string): PhaseEvaluation {
  const to = p.endDate && p.endDate <= asOfDate ? p.endDate : asOfDate < p.startDate ? p.startDate : asOfDate;
  const complete = p.endDate !== null && p.endDate <= asOfDate;
  const stats = windowStats(daily, p.startDate, to);
  const entries = p.adherence.filter((a) => a.date >= p.startDate && a.date <= to);
  const adherenceRate = p.phase === 'INTERVENTION' && entries.length > 0 ? entries.filter((a) => a.adhered).length / entries.length : null;
  return { phase: p.phase, sequence: p.sequence, from: p.startDate, to, complete, stats, adherenceRate, adherenceDays: entries.length };
}

export function evaluateExperiment(input: ExperimentEvaluationInput): ExperimentEvaluation {
  const { metric, daily, design, asOfDate } = input;
  const phases = [...input.phases].sort((a, b) => a.sequence - b.sequence).filter((p) => p.startDate <= asOfDate).map((p) => phaseEval(daily, p, asOfDate));
  const baselinePhases = phases.filter((p) => p.phase === 'BASELINE');
  const interventionPhases = phases.filter((p) => p.phase === 'INTERVENTION');
  const washoutPhases = phases.filter((p) => p.phase === 'WASHOUT');
  const baseline = pooled(daily, baselinePhases);
  const intervention = pooled(daily, interventionPhases);
  const washout = pooled(daily, washoutPhases);
  const complete = input.phases.length > 0 && input.phases.every((p) => p.endDate !== null && p.endDate <= asOfDate);
  const reasons: string[] = [];
  const limitations: string[] = [];
  const adherenceEntries = interventionPhases.reduce((n, p) => n + p.adherenceDays, 0);
  const adherenceRate = adherenceEntries > 0 ? interventionPhases.reduce((n, p) => n + (p.adherenceRate ?? 0) * p.adherenceDays, 0) / adherenceEntries : null;

  // Coverage gates: each pooled window needs the metric's 7-day minimum and half of its days.
  const minDays = metric.minCoverageDays7;
  const gate = (w: WindowStats | null, name: string): boolean => {
    if (!w || w.days === 0) {
      reasons.push(`No ${name} phase yet.`);
      return false;
    }
    if (w.daysWithData < minDays || w.coverage < MIN_COVERAGE_RATIO) {
      reasons.push(`${name[0]!.toUpperCase()}${name.slice(1)} window has ${w.daysWithData} of ${w.days} days with ${metric.label} data; at least ${Math.max(minDays, Math.ceil(w.days * MIN_COVERAGE_RATIO))} are needed.`);
      return false;
    }
    return true;
  };
  const baselineOk = gate(baseline, 'baseline');
  const interventionOk = gate(intervention, 'intervention');

  let delta: number | null = null;
  let deltaPct: number | null = null;
  let d: number | null = null;
  let changeClass: ChangeClass = 'INSUFFICIENT_EVIDENCE';
  if (baselineOk && interventionOk && baseline && intervention && baseline.mean !== null && intervention.mean !== null) {
    // Use the metric's thresholds but our own coverage gates (phases are not 7/28-day windows).
    const relaxed: MetricDefinition = { ...metric, minCoverageDays7: minDays, minCoverageDays28: minDays };
    const c = classifyChange(relaxed, intervention, baseline);
    delta = c.delta;
    deltaPct = c.deltaPct;
    d = c.d ?? effectSize(intervention.mean - baseline.mean, baseline.sd);
    changeClass = c.changeClass;
  }
  const favourable = favourableOf(metric, delta);

  // Consistency across alternating blocks: does each intervention block move the same way as the pooled effect?
  let consistency: number | null = null;
  if (design !== 'BEFORE_AFTER' && interventionPhases.length >= 2 && delta !== null) {
    let agree = 0;
    let counted = 0;
    for (const ip of interventionPhases) {
      const prevBaseline = [...baselinePhases].reverse().find((b) => b.sequence < ip.sequence);
      if (!prevBaseline || prevBaseline.stats.mean === null || ip.stats.mean === null || ip.stats.daysWithData < 2 || prevBaseline.stats.daysWithData < 2) continue;
      counted++;
      if (Math.sign(ip.stats.mean - prevBaseline.stats.mean) === Math.sign(delta)) agree++;
    }
    consistency = counted > 0 ? agree / counted : null;
  }

  // Verdict
  let verdict: ExperimentVerdict;
  let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (changeClass === 'INSUFFICIENT_EVIDENCE') {
    verdict = 'INSUFFICIENT_EVIDENCE';
  } else if (adherenceRate !== null && adherenceRate < 0.6) {
    verdict = 'RETEST';
    reasons.push(`Adherence was ${Math.round(adherenceRate * 100)}% of logged intervention days; below 60% the result cannot be attributed to the intervention.`);
  } else if (changeClass === 'MEANINGFUL' && favourable === true) {
    verdict = 'ADOPT';
    confidence = (design !== 'BEFORE_AFTER' && consistency !== null && consistency >= 0.75) || (d !== null && Math.abs(d) >= 1) ? 'HIGH' : 'MEDIUM';
    reasons.push(`${metric.label} changed by ${fmtDelta(delta, metric)} (${deltaPct !== null ? `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : 'n/a'}; effect size ${d?.toFixed(2) ?? 'n/a'}) in the favourable direction, beyond the metric's meaningful threshold.`);
  } else if (changeClass === 'MEANINGFUL' && favourable === false) {
    verdict = 'REJECT';
    confidence = 'MEDIUM';
    reasons.push(`${metric.label} changed by ${fmtDelta(delta, metric)} in the unfavourable direction, beyond the metric's meaningful threshold.`);
  } else if (changeClass === 'MEANINGFUL') {
    verdict = 'INCONCLUSIVE';
    reasons.push(`${metric.label} changed by ${fmtDelta(delta, metric)}; this metric has no preferred direction, so the decision is yours.`);
  } else if (changeClass === 'DIRECTIONAL') {
    verdict = 'RETEST';
    reasons.push(`${metric.label} moved ${favourable === true ? 'favourably' : favourable === false ? 'unfavourably' : ''} by ${fmtDelta(delta, metric)} (effect size ${d?.toFixed(2) ?? 'n/a'}): suggestive, not established. A longer or alternating run would settle it.`);
  } else {
    verdict = 'INCONCLUSIVE';
    reasons.push(`${metric.label} stayed within normal variation (${fmtDelta(delta, metric)}, effect size ${d?.toFixed(2) ?? 'n/a'}): no detectable effect at this sample size, which is not the same as no effect.`);
  }
  if (adherenceRate === null && interventionPhases.length > 0) limitations.push('No adherence check-ins were logged for the intervention days; the result assumes the intervention actually happened.');
  if (design === 'BEFORE_AFTER') limitations.push('Before/after design: a change can coincide with the intervention without being caused by it (seasons, travel, illness, training load, other changes at the same time).');
  if (design !== 'BEFORE_AFTER' && consistency !== null) reasons.push(`${Math.round(consistency * 100)}% of intervention blocks moved in the same direction as the pooled effect.`);
  for (const c of input.confounders ?? []) limitations.push(`Possible confounder recorded at design time: ${c}.`);
  limitations.push('One person, one period: this is evidence about you now, not a general finding, and never a diagnosis.');
  const preliminary = !complete;
  if (preliminary) reasons.unshift('Preliminary: the experiment is still running; the verdict can change until every phase has ended.');

  const secondary: SecondaryOutcome[] = (input.secondary ?? []).map(({ metric: m, daily: sd }) => {
    const b = pooled(sd, baselinePhases);
    const i = pooled(sd, interventionPhases);
    const ok = b && i && b.daysWithData >= m.minCoverageDays7 && i.daysWithData >= m.minCoverageDays7 && b.mean !== null && i.mean !== null;
    const c = ok ? classifyChange({ ...m, minCoverageDays7: m.minCoverageDays7, minCoverageDays28: m.minCoverageDays7 }, i!, b!) : null;
    return { metricId: m.id, label: m.label, unit: m.unit, baselineMean: b?.mean ?? null, interventionMean: i?.mean ?? null, delta: c?.delta ?? null, deltaPct: c?.deltaPct ?? null, changeClass: c?.changeClass ?? 'INSUFFICIENT_EVIDENCE', favourable: favourableOf(m, c?.delta ?? null) };
  });

  const summary = `${metric.label}: ${baseline?.mean != null ? fmtValue(baseline.mean, metric) : '—'} (baseline, ${baseline?.daysWithData ?? 0}/${baseline?.days ?? 0} days) → ${intervention?.mean != null ? fmtValue(intervention.mean, metric) : '—'} (intervention, ${intervention?.daysWithData ?? 0}/${intervention?.days ?? 0} days): ${changeClass.toLowerCase().replace('_', ' ')}${adherenceRate !== null ? `, adherence ${Math.round(adherenceRate * 100)}%` : ''}. Verdict ${verdict.replace('_', ' ')}${preliminary ? ' (preliminary)' : ''}.`;

  return {
    algorithm: 'experiment_evaluation',
    version: 1,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    asOfDate,
    design,
    metricId: metric.id,
    label: metric.label,
    unit: metric.unit,
    phases,
    baseline,
    intervention,
    washout,
    delta,
    deltaPct,
    effectSize: d,
    changeClass,
    favourable,
    consistency,
    adherenceRate,
    complete,
    preliminary,
    verdict,
    confidence,
    reasons,
    limitations,
    secondary,
    summary,
  };
}

function fmtValue(v: number, metric: MetricDefinition): string {
  return `${v.toFixed(metric.precision)} ${metric.unit}`;
}
function fmtDelta(delta: number | null, metric: MetricDefinition): string {
  if (delta === null) return 'n/a';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(metric.precision)} ${metric.unit}`;
}

/** Plans phase dates for a new experiment. ALTERNATING: baseline/intervention blocks repeated `blocks` times. */
export function planPhases(design: ExperimentDesign, startDate: string, baselineDays: number, interventionDays: number, blocks = 1, washoutDays = 0): Array<{ phase: ExperimentPhaseKind; sequence: number; startDate: string; endDate: string }> {
  const out: Array<{ phase: ExperimentPhaseKind; sequence: number; startDate: string; endDate: string }> = [];
  let cursor = startDate;
  let seq = 1;
  const push = (phase: ExperimentPhaseKind, days: number) => {
    if (days <= 0) return;
    out.push({ phase, sequence: seq++, startDate: cursor, endDate: addDays(cursor, days - 1) });
    cursor = addDays(cursor, days);
  };
  const repeats = design === 'BEFORE_AFTER' ? 1 : Math.max(1, blocks);
  for (let i = 0; i < repeats; i++) {
    push('BASELINE', baselineDays);
    push('INTERVENTION', interventionDays);
    if (washoutDays > 0 && i < repeats - 1) push('WASHOUT', washoutDays);
  }
  return out;
}

/** Status derived from the calendar: which phase today falls in, or ANALYSIS once every phase has ended. */
export function experimentStatusFor(phases: Array<{ phase: ExperimentPhaseKind; startDate: string; endDate: string | null }>, asOfDate: string): 'DRAFT' | 'BASELINE' | 'INTERVENTION' | 'WASHOUT' | 'ANALYSIS' {
  if (!phases.length) return 'DRAFT';
  const current = phases.find((p) => p.startDate <= asOfDate && (p.endDate === null || p.endDate >= asOfDate));
  if (current) return current.phase;
  const allEnded = phases.every((p) => p.endDate !== null && p.endDate < asOfDate);
  if (allEnded) return 'ANALYSIS';
  return phases[0]!.startDate > asOfDate ? 'DRAFT' : 'ANALYSIS';
}
