import { describe, expect, it } from 'vitest';
import { addDays, dayRange, daysBetween, enumerateDays, localDateOf, localTimeOf, offsetMinutes } from '../src/time.js';

const NY = 'America/New_York';

describe('time zone helpers', () => {
  it('buckets an instant into the local date using the user zone', () => {
    // 03:30Z on Oct 12 is 23:30 on Oct 11 in New York (EDT, -04:00)
    expect(localDateOf('2026-10-12T03:30:00Z', null, NY)).toBe('2026-10-11');
    expect(localDateOf('2026-10-12T04:30:00Z', null, NY)).toBe('2026-10-12');
  });

  it('prefers the record zone offset over the user zone (travel days)', () => {
    // Device in Tokyo (+09:00): 23:00Z on Oct 11 is already Oct 12 locally
    expect(localDateOf('2026-10-11T23:00:00Z', '+09:00', NY)).toBe('2026-10-12');
    expect(localDateOf('2026-10-11T23:00:00Z', null, NY)).toBe('2026-10-11');
  });

  it('handles DST transitions: spring forward (23h day) and fall back (25h day)', () => {
    expect(dayRange('2026-03-08', NY).hours).toBe(23);
    expect(dayRange('2026-11-01', NY).hours).toBe(25);
    expect(dayRange('2026-10-12', NY).hours).toBe(24);
    expect(offsetMinutes(Date.parse('2026-07-01T12:00:00Z'), NY)).toBe(-240);
    expect(offsetMinutes(Date.parse('2026-01-15T12:00:00Z'), NY)).toBe(-300);
  });

  it('day arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
    expect(enumerateDays('2026-01-30', '2026-02-02')).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  });

  it('local time of day', () => {
    expect(localTimeOf('2026-10-12T11:15:00Z', null, NY)).toEqual({ hour: 7, minute: 15 });
    expect(localTimeOf('2026-10-12T11:15:00Z', '+02:00', NY)).toEqual({ hour: 13, minute: 15 });
  });
});
