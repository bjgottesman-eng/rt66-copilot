import type { BpReadingDto, BpSessionDto } from '@benhealth/shared';
import { describe, expect, it } from 'vitest';
import {
  bpAxisDomain,
  bpAxisTicks,
  dailyMeansFromPoints,
  inDayPart,
  localDateOf,
  localHourOf,
  sessionPoints,
} from '../src/lib/bp-data';

const TZ = 'America/New_York';

function reading(measuredAt: string, tz: string | null): BpReadingDto {
  return {
    id: 'r-' + measuredAt,
    measuredAt,
    measuredTz: tz,
    systolic: 120,
    diastolic: 80,
    pulse: 60,
    source: 'withings_api',
    sourceApp: null,
    sourceDevice: null,
    sessionId: 's1',
    arm: 'unknown',
    bodyPosition: 'unknown',
    note: null,
    canonical: true,
    duplicateOf: null,
    ingestedAt: measuredAt,
  };
}

function session(
  startedAt: string,
  tz: string | null,
  avgSystolic: number | null = 124,
  avgDiastolic: number | null = 81,
): BpSessionDto {
  return {
    id: 's-' + startedAt,
    startedAt,
    endedAt: startedAt,
    readingCount: 2,
    avgSystolic,
    avgDiastolic,
    avgPulse: 61,
    averagingMethod: 'mean_all',
    firstReadingExcluded: false,
    readings: [reading(startedAt, tz)],
  };
}

describe('localHourOf / localDateOf', () => {
  it('uses the measurement timezone', () => {
    // 2026-08-29T01:15Z == Aug 28, 21:15 EDT
    const d = new Date('2026-08-29T01:15:00.000Z');
    expect(localHourOf(d, TZ)).toBe(21);
    expect(localDateOf(d, TZ)).toBe('2026-08-28');
  });
  it('falls back to UTC for null/invalid tz', () => {
    const d = new Date('2026-08-29T01:15:00.000Z');
    expect(localHourOf(d, null)).toBe(1);
    expect(localDateOf(d, 'Bogus/Zone')).toBe('2026-08-29');
  });
  it('midnight is hour 0 (h23, never 24)', () => {
    expect(localHourOf(new Date('2026-08-29T04:00:00.000Z'), TZ)).toBe(0);
  });
});

describe('inDayPart (contracts §5 windows)', () => {
  it('morning is 04:00–11:59 local', () => {
    expect(inDayPart(3, 'morning')).toBe(false);
    expect(inDayPart(4, 'morning')).toBe(true);
    expect(inDayPart(11, 'morning')).toBe(true);
    expect(inDayPart(12, 'morning')).toBe(false);
  });
  it('evening is 17:00–23:59 local', () => {
    expect(inDayPart(16, 'evening')).toBe(false);
    expect(inDayPart(17, 'evening')).toBe(true);
    expect(inDayPart(23, 'evening')).toBe(true);
    expect(inDayPart(0, 'evening')).toBe(false);
  });
  it('all matches everything', () => {
    expect(inDayPart(0, 'all')).toBe(true);
    expect(inDayPart(23, 'all')).toBe(true);
  });
});

describe('sessionPoints', () => {
  it('maps sessions to sorted points with local classification', () => {
    const points = sessionPoints([
      session('2026-08-29T01:15:00.000Z', TZ), // evening Aug 28 EDT
      session('2026-08-28T11:30:00.000Z', TZ), // morning Aug 28 EDT (07:30)
    ]);
    expect(points).toHaveLength(2);
    expect(points[0]!.t).toBeLessThan(points[1]!.t);
    expect(points[0]!.localHour).toBe(7);
    expect(points[1]!.localHour).toBe(21);
    expect(points[1]!.localDate).toBe('2026-08-28');
  });

  it('skips sessions without averages (never coerces to zero)', () => {
    const points = sessionPoints([session('2026-08-28T11:30:00.000Z', TZ, null, null)]);
    expect(points).toHaveLength(0);
  });
});

describe('dailyMeansFromPoints', () => {
  it('averages per local day and rounds to 0.1', () => {
    const points = sessionPoints([
      session('2026-08-28T11:30:00.000Z', TZ, 120, 80),
      session('2026-08-29T01:15:00.000Z', TZ, 131, 85), // same local day (Aug 28 EDT)
      session('2026-08-29T11:30:00.000Z', TZ, 140, 90),
    ]);
    const daily = dailyMeansFromPoints(points);
    expect(daily).toHaveLength(2);
    expect(daily[0]!.date).toBe('2026-08-28');
    expect(daily[0]!.sys).toBe(125.5);
    expect(daily[0]!.dia).toBe(82.5);
    expect(daily[0]!.sessionCount).toBe(2);
    expect(daily[1]!.date).toBe('2026-08-29');
    expect(daily[1]!.sys).toBe(140);
  });
});

describe('bpAxisDomain', () => {
  it('spans at least 60–160 so variation is not exaggerated', () => {
    expect(bpAxisDomain([118, 125, 79, 84])).toEqual([60, 160]);
  });
  it('widens to round decades when data falls outside', () => {
    expect(bpAxisDomain([170, 80])).toEqual([60, 180]);
    expect(bpAxisDomain([120, 52])).toEqual([40, 160]);
  });
  it('never goes below zero', () => {
    expect(bpAxisDomain([2])[0]).toBe(0);
  });
});

describe('bpAxisTicks', () => {
  it('produces clean 20 mmHg steps', () => {
    expect(bpAxisTicks([60, 160])).toEqual([60, 80, 100, 120, 140, 160]);
  });
});
