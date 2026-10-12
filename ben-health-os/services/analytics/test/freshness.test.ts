import { describe, expect, it } from 'vitest';
import { computeFreshness, type ConnectionHealth } from '../src/freshness.js';

const now = '2026-10-12T12:00:00Z';
const hc = (over: Partial<ConnectionHealth> = {}): ConnectionHealth => ({
  status: 'CONNECTED',
  lastSuccessfulSyncAt: '2026-10-12T11:00:00Z',
  lastSyncAttemptAt: '2026-10-12T11:00:00Z',
  lastSyncStatus: 'SUCCESS',
  lastError: null,
  expectedSyncIntervalHours: 6,
  displayName: 'Google Health Connect',
  ...over,
});

describe('freshness status', () => {
  it('NOT_CONNECTED when no source provides the metric', () => {
    const f = computeFreshness({ metricId: 'steps', now, latestMeasuredAt: null, sourceUpdatedAt: null, ingestedAt: null, connections: [] });
    expect(f.status).toBe('NOT_CONNECTED');
  });
  it('INSUFFICIENT_DATA when connected but nothing received', () => {
    const f = computeFreshness({ metricId: 'steps', now, latestMeasuredAt: null, sourceUpdatedAt: null, ingestedAt: null, connections: [hc()] });
    expect(f.status).toBe('INSUFFICIENT_DATA');
  });
  it('CURRENT / RECENT by measurement age', () => {
    expect(computeFreshness({ metricId: 'steps', now, latestMeasuredAt: '2026-10-12T10:00:00Z', sourceUpdatedAt: null, ingestedAt: now, connections: [hc()] }).status).toBe('CURRENT');
    expect(computeFreshness({ metricId: 'steps', now, latestMeasuredAt: '2026-10-11T20:00:00Z', sourceUpdatedAt: null, ingestedAt: now, connections: [hc()] }).status).toBe('RECENT');
  });
  it('SOURCE_DELAYED when our sync is healthy but the source has nothing newer', () => {
    const f = computeFreshness({ metricId: 'steps', now, latestMeasuredAt: '2026-10-10T20:00:00Z', sourceUpdatedAt: null, ingestedAt: now, connections: [hc()] });
    expect(f.status).toBe('SOURCE_DELAYED');
    expect(f.reason).toMatch(/has not produced anything newer/);
  });
  it('STALE when our own sync is overdue', () => {
    const f = computeFreshness({ metricId: 'steps', now, latestMeasuredAt: '2026-10-10T20:00:00Z', sourceUpdatedAt: null, ingestedAt: now, connections: [hc({ lastSuccessfulSyncAt: '2026-10-11T00:00:00Z' })] });
    expect(f.status).toBe('STALE');
    expect(f.reason).toMatch(/Refresh or reconnect/);
  });
  it('STALE after the stale threshold even with healthy sync (idle device)', () => {
    const f = computeFreshness({ metricId: 'blood_pressure_systolic', now, latestMeasuredAt: '2026-09-01T12:00:00Z', sourceUpdatedAt: null, ingestedAt: now, connections: [hc({ displayName: 'Withings', expectedSyncIntervalHours: 24 })] });
    expect(f.status).toBe('STALE');
    expect(f.reason).toMatch(/Take a new measurement/);
  });
  it('SYNC_ERROR when the only connection is failing and overdue', () => {
    const f = computeFreshness({ metricId: 'steps', now, latestMeasuredAt: '2026-10-11T20:00:00Z', sourceUpdatedAt: null, ingestedAt: now, connections: [hc({ lastSyncStatus: 'ERROR', lastError: 'permission revoked', lastSuccessfulSyncAt: '2026-10-11T00:00:00Z' })] });
    expect(f.status).toBe('SYNC_ERROR');
    expect(f.reason).toContain('permission revoked');
  });
  it('a recent error does not hide data while another healthy sync exists', () => {
    const f = computeFreshness({ metricId: 'steps', now, latestMeasuredAt: '2026-10-12T10:00:00Z', sourceUpdatedAt: null, ingestedAt: now, connections: [hc({ lastSyncStatus: 'ERROR', lastSuccessfulSyncAt: '2026-10-11T00:00:00Z' }), hc({ displayName: 'Oura' })] });
    expect(f.status).toBe('CURRENT');
  });
});
