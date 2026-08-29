import type { FreshnessDto } from '@benhealth/shared';
import { FRESHNESS_STATUSES } from '@benhealth/shared';
import { describe, expect, it } from 'vitest';
import { freshnessExplanation, freshnessTone } from '../src/lib/freshness-ui';

function dto(status: FreshnessDto['status'], ageSeconds: number | null = 3600): FreshnessDto {
  return {
    status,
    latestMeasuredAt: ageSeconds === null ? null : '2026-08-29T00:00:00.000Z',
    lastSuccessAt: '2026-08-29T00:00:00.000Z',
    expectedLatencySeconds: 300,
    ageSeconds,
  };
}

describe('freshnessTone', () => {
  it('maps every status to the contract tone', () => {
    expect(freshnessTone('CURRENT')).toBe('good');
    expect(freshnessTone('RECENT')).toBe('neutral');
    expect(freshnessTone('DELAYED_BY_SOURCE')).toBe('warn');
    expect(freshnessTone('STALE')).toBe('warn');
    expect(freshnessTone('SYNC_ERROR')).toBe('error');
    expect(freshnessTone('NOT_CONNECTED')).toBe('muted');
    expect(freshnessTone('INSUFFICIENT_DATA')).toBe('muted');
  });

  it('is exhaustive over the shared enum', () => {
    for (const status of FRESHNESS_STATUSES) {
      expect(['good', 'neutral', 'warn', 'error', 'muted']).toContain(freshnessTone(status));
    }
  });
});

describe('freshnessExplanation', () => {
  it('explains every status without the forbidden word "live"', () => {
    for (const status of FRESHNESS_STATUSES) {
      const text = freshnessExplanation(dto(status));
      expect(text.length).toBeGreaterThan(10);
      expect(text.toLowerCase()).not.toContain('live');
    }
  });

  it('includes the age when known', () => {
    expect(freshnessExplanation(dto('CURRENT', 7200))).toContain('2 h ago');
  });

  it('handles missing age', () => {
    expect(freshnessExplanation(dto('STALE', null))).toBe('No recent measurements.');
  });
});
