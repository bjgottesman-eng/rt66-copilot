import { describe, expect, it } from 'vitest';
import { averageBp, groupSessions, morningEveningSplit, summarizeSession } from '../src/bp.js';
import { domainStatus } from '../src/domains.js';
import { plausibilityFlags, timestampFlags } from '../src/plausibility.js';
import type { MetricCard } from '@bho/contracts';

describe('blood pressure sessions', () => {
  const r = (id: string, t: string, s: number, d: number, p?: number) => ({ id, measuredAt: t, systolic: s, diastolic: d, pulse: p ?? null });
  it('groups readings within 30 minutes and averages transparently', () => {
    const groups = groupSessions([r('a', '2026-10-12T11:00:00Z', 124, 80, 62), r('b', '2026-10-12T11:02:00Z', 120, 78, 60), r('c', '2026-10-12T11:04:00Z', 118, 77, 61), r('d', '2026-10-12T22:00:00Z', 126, 82)]);
    expect(groups.map((g) => g.length)).toEqual([3, 1]);
    const s = summarizeSession(groups[0]!, 'MEAN_OF_ALL');
    expect(s.n).toBe(3);
    expect(s.systolic).toBeCloseTo(120.67, 1);
    const s2 = summarizeSession(groups[0]!, 'DROP_FIRST_IF_3_PLUS');
    expect(s2.n).toBe(2);
    expect(s2.systolic).toBe(119);
    expect(s2.rule).toMatch(/first reading discarded/);
  });
  it('splits morning and evening in local time', () => {
    const split = morningEveningSplit([r('a', '2026-10-12T11:00:00Z', 120, 80), r('b', '2026-10-12T23:30:00Z', 126, 82), r('c', '2026-10-12T17:00:00Z', 121, 79)], 'America/New_York');
    expect(split.morning.map((x) => x.id)).toEqual(['a']);
    expect(split.evening.map((x) => x.id)).toEqual(['b']);
    expect(split.other.map((x) => x.id)).toEqual(['c']);
  });
  it('excludes non-canonical duplicates from averages', () => {
    const avg = averageBp([{ ...r('a', '2026-10-12T11:00:00Z', 120, 80), canonical: true }, { ...r('b', '2026-10-12T11:00:30Z', 120, 80), canonical: false }]);
    expect(avg!.n).toBe(1);
  });
});

describe('plausibility', () => {
  it('flags impossible values without dropping them', () => {
    expect(plausibilityFlags('resting_heart_rate', 20)).toEqual(['IMPLAUSIBLE_VALUE']);
    expect(plausibilityFlags('resting_heart_rate', 55)).toEqual([]);
    expect(timestampFlags('2026-10-13T12:00:00Z', '2026-10-12T12:00:00Z')).toEqual(['FUTURE_TIMESTAMP']);
  });
});

describe('domain status', () => {
  const card = (metricId: string, changeClass: MetricCard['comparison'] extends infer _ ? any : never, delta: number | null, freshness = 'CURRENT'): MetricCard =>
    ({
      metricId,
      label: metricId,
      unit: '',
      domain: 'recovery',
      latest: null,
      freshness: { status: freshness as any, reason: '', measuredAt: null, sourceUpdatedAt: null, ingestedAt: null, expectedLatencyHours: 1, ageHours: null },
      comparison: changeClass ? { changeClass, delta, deltaPct: null, effectSize: null, explanation: 'x', current7d: {} as any, baseline28d: {} as any } : null,
      sparkline: [],
      qualityFlags: [],
    }) as MetricCard;
  it('ATTENTION on a meaningful unfavourable change', () => {
    expect(domainStatus([card('resting_heart_rate', 'MEANINGFUL', +6)]).status).toBe('ATTENTION');
  });
  it('IMPROVING on a meaningful favourable change with nothing worse', () => {
    expect(domainStatus([card('hrv_rmssd', 'MEANINGFUL', +8), card('resting_heart_rate', 'NOISE', 0.2)]).status).toBe('IMPROVING');
  });
  it('WATCH on directional unfavourable change', () => {
    expect(domainStatus([card('sleep_efficiency', 'DIRECTIONAL', -3)]).status).toBe('WATCH');
  });
  it('INSUFFICIENT_DATA and NOT_CONNECTED', () => {
    expect(domainStatus([card('hrv_rmssd', 'INSUFFICIENT_EVIDENCE', null)]).status).toBe('INSUFFICIENT_DATA');
    expect(domainStatus([card('hrv_rmssd', null, null, 'NOT_CONNECTED')]).status).toBe('NOT_CONNECTED');
  });
});
