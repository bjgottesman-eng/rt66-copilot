/**
 * Daily aggregation, window statistics and the 7-day vs preceding 28-day baseline comparison.
 *
 * Rules (spec §16):
 *  - the 7-day window is the latest seven COMPLETE local days ending on `asOfDate`
 *  - the baseline is the 28 days immediately preceding the 7-day window (never overlapping it)
 *  - days without data are missing, never zero; coverage = days with data / days in window
 *  - a comparison is only reported when both windows meet the metric's minimum coverage
 */
import type { BaselineComparison, ChangeClass, WindowStats } from '@bho/contracts';
import { metricById, type MetricDefinition } from '@bho/shared-config';
import { effectSize, max, mean, median, min, sd, slope } from './stats.js';
import { addDays, daysBetween, enumerateDays } from './time.js';

export interface DailyPoint {
  localDate: string;
  value: number;
}

export interface ObservationLike {
  localDate: string;
  value: number;
  measuredAt: string;
  canonical?: boolean;
}

/** Aggregates canonical observations into one value per local day using the catalog rule. */
export function dailyAggregate(points: ObservationLike[], metric: MetricDefinition): DailyPoint[] {
  const byDay = new Map<string, ObservationLike[]>();
  for (const p of points) {
    if (p.canonical === false) continue;
    const list = byDay.get(p.localDate) ?? [];
    list.push(p);
    byDay.set(p.localDate, list);
  }
  const out: DailyPoint[] = [];
  for (const [localDate, list] of byDay) {
    const values = list.map((p) => p.value);
    let value: number | null;
    switch (metric.dailyAggregation) {
      case 'sum':
        value = values.reduce((a, b) => a + b, 0);
        break;
      case 'mean':
        value = mean(values);
        break;
      case 'min':
        value = min(values);
        break;
      case 'max':
        value = max(values);
        break;
      case 'count':
        value = values.length;
        break;
      case 'last': {
        const sorted = [...list].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
        value = sorted[sorted.length - 1]!.value;
        break;
      }
    }
    if (value !== null) out.push({ localDate, value });
  }
  return out.sort((a, b) => a.localDate.localeCompare(b.localDate));
}

export function windowStats(daily: DailyPoint[], from: string, to: string): WindowStats {
  const days = daysBetween(from, to) + 1;
  const inWindow = daily.filter((d) => d.localDate >= from && d.localDate <= to);
  const values = inWindow.map((d) => d.value);
  const slopePoints = inWindow.map((d) => ({ x: daysBetween(from, d.localDate), y: d.value }));
  return {
    from,
    to,
    days,
    daysWithData: inWindow.length,
    coverage: days > 0 ? inWindow.length / days : 0,
    n: values.length,
    mean: mean(values),
    median: median(values),
    sd: sd(values),
    min: min(values),
    max: max(values),
    slopePerDay: slope(slopePoints),
  };
}

export interface BaselineWindows {
  current: { from: string; to: string };
  baseline: { from: string; to: string };
}

/** The 7-day window ends on asOfDate; the 28-day baseline ends the day before the 7-day window starts. */
export function baselineWindows(asOfDate: string, currentDays = 7, baselineDays = 28): BaselineWindows {
  const currentFrom = addDays(asOfDate, -(currentDays - 1));
  const baselineTo = addDays(currentFrom, -1);
  const baselineFrom = addDays(baselineTo, -(baselineDays - 1));
  return { current: { from: currentFrom, to: asOfDate }, baseline: { from: baselineFrom, to: baselineTo } };
}

function directionWord(metric: MetricDefinition, delta: number): 'better' | 'worse' | 'changed' {
  if (metric.direction === 'higher_better') return delta > 0 ? 'better' : 'worse';
  if (metric.direction === 'lower_better') return delta < 0 ? 'better' : 'worse';
  return 'changed';
}

export function classifyChange(metric: MetricDefinition, current: WindowStats, baseline: WindowStats): { changeClass: ChangeClass; delta: number | null; deltaPct: number | null; d: number | null } {
  if (current.daysWithData < metric.minCoverageDays7 || baseline.daysWithData < metric.minCoverageDays28 || current.mean === null || baseline.mean === null) {
    return { changeClass: 'INSUFFICIENT_EVIDENCE', delta: null, deltaPct: null, d: null };
  }
  const delta = current.mean - baseline.mean;
  const deltaPct = baseline.mean !== 0 ? (delta / Math.abs(baseline.mean)) * 100 : null;
  const d = effectSize(delta, baseline.sd);
  const absD = d === null ? null : Math.abs(d);
  const absDelta = Math.abs(delta);
  const md = metric.meaningfulDelta;
  let changeClass: ChangeClass;
  if (md !== null) {
    // Absolute threshold from the catalog plus a modest effect-size guard against noisy baselines.
    if (absDelta >= md && (absD === null || absD >= 0.5)) changeClass = 'MEANINGFUL';
    else if (absDelta >= md / 2 && (absD === null || absD >= 0.3)) changeClass = 'DIRECTIONAL';
    else changeClass = 'NOISE';
  } else {
    if (absD !== null && absD >= 0.8) changeClass = 'MEANINGFUL';
    else if (absD !== null && absD >= 0.3) changeClass = 'DIRECTIONAL';
    else changeClass = 'NOISE';
  }
  return { changeClass, delta, deltaPct, d };
}

export function compareBaseline(metricId: string, daily: DailyPoint[], asOfDate: string): BaselineComparison {
  const metric = metricById(metricId);
  if (!metric) throw new Error(`unknown metric ${metricId}`);
  const w = baselineWindows(asOfDate);
  const current7d = windowStats(daily, w.current.from, w.current.to);
  const baseline28d = windowStats(daily, w.baseline.from, w.baseline.to);
  const { changeClass, delta, deltaPct, d } = classifyChange(metric, current7d, baseline28d);
  const fmt = (v: number) => Number(v.toFixed(metric.precision));
  let explanation: string;
  if (changeClass === 'INSUFFICIENT_EVIDENCE') {
    explanation = `Not enough data: ${current7d.daysWithData}/${current7d.days} days in the last week (need ${metric.minCoverageDays7}) and ${baseline28d.daysWithData}/${baseline28d.days} baseline days (need ${metric.minCoverageDays28}).`;
  } else {
    const word = directionWord(metric, delta!);
    const pct = deltaPct === null ? '' : ` (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%)`;
    const base = `7-day mean ${fmt(current7d.mean!)} ${metric.unit} vs 28-day baseline ${fmt(baseline28d.mean!)} ${metric.unit}: ${delta! >= 0 ? '+' : ''}${fmt(delta!)}${pct}`;
    const effect = d === null ? '' : `, effect size ${d.toFixed(2)}`;
    explanation =
      changeClass === 'MEANINGFUL'
        ? `${base}${effect}. Meaningful change${word === 'changed' ? '' : ` for the ${word}`}.`
        : changeClass === 'DIRECTIONAL'
          ? `${base}${effect}. Directional only — watch, not act.`
          : `${base}${effect}. Within normal variation (noise).`;
  }
  return { current7d, baseline28d, delta, deltaPct, effectSize: d, changeClass, explanation };
}

/** Sparkline helper: one entry per day in [from, to], null where no data (never zero). */
export function sparkline(daily: DailyPoint[], from: string, to: string): Array<{ date: string; value: number | null }> {
  const map = new Map(daily.map((d) => [d.localDate, d.value]));
  return enumerateDays(from, to).map((date) => ({ date, value: map.has(date) ? map.get(date)! : null }));
}
