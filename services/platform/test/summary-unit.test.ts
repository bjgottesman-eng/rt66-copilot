/**
 * Summary math (contracts §5): morning 04:00–11:59 / evening 17:00–23:59 in
 * measured_tz (UTC fallback), daily means — across the America/New_York DST
 * boundary (2025-11-02: clocks fall back, EDT UTC-4 → EST UTC-5 at 06:00Z).
 */

import { describe, expect, it } from 'vitest';
import { computeBpSummary, localDateAndHour, type SummaryReading } from '../src/summary.js';

const NY = 'America/New_York';

function r(iso: string, tz: string | null, sys: number, dia: number, pulse: number | null = 60, session = 's1'): SummaryReading {
  return {
    measuredAt: new Date(iso),
    measuredTz: tz,
    systolic: sys,
    diastolic: dia,
    pulse,
    sessionId: session,
  };
}

describe('localDateAndHour across the Nov 2 2025 DST boundary', () => {
  it('same UTC hour classifies differently before vs after fall-back', () => {
    // Nov 1 16:30Z = 12:30 EDT (UTC-4) — afternoon, NOT morning.
    expect(localDateAndHour(new Date('2025-11-01T16:30:00Z'), NY)).toEqual({
      date: '2025-11-01',
      hour: 12,
    });
    // Nov 2 16:30Z = 11:30 EST (UTC-5) — morning.
    expect(localDateAndHour(new Date('2025-11-02T16:30:00Z'), NY)).toEqual({
      date: '2025-11-02',
      hour: 11,
    });
  });

  it('assigns the local calendar date, not the UTC date', () => {
    // Nov 3 03:30Z = Nov 2 22:30 EST.
    expect(localDateAndHour(new Date('2025-11-03T03:30:00Z'), NY)).toEqual({
      date: '2025-11-02',
      hour: 22,
    });
  });

  it('falls back to UTC when tz is null or invalid', () => {
    expect(localDateAndHour(new Date('2025-11-02T16:30:00Z'), null).hour).toBe(16);
    expect(localDateAndHour(new Date('2025-11-02T16:30:00Z'), 'Not/AZone').hour).toBe(16);
  });
});

describe('computeBpSummary', () => {
  const now = new Date('2025-11-04T12:00:00Z');

  it('splits morning/evening by LOCAL wall time across the DST change', () => {
    const readings: SummaryReading[] = [
      r('2025-11-01T12:00:00Z', NY, 120, 80), // 08:00 EDT -> morning
      r('2025-11-01T16:30:00Z', NY, 150, 95), // 12:30 EDT -> neither
      r('2025-11-02T16:30:00Z', NY, 130, 85), // 11:30 EST -> morning
      r('2025-11-02T23:00:00Z', NY, 140, 90), // 18:00 EST -> evening
    ];
    const summary = computeBpSummary(readings, '7d', now);
    expect(summary.readingCount).toBe(4);
    expect(summary.morning.meanSystolic).toBe(125); // (120+130)/2
    expect(summary.morning.meanDiastolic).toBe(82.5);
    expect(summary.evening.meanSystolic).toBe(140);
    expect(summary.meanSystolic).toBe(135); // all four
  });

  it('groups daily means by the LOCAL calendar date', () => {
    const readings: SummaryReading[] = [
      r('2025-11-02T12:00:00Z', NY, 120, 80, 60, 's1'), // Nov 2 07:00 EST
      r('2025-11-03T03:30:00Z', NY, 130, 84, 62, 's2'), // Nov 2 22:30 EST (UTC date Nov 3!)
      r('2025-11-03T13:00:00Z', NY, 110, 70, 58, 's3'), // Nov 3 08:00 EST
    ];
    const summary = computeBpSummary(readings, '7d', now);
    expect(summary.daily).toEqual([
      { date: '2025-11-02', meanSystolic: 125, meanDiastolic: 82, sessionCount: 2 },
      { date: '2025-11-03', meanSystolic: 110, meanDiastolic: 70, sessionCount: 1 },
    ]);
    expect(summary.sessionCount).toBe(3);
  });

  it('windows by measured time and reports empty means as null (never 0)', () => {
    const readings: SummaryReading[] = [
      r('2025-10-01T12:00:00Z', NY, 200, 120), // outside 7d and 30d? 30d: Oct 5+ — outside
      r('2025-11-03T12:00:00Z', NY, 120, 80, null),
    ];
    const s7 = computeBpSummary(readings, '7d', now);
    expect(s7.readingCount).toBe(1);
    expect(s7.meanPulse).toBeNull();
    expect(s7.evening.meanSystolic).toBeNull();
    expect(s7.evening.meanSystolic).not.toBe(0);
    const s30 = computeBpSummary(readings, '30d', now);
    expect(s30.readingCount).toBe(1);
    expect(s30.window).toBe('30d');
  });
});
