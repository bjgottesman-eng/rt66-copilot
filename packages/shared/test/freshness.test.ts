import { describe, expect, it } from 'vitest';
import { computeFreshness, type FreshnessInput, type FreshnessStatus } from '../src/index.js';

const NOW = new Date('2026-08-29T12:00:00.000Z');

/** now minus N seconds. */
function ago(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

const MIN = 60;
const HOUR = 3600;

interface Case {
  name: string;
  input: FreshnessInput;
  expected: FreshnessStatus;
}

function connected(over: Partial<FreshnessInput>): FreshnessInput {
  return {
    connectionStatus: 'connected',
    lastSuccessAt: ago(5 * MIN),
    latestMeasuredAt: ago(5 * MIN),
    expectedLatencySeconds: 300,
    now: NOW,
    ...over,
  };
}

// expectedLatencySeconds=300 -> CURRENT threshold = max(600, 900) = 900 s.
const cases: Case[] = [
  // --- NOT_CONNECTED (checked before everything else) ---
  {
    name: 'not_connected wins even with fresh data',
    input: connected({ connectionStatus: 'not_connected', latestMeasuredAt: ago(10) }),
    expected: 'NOT_CONNECTED',
  },
  {
    name: 'not_connected with no data at all',
    input: connected({
      connectionStatus: 'not_connected',
      latestMeasuredAt: null,
      lastSuccessAt: null,
    }),
    expected: 'NOT_CONNECTED',
  },

  // --- SYNC_ERROR (checked second) ---
  {
    name: 'error status wins even with fresh data',
    input: connected({ connectionStatus: 'error', latestMeasuredAt: ago(10) }),
    expected: 'SYNC_ERROR',
  },
  {
    name: 'error status with null latestMeasuredAt is still SYNC_ERROR, not INSUFFICIENT_DATA',
    input: connected({ connectionStatus: 'error', latestMeasuredAt: null }),
    expected: 'SYNC_ERROR',
  },

  // --- INSUFFICIENT_DATA (checked third) ---
  {
    name: 'connected but no measurements ever',
    input: connected({ latestMeasuredAt: null }),
    expected: 'INSUFFICIENT_DATA',
  },

  // --- CURRENT: age <= max(2*expectedLatency, 15 min) ---
  {
    name: 'measurement just now',
    input: connected({ latestMeasuredAt: ago(0) }),
    expected: 'CURRENT',
  },
  {
    name: 'age exactly at the 15-min floor boundary (900 s, latency 300)',
    input: connected({ latestMeasuredAt: ago(15 * MIN) }),
    expected: 'CURRENT',
  },
  {
    name: 'one second past the 15-min floor boundary',
    input: connected({ latestMeasuredAt: ago(15 * MIN + 1) }),
    expected: 'RECENT',
  },
  {
    name: '2*latency dominates the 15-min floor (latency 1 h, age exactly 2 h)',
    input: connected({ expectedLatencySeconds: HOUR, latestMeasuredAt: ago(2 * HOUR) }),
    expected: 'CURRENT',
  },
  {
    name: 'one second past 2*latency (latency 1 h)',
    input: connected({ expectedLatencySeconds: HOUR, latestMeasuredAt: ago(2 * HOUR + 1) }),
    expected: 'RECENT',
  },
  {
    name: '15-min floor applies when 2*latency is smaller (latency 60 s, age 14 min)',
    input: connected({ expectedLatencySeconds: 60, latestMeasuredAt: ago(14 * MIN) }),
    expected: 'CURRENT',
  },
  {
    name: "'revoked' has no dedicated branch in the contract: falls through to age logic",
    input: connected({ connectionStatus: 'revoked', latestMeasuredAt: ago(60) }),
    expected: 'CURRENT',
  },

  // --- RECENT: age <= 24 h ---
  {
    name: 'a few hours old',
    input: connected({ latestMeasuredAt: ago(6 * HOUR) }),
    expected: 'RECENT',
  },
  {
    name: 'age exactly 24 h',
    input: connected({ latestMeasuredAt: ago(24 * HOUR) }),
    expected: 'RECENT',
  },

  // --- DELAYED_BY_SOURCE: age <= 72 h AND now - lastSuccessAt <= 6 h ---
  {
    name: 'one second past 24 h with a recent successful sync',
    input: connected({ latestMeasuredAt: ago(24 * HOUR + 1), lastSuccessAt: ago(HOUR) }),
    expected: 'DELAYED_BY_SOURCE',
  },
  {
    name: 'age exactly 72 h and lastSuccessAt exactly 6 h (both boundaries inclusive)',
    input: connected({ latestMeasuredAt: ago(72 * HOUR), lastSuccessAt: ago(6 * HOUR) }),
    expected: 'DELAYED_BY_SOURCE',
  },

  // --- STALE: everything else ---
  {
    name: 'one second past 72 h even with a fresh successful sync',
    input: connected({ latestMeasuredAt: ago(72 * HOUR + 1), lastSuccessAt: ago(MIN) }),
    expected: 'STALE',
  },
  {
    name: 'age in 24–72 h band but lastSuccessAt one second past 6 h',
    input: connected({ latestMeasuredAt: ago(48 * HOUR), lastSuccessAt: ago(6 * HOUR + 1) }),
    expected: 'STALE',
  },
  {
    name: 'age in 24–72 h band but no successful sync ever (lastSuccessAt null)',
    input: connected({ latestMeasuredAt: ago(48 * HOUR), lastSuccessAt: null }),
    expected: 'STALE',
  },
  {
    name: 'weeks old',
    input: connected({ latestMeasuredAt: ago(30 * 24 * HOUR), lastSuccessAt: ago(MIN) }),
    expected: 'STALE',
  },
];

describe('computeFreshness — contracts §3 table', () => {
  it.each(cases)('$name -> $expected', ({ input, expected }) => {
    expect(computeFreshness(input).status).toBe(expected);
  });
});

describe('computeFreshness — DTO fields', () => {
  it('round-trips timestamps as ISO-8601 UTC and reports floored ageSeconds', () => {
    const dto = computeFreshness(
      connected({
        latestMeasuredAt: new Date(NOW.getTime() - 90_500), // 90.5 s ago
        lastSuccessAt: ago(2 * MIN),
        expectedLatencySeconds: 300,
      }),
    );
    expect(dto).toEqual({
      status: 'CURRENT',
      latestMeasuredAt: new Date(NOW.getTime() - 90_500).toISOString(),
      lastSuccessAt: ago(2 * MIN).toISOString(),
      expectedLatencySeconds: 300,
      ageSeconds: 90,
    });
  });

  it('reports null latestMeasuredAt / ageSeconds when there is no data', () => {
    const dto = computeFreshness(
      connected({ latestMeasuredAt: null, lastSuccessAt: null }),
    );
    expect(dto.status).toBe('INSUFFICIENT_DATA');
    expect(dto.latestMeasuredAt).toBeNull();
    expect(dto.lastSuccessAt).toBeNull();
    expect(dto.ageSeconds).toBeNull();
  });

  it('still reports ageSeconds for NOT_CONNECTED / SYNC_ERROR when data exists', () => {
    const notConnected = computeFreshness(
      connected({ connectionStatus: 'not_connected', latestMeasuredAt: ago(120) }),
    );
    expect(notConnected.status).toBe('NOT_CONNECTED');
    expect(notConnected.ageSeconds).toBe(120);

    const errored = computeFreshness(
      connected({ connectionStatus: 'error', latestMeasuredAt: ago(3600) }),
    );
    expect(errored.status).toBe('SYNC_ERROR');
    expect(errored.ageSeconds).toBe(3600);
  });
});
