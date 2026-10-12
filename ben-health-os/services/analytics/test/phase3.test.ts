import { describe, expect, it } from 'vitest';
import type { MetricCard } from '@bho/contracts';
import { detectSignals, rankSignals } from '../src/signals.js';
import { estimateMaxHeartRate, estimateZoneMinutes, zoneBounds, confidenceFromCoverage } from '../src/zones.js';

function card(metricId: string, changeClass: string, delta: number | null, mean = 55, coverage = 1, freshness = 'CURRENT'): MetricCard {
  return {
    metricId,
    label: metricId,
    unit: 'bpm',
    domain: 'recovery',
    latest: null,
    freshness: { status: freshness as MetricCard['freshness']['status'], reason: 'r', measuredAt: null, sourceUpdatedAt: null, ingestedAt: null, expectedLatencyHours: 1, ageHours: null },
    comparison: { changeClass: changeClass as never, delta, deltaPct: delta === null ? null : 5, effectSize: delta === null ? null : 1.2, explanation: 'x', current7d: { from: 'a', to: 'b', daysWithData: Math.round(coverage * 7), days: 7, coverage, n: 7, mean, median: mean, sd: 1, min: mean - 1, max: mean + 1, slopePerDay: 0 }, baseline28d: { from: 'a', to: 'b', daysWithData: 28, days: 28, coverage: 1, n: 28, mean: mean - (delta ?? 0), median: null, sd: 2, min: null, max: null, slopePerDay: null } },
    sparkline: [],
    qualityFlags: [],
  };
}

describe('signal engine', () => {
  it('emits ranked meaningful/directional signals with direction from the catalog', () => {
    const daily = Array.from({ length: 100 }, (_, i) => ({ localDate: `d${i}`, value: 50 + (i % 7) }));
    const s = detectSignals({ card: card('resting_heart_rate', 'MEANINGFUL', +6, 61), daily365: daily });
    expect(s.map((x) => x.kind)).toEqual(['MEANINGFUL_CHANGE', 'NEW_365D_HIGH']);
    expect(s[0]!.direction).toBe('unfavourable');
    expect(s[0]!.priority).toBe(1);
    const d = detectSignals({ card: card('hrv_rmssd', 'DIRECTIONAL', +3, 45), daily365: [] });
    expect(d[0]).toMatchObject({ kind: 'DIRECTIONAL_CHANGE', direction: 'favourable', priority: 3 });
    const ranked = rankSignals([...d, ...s]);
    expect(ranked[0]!.kind).toBe('MEANINGFUL_CHANGE');
  });
  it('flags low coverage, stale sources, sync errors and implausible values', () => {
    const s = detectSignals({ card: card('weight', 'NOISE', 0.1, 80, 0.4, 'STALE'), daily365: [], implausibleCount30d: 2 });
    expect(s.map((x) => x.kind).sort()).toEqual(['IMPLAUSIBLE_VALUES', 'LOW_COVERAGE', 'STALE_SOURCE']);
    expect(detectSignals({ card: card('weight', 'INSUFFICIENT_EVIDENCE', null, 80, 0.2, 'SYNC_ERROR'), daily365: [] }).map((x) => x.kind)).toEqual(['SYNC_ERROR']);
  });
});

describe('heart-rate zones', () => {
  it('uses the profile max HR first, Tanaka second, and refuses to guess', () => {
    expect(estimateMaxHeartRate({ maxHeartRate: 185 })).toEqual({ value: 185, source: 'profile' });
    expect(estimateMaxHeartRate({ birthDate: '1986-06-15', asOf: '2026-10-12' })).toEqual({ value: 180, source: 'tanaka_estimate' });
    expect(estimateMaxHeartRate({})).toBeNull();
    expect(zoneBounds(180)).toEqual({ zone2: [108, 126], vigorous: [139, 180] });
  });
  it('estimates zone minutes from samples and returns null without enough samples', () => {
    const w = { startAt: '2026-10-11T11:00:00Z', endAt: '2026-10-11T11:40:00Z' };
    const samples = Array.from({ length: 8 }, (_, i) => ({ time: new Date(Date.parse(w.startAt) + i * 5 * 60_000).toISOString(), bpm: i < 6 ? 118 : 150 }));
    const z = estimateZoneMinutes(w, samples, 180)!;
    expect(z.minutes).toBe(30);
    expect(z.samples).toBe(8);
    expect(estimateZoneMinutes(w, samples.slice(0, 2), 180)).toBeNull();
    expect(estimateZoneMinutes(w, samples.slice(0, 3), 180)).toBeNull(); // spans only 10 of 40 minutes
    expect(confidenceFromCoverage(0.9, 6)).toBe('HIGH');
    expect(confidenceFromCoverage(0.5, 3)).toBe('MEDIUM');
    expect(confidenceFromCoverage(0.2, 1)).toBe('LOW');
  });
});
