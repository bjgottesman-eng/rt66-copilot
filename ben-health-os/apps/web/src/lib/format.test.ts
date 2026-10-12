import { describe, expect, it } from 'vitest';
import { changeTone, formatValue, relativeTime } from './format';

describe('format helpers', () => {
  it('formats values with sensible precision and units', () => {
    expect(formatValue(54.4, 'bpm', 0)).toBe('54 bpm');
    expect(formatValue(96.5, '%', 1)).toBe('96.5%');
    expect(formatValue(null, 'kg')).toBe('—');
  });
  it('relative time', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    expect(relativeTime('2026-10-12T11:30:00Z', now)).toBe('30 min ago');
    expect(relativeTime('2026-10-11T12:00:00Z', now)).toBe('24 h ago');
    expect(relativeTime('2026-10-01T12:00:00Z', now)).toBe('11 days ago');
  });
  it('change tone respects metric direction', () => {
    expect(changeTone('MEANINGFUL', 5, 'lower_better')).toBe('attention');
    expect(changeTone('MEANINGFUL', -5, 'lower_better')).toBe('good');
    expect(changeTone('NOISE', 5, 'lower_better')).toBe('neutral');
  });
});
