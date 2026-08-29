import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatLatency,
  formatMeasuredAt,
  formatShortDate,
  relativeAge,
  relativeAgeFromSeconds,
} from '../src/lib/format';

// Fixture timezone matches the demo persona (America/New_York, EDT in August).
const TZ = 'America/New_York';

describe('formatMeasuredAt', () => {
  it('renders in the reading timezone with tz name', () => {
    // 2026-08-28T21:15 EDT == 2026-08-29T01:15Z
    const s = formatMeasuredAt('2026-08-29T01:15:00.000Z', TZ);
    expect(s).toContain('Aug 28');
    expect(s).toContain('2026');
    expect(s).toContain('9:15');
    expect(s).toContain('EDT');
  });

  it('falls back to UTC when tz is null or invalid', () => {
    expect(formatMeasuredAt('2026-08-29T01:15:00.000Z', null)).toContain('UTC');
    expect(formatMeasuredAt('2026-08-29T01:15:00.000Z', 'Not/AZone')).toContain('UTC');
  });

  it('handles winter time (EST) across the DST boundary', () => {
    const s = formatMeasuredAt('2026-01-15T12:30:00.000Z', TZ);
    expect(s).toContain('7:30');
    expect(s).toContain('EST');
  });
});

describe('formatClock / formatShortDate', () => {
  it('formats clock time in tz', () => {
    expect(formatClock('2026-08-29T01:15:00.000Z', TZ)).toBe('9:15 PM');
  });
  it('formats short date in tz (crosses midnight vs UTC)', () => {
    expect(formatShortDate('2026-08-29T01:15:00.000Z', TZ)).toBe('Aug 28');
    expect(formatShortDate('2026-08-29T01:15:00.000Z', null)).toBe('Aug 29');
  });
});

describe('relativeAge', () => {
  const now = new Date('2026-08-29T12:00:00.000Z');
  it('just now under a minute', () => {
    expect(relativeAge('2026-08-29T11:59:30.000Z', now)).toBe('just now');
  });
  it('minutes', () => {
    expect(relativeAge('2026-08-29T11:55:00.000Z', now)).toBe('5 min ago');
  });
  it('hours (spec example: measured 2 h ago)', () => {
    expect(relativeAge('2026-08-29T10:00:00.000Z', now)).toBe('2 h ago');
  });
  it('keeps hours until 48 h, then days', () => {
    expect(relativeAge('2026-08-28T13:00:00.000Z', now)).toBe('23 h ago');
    expect(relativeAge('2026-08-26T12:00:00.000Z', now)).toBe('3 d ago');
  });
  it('future timestamps degrade to just now', () => {
    expect(relativeAge('2026-08-29T12:05:00.000Z', now)).toBe('just now');
  });
});

describe('relativeAgeFromSeconds', () => {
  it('matches relativeAge semantics', () => {
    expect(relativeAgeFromSeconds(30)).toBe('just now');
    expect(relativeAgeFromSeconds(7200)).toBe('2 h ago');
    expect(relativeAgeFromSeconds(3 * 86_400)).toBe('3 d ago');
  });
});

describe('formatLatency', () => {
  it('humanizes seconds, minutes, hours', () => {
    expect(formatLatency(45)).toBe('45 s');
    expect(formatLatency(300)).toBe('5 min');
    expect(formatLatency(86_400)).toBe('24 h');
  });
});
