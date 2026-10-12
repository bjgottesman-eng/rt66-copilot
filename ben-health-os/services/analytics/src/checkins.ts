/**
 * Subjective check-ins (algorithm `checkin_summary`, version 1): 1–10 self-ratings are MEASURED FACTS
 * reported by the user. They are compared like metrics (7 days vs the preceding 28) with the statistical
 * rule only, because there is no catalog threshold for a feeling.
 */
import type { MetricDefinition } from '@bho/shared-config';
import type { ChangeClass } from '@bho/contracts';
import { baselineWindows, classifyChange, windowStats, type DailyPoint } from './windows.js';

export const CHECKIN_DIMENSIONS = ['energy', 'mood', 'stress', 'soreness', 'fatigue', 'focus', 'pain', 'perceivedSleepQuality', 'subjectiveRecovery'] as const;
export type CheckInDimension = (typeof CHECKIN_DIMENSIONS)[number];

const LOWER_BETTER: ReadonlySet<CheckInDimension> = new Set(['stress', 'soreness', 'fatigue', 'pain']);
const LABELS: Record<CheckInDimension, string> = { energy: 'Energy', mood: 'Mood', stress: 'Stress', soreness: 'Soreness', fatigue: 'Fatigue', focus: 'Focus', pain: 'Pain', perceivedSleepQuality: 'Perceived sleep quality', subjectiveRecovery: 'Subjective recovery' };

export interface CheckInRow {
  localDate: string;
  energy?: number | null;
  mood?: number | null;
  stress?: number | null;
  soreness?: number | null;
  fatigue?: number | null;
  focus?: number | null;
  pain?: number | null;
  perceivedSleepQuality?: number | null;
  subjectiveRecovery?: number | null;
}

export interface CheckInDimensionSummary {
  dimension: CheckInDimension;
  label: string;
  direction: 'higher_better' | 'lower_better';
  mean7d: number | null;
  daysWithData7d: number;
  mean28d: number | null;
  daysWithData28d: number;
  delta: number | null;
  changeClass: ChangeClass;
  favourable: boolean | null;
}

export interface CheckInSummary {
  algorithm: 'checkin_summary';
  version: 1;
  asOfDate: string;
  daysLogged7d: number;
  dimensions: CheckInDimensionSummary[];
  notes: string[];
}

/** Pseudo metric definition so the shared classifier can be reused (statistical rule only). */
export function checkInMetric(dimension: CheckInDimension): MetricDefinition {
  return { id: `checkin:${dimension}`, label: LABELS[dimension], domain: 'recovery', unit: '/10', precision: 1, direction: LOWER_BETTER.has(dimension) ? 'lower_better' : 'higher_better', dailyAggregation: 'mean', metricClass: 'checkin', minCoverageDays7: 3, minCoverageDays28: 8, meaningfulDelta: null, plausibleMin: 0, plausibleMax: 10 };
}

/** One value per local day: the mean of that day's entries for the dimension. */
export function checkInDaily(rows: CheckInRow[], dimension: CheckInDimension): DailyPoint[] {
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const v = r[dimension];
    if (v == null) continue;
    byDay.set(r.localDate, [...(byDay.get(r.localDate) ?? []), v]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([localDate, vs]) => ({ localDate, value: vs.reduce((a, b) => a + b, 0) / vs.length }));
}

export function checkInSummary(rows: CheckInRow[], asOfDate: string): CheckInSummary {
  const w = baselineWindows(asOfDate);
  const dimensions = CHECKIN_DIMENSIONS.map((dimension) => {
    const metric = checkInMetric(dimension);
    const daily = checkInDaily(rows, dimension);
    const cur = windowStats(daily, w.current.from, w.current.to);
    const base = windowStats(daily, w.baseline.from, w.baseline.to);
    const c = classifyChange(metric, cur, base);
    const favourable = c.delta === null || c.delta === 0 ? null : metric.direction === 'higher_better' ? c.delta > 0 : c.delta < 0;
    return { dimension, label: metric.label, direction: metric.direction as 'higher_better' | 'lower_better', mean7d: cur.mean, daysWithData7d: cur.daysWithData, mean28d: base.mean, daysWithData28d: base.daysWithData, delta: c.delta, changeClass: c.changeClass, favourable };
  });
  const daysLogged7d = new Set(rows.filter((r) => r.localDate >= w.current.from && r.localDate <= w.current.to).map((r) => r.localDate)).size;
  return {
    algorithm: 'checkin_summary',
    version: 1,
    asOfDate,
    daysLogged7d,
    dimensions,
    notes: ['Self-ratings are measured facts about how you felt, compared with the statistical rule only (no catalog thresholds). They never diagnose anything; persistent low mood or pain belongs in a conversation with your clinician.'],
  };
}
