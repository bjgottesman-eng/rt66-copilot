import { describe, expect, it } from 'vitest';
import { groupIntoSessions, sessionStats, type SessionReading } from '../src/sessions.js';

let seq = 0;
function reading(iso: string, sys: number, dia: number, pulse: number | null = 60): SessionReading {
  seq += 1;
  return {
    id: `r${String(seq).padStart(3, '0')}`,
    measuredAt: new Date(iso),
    systolic: sys,
    diastolic: dia,
    pulse,
  };
}

describe('groupIntoSessions (gap ≤ 15 min)', () => {
  it('chains readings with gaps at or under 15 minutes', () => {
    const rs = [
      reading('2026-08-01T07:00:00Z', 120, 80),
      reading('2026-08-01T07:15:00Z', 121, 81), // exactly 15 min -> same session
      reading('2026-08-01T07:30:01Z', 122, 82), // 15 min 1 s -> new session
    ];
    const groups = groupIntoSessions(rs);
    expect(groups.map((g) => g.length)).toEqual([2, 1]);
  });

  it('sorts input by time before grouping', () => {
    const a = reading('2026-08-01T07:10:00Z', 121, 81);
    const b = reading('2026-08-01T07:00:00Z', 120, 80);
    const groups = groupIntoSessions([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]![0]!.measuredAt.toISOString()).toBe('2026-08-01T07:00:00.000Z');
  });
});

describe('sessionStats averaging', () => {
  it('uses mean_all for sessions with fewer than 3 readings', () => {
    const stats = sessionStats([
      reading('2026-08-01T07:00:00Z', 120, 80, 60),
      reading('2026-08-01T07:02:00Z', 124, 82, 64),
    ]);
    expect(stats.averagingMethod).toBe('mean_all');
    expect(stats.firstReadingExcluded).toBe(false);
    expect(stats.avgSystolic).toBe(122);
    expect(stats.avgDiastolic).toBe(81);
    expect(stats.avgPulse).toBe(62);
    expect(stats.readingCount).toBe(2);
  });

  it('uses mean_excluding_first only when the session has ≥ 3 readings', () => {
    const stats = sessionStats([
      reading('2026-08-01T07:00:00Z', 140, 95, 70), // excluded
      reading('2026-08-01T07:02:00Z', 120, 80, 60),
      reading('2026-08-01T07:04:00Z', 124, 84, 64),
    ]);
    expect(stats.averagingMethod).toBe('mean_excluding_first');
    expect(stats.firstReadingExcluded).toBe(true);
    expect(stats.avgSystolic).toBe(122); // (120+124)/2, first excluded
    expect(stats.avgDiastolic).toBe(82);
    expect(stats.avgPulse).toBe(62);
  });

  it('never coerces missing pulse to zero when averaging', () => {
    const stats = sessionStats([
      reading('2026-08-01T07:00:00Z', 120, 80, null),
      reading('2026-08-01T07:02:00Z', 124, 82, 64),
    ]);
    expect(stats.avgPulse).toBe(64); // mean over present values only
    const noPulse = sessionStats([reading('2026-08-01T08:00:00Z', 120, 80, null)]);
    expect(noPulse.avgPulse).toBeNull();
  });

  it('rounds stored averages to one decimal', () => {
    const stats = sessionStats([
      reading('2026-08-01T07:00:00Z', 120, 80, 60),
      reading('2026-08-01T07:02:00Z', 121, 81, 61),
      reading('2026-08-01T07:04:00Z', 123, 82, 62),
      reading('2026-08-01T07:06:00Z', 124, 84, 64),
    ]);
    // mean of (121,123,124) = 122.666… -> 122.7
    expect(stats.avgSystolic).toBe(122.7);
  });
});
