import { describe, expect, it } from 'vitest';
import { metricById } from '@bho/shared-config';
import { baselineWindows, compareBaseline, dailyAggregate, sparkline, windowStats } from '../src/windows.js';
import { addDays, enumerateDays } from '../src/time.js';

function series(from: string, to: string, fn: (i: number) => number | null) {
  return enumerateDays(from, to)
    .map((localDate, i) => ({ localDate, value: fn(i) }))
    .filter((d): d is { localDate: string; value: number } => d.value !== null);
}

describe('baseline windows', () => {
  it('7-day window and preceding 28-day baseline never overlap', () => {
    const w = baselineWindows('2026-10-11');
    expect(w.current).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(w.baseline).toEqual({ from: '2026-09-07', to: '2026-10-04' });
    expect(addDays(w.baseline.to, 1)).toBe(w.current.from);
  });

  it('missing days are missing, not zero: coverage reflects gaps', () => {
    const daily = series('2026-10-05', '2026-10-11', (i) => (i % 2 === 0 ? 100 : null));
    const s = windowStats(daily, '2026-10-05', '2026-10-11');
    expect(s.days).toBe(7);
    expect(s.daysWithData).toBe(4);
    expect(s.coverage).toBeCloseTo(4 / 7);
    expect(s.mean).toBe(100); // not dragged down by zeros
  });

  it('reports INSUFFICIENT_EVIDENCE when coverage is below the metric minimum', () => {
    const daily = series('2026-09-07', '2026-10-11', (i) => (i > 30 ? 60 : null)); // only 4 days total
    const cmp = compareBaseline('resting_heart_rate', daily, '2026-10-11');
    expect(cmp.changeClass).toBe('INSUFFICIENT_EVIDENCE');
    expect(cmp.delta).toBeNull();
    expect(cmp.explanation).toMatch(/Not enough data/);
  });

  it('classifies a clear resting-heart-rate rise as MEANINGFUL and a tiny one as NOISE', () => {
    const baseline = series('2026-09-07', '2026-10-04', (i) => 55 + (i % 3) - 1); // 54..56
    const risen = series('2026-10-05', '2026-10-11', () => 61);
    const flat = series('2026-10-05', '2026-10-11', (i) => 55 + (i % 2));
    const up = compareBaseline('resting_heart_rate', [...baseline, ...risen], '2026-10-11');
    expect(up.changeClass).toBe('MEANINGFUL');
    expect(up.delta).toBeCloseTo(6, 0);
    expect(up.explanation).toMatch(/worse/);
    const same = compareBaseline('resting_heart_rate', [...baseline, ...flat], '2026-10-11');
    expect(same.changeClass).toBe('NOISE');
  });

  it('uses effect size when the catalog has no absolute meaningful delta (HRV)', () => {
    const baseline = series('2026-09-07', '2026-10-04', (i) => 40 + (i % 5)); // sd ~1.4
    const higher = series('2026-10-05', '2026-10-11', () => 48);
    const cmp = compareBaseline('hrv_rmssd', [...baseline, ...higher], '2026-10-11');
    expect(cmp.changeClass).toBe('MEANINGFUL');
    expect(cmp.effectSize!).toBeGreaterThan(0.8);
    expect(cmp.explanation).toMatch(/better/);
  });

  it('aggregates per day according to the catalog rule', () => {
    const steps = metricById('steps')!;
    const rhr = metricById('resting_heart_rate')!;
    const pts = [
      { localDate: '2026-10-11', value: 1000, measuredAt: '2026-10-11T08:00:00Z' },
      { localDate: '2026-10-11', value: 2500, measuredAt: '2026-10-11T12:00:00Z' },
      { localDate: '2026-10-11', value: 999, measuredAt: '2026-10-11T13:00:00Z', canonical: false },
    ];
    expect(dailyAggregate(pts, steps)).toEqual([{ localDate: '2026-10-11', value: 3500 }]);
    expect(dailyAggregate([{ localDate: '2026-10-11', value: 52, measuredAt: 'a' }, { localDate: '2026-10-11', value: 49, measuredAt: 'b' }], rhr)).toEqual([{ localDate: '2026-10-11', value: 49 }]);
  });

  it('sparkline keeps null for missing days', () => {
    const sp = sparkline([{ localDate: '2026-10-10', value: 1 }], '2026-10-09', '2026-10-11');
    expect(sp).toEqual([
      { date: '2026-10-09', value: null },
      { date: '2026-10-10', value: 1 },
      { date: '2026-10-11', value: null },
    ]);
  });
});
