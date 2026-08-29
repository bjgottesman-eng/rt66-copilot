/**
 * Wiring of source_connection rows into @benhealth/shared computeFreshness
 * (the algorithm itself is table-tested in packages/shared).
 */

import { computeFreshness } from '@benhealth/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPECTED_LATENCY_SECONDS, freshnessFor } from '../src/api/mappers.js';

const now = new Date('2026-08-29T12:00:00Z');

describe('freshnessFor wiring', () => {
  it('no connection row -> NOT_CONNECTED with the 300 s default latency', () => {
    const dto = freshnessFor(null, null, now);
    expect(dto.status).toBe('NOT_CONNECTED');
    expect(dto.expectedLatencySeconds).toBe(300);
    expect(DEFAULT_EXPECTED_LATENCY_SECONDS).toBe(300);
    expect(dto.ageSeconds).toBeNull();
  });

  it('error connection -> SYNC_ERROR regardless of data age', () => {
    const dto = freshnessFor(
      { status: 'error', last_success_at: now, expected_latency_seconds: 300 },
      new Date(now.getTime() - 60_000),
      now,
    );
    expect(dto.status).toBe('SYNC_ERROR');
    expect(dto.ageSeconds).toBe(60);
  });

  it('maps row fields onto computeFreshness inputs exactly', () => {
    const lastSuccess = new Date(now.getTime() - 10 * 60 * 1000);
    const latest = new Date(now.getTime() - 8 * 60 * 1000);
    const viaWiring = freshnessFor(
      { status: 'connected', last_success_at: lastSuccess, expected_latency_seconds: 300 },
      latest,
      now,
    );
    const direct = computeFreshness({
      connectionStatus: 'connected',
      lastSuccessAt: lastSuccess,
      latestMeasuredAt: latest,
      expectedLatencySeconds: 300,
      now,
    });
    expect(viaWiring).toEqual(direct);
    expect(viaWiring.status).toBe('CURRENT'); // 8 min < max(2*300s, 15 min)
  });

  it('honors a per-connection expected latency (2*latency window)', () => {
    const latest = new Date(now.getTime() - 50 * 60 * 1000); // 50 min old
    const wide = freshnessFor(
      { status: 'connected', last_success_at: now, expected_latency_seconds: 30 * 60 },
      latest,
      now,
    );
    expect(wide.status).toBe('CURRENT'); // 50 min <= 2*30 min
    const narrow = freshnessFor(
      { status: 'connected', last_success_at: now, expected_latency_seconds: 300 },
      latest,
      now,
    );
    expect(narrow.status).toBe('RECENT'); // 50 min > 15 min, <= 24 h
  });

  it('connected but no data -> INSUFFICIENT_DATA', () => {
    const dto = freshnessFor(
      { status: 'connected', last_success_at: now, expected_latency_seconds: 300 },
      null,
      now,
    );
    expect(dto.status).toBe('INSUFFICIENT_DATA');
  });
});
