/**
 * Deterministic signal engine (Phase 3). Signals are transparent statements about the data with
 * evidence attached; they feed "what changed" and the weekly report, and are persisted per as-of day.
 */
import type { MetricCard } from '@bho/contracts';
import { metricById } from '@bho/shared-config';
import { percentileRank } from './stats.js';

export type SignalKind = 'MEANINGFUL_CHANGE' | 'DIRECTIONAL_CHANGE' | 'NEW_365D_HIGH' | 'NEW_365D_LOW' | 'LOW_COVERAGE' | 'STALE_SOURCE' | 'SYNC_ERROR' | 'IMPLAUSIBLE_VALUES';
export type SignalDirection = 'favourable' | 'unfavourable' | 'neutral';

export interface Signal {
  metricId: string;
  domain: string;
  kind: SignalKind;
  direction: SignalDirection | null;
  /** 1 = act now, 2 = watch, 3 = informational */
  priority: number;
  delta: number | null;
  deltaPct: number | null;
  effectSize: number | null;
  explanation: string;
  evidence: Record<string, unknown>;
}

export function directionFor(metricId: string, delta: number): SignalDirection {
  const def = metricById(metricId);
  if (!def || def.direction === 'neutral' || def.direction === 'target_range') return 'neutral';
  const favourable = def.direction === 'higher_better' ? delta > 0 : delta < 0;
  return favourable ? 'favourable' : 'unfavourable';
}

export interface SignalInputs {
  card: MetricCard;
  /** Daily values over the trailing 365 days (local date → value), used for highs/lows and percentiles. */
  daily365: Array<{ localDate: string; value: number }>;
  implausibleCount30d?: number;
}

export function detectSignals(input: SignalInputs): Signal[] {
  const { card } = input;
  const def = metricById(card.metricId);
  if (!def) return [];
  const out: Signal[] = [];
  const cmp = card.comparison;
  if (cmp && cmp.delta !== null && (cmp.changeClass === 'MEANINGFUL' || cmp.changeClass === 'DIRECTIONAL')) {
    const direction = directionFor(card.metricId, cmp.delta);
    out.push({
      metricId: card.metricId,
      domain: def.domain,
      kind: cmp.changeClass === 'MEANINGFUL' ? 'MEANINGFUL_CHANGE' : 'DIRECTIONAL_CHANGE',
      direction,
      priority: cmp.changeClass === 'MEANINGFUL' ? (direction === 'unfavourable' ? 1 : 2) : 3,
      delta: cmp.delta,
      deltaPct: cmp.deltaPct,
      effectSize: cmp.effectSize,
      explanation: cmp.explanation,
      evidence: { window7: cmp.current7d, baseline28: cmp.baseline28d, algorithm: 'baseline_7_vs_28', version: 1 },
    });
  }
  // 365-day highs/lows of the 7-day mean (needs at least 60 daily values for a meaningful range)
  if (cmp && cmp.current7d.mean !== null && input.daily365.length >= 60) {
    const values = input.daily365.map((d) => d.value);
    const pct = percentileRank(cmp.current7d.mean, values);
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (pct !== null && cmp.current7d.mean >= max) {
      out.push({ metricId: card.metricId, domain: def.domain, kind: 'NEW_365D_HIGH', direction: directionFor(card.metricId, 1), priority: 2, delta: null, deltaPct: null, effectSize: null, explanation: `7-day mean ${cmp.current7d.mean.toFixed(def.precision)} ${def.unit} is the highest daily level in the trailing 365 days (${values.length} days).`, evidence: { percentile: pct, days: values.length, max, min } });
    } else if (pct !== null && cmp.current7d.mean <= min) {
      out.push({ metricId: card.metricId, domain: def.domain, kind: 'NEW_365D_LOW', direction: directionFor(card.metricId, -1), priority: 2, delta: null, deltaPct: null, effectSize: null, explanation: `7-day mean ${cmp.current7d.mean.toFixed(def.precision)} ${def.unit} is the lowest daily level in the trailing 365 days (${values.length} days).`, evidence: { percentile: pct, days: values.length, max, min } });
    }
  }
  if (cmp && cmp.changeClass !== 'INSUFFICIENT_EVIDENCE' && cmp.current7d.coverage < 0.6) {
    out.push({ metricId: card.metricId, domain: def.domain, kind: 'LOW_COVERAGE', direction: null, priority: 3, delta: null, deltaPct: null, effectSize: null, explanation: `Only ${cmp.current7d.daysWithData} of ${cmp.current7d.days} days have data this week; conclusions are tentative.`, evidence: { coverage: cmp.current7d.coverage } });
  }
  if (card.freshness.status === 'STALE') out.push({ metricId: card.metricId, domain: def.domain, kind: 'STALE_SOURCE', direction: null, priority: 2, delta: null, deltaPct: null, effectSize: null, explanation: card.freshness.reason, evidence: { freshness: card.freshness } });
  if (card.freshness.status === 'SYNC_ERROR') out.push({ metricId: card.metricId, domain: def.domain, kind: 'SYNC_ERROR', direction: null, priority: 1, delta: null, deltaPct: null, effectSize: null, explanation: card.freshness.reason, evidence: { freshness: card.freshness } });
  if ((input.implausibleCount30d ?? 0) > 0) out.push({ metricId: card.metricId, domain: def.domain, kind: 'IMPLAUSIBLE_VALUES', direction: null, priority: 3, delta: null, deltaPct: null, effectSize: null, explanation: `${input.implausibleCount30d} implausible value(s) flagged in the last 30 days are excluded from trends; review them.`, evidence: { count: input.implausibleCount30d } });
  return out;
}

/** Orders signals: priority first, then unfavourable before favourable, then larger effect sizes. */
export function rankSignals(signals: Signal[]): Signal[] {
  const dirRank = (d: SignalDirection | null) => (d === 'unfavourable' ? 0 : d === 'neutral' ? 1 : d === null ? 2 : 3);
  return [...signals].sort((a, b) => a.priority - b.priority || dirRank(a.direction) - dirRank(b.direction) || Math.abs(b.effectSize ?? 0) - Math.abs(a.effectSize ?? 0));
}
