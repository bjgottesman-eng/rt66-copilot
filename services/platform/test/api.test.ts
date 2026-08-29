/**
 * API surface per contracts §5: auth, sources placeholders (all seven external
 * providers), bp endpoints + freshness wiring, manual entry validation, error
 * shape, and security headers.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeaders, createHarness, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('auth', () => {
  it('GET /health is public', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('login rejects bad credentials with the contract error shape', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: h.config.bootstrapUserEmail, password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: expect.any(String) },
    });
  });

  it('protected routes 401 without / with an invalid token', async () => {
    for (const headers of [undefined, { authorization: 'Bearer nope' }]) {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/bp/latest', headers });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
    }
  });

  it('GET /auth/me returns the JWT identity', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(h.token),
    });
    expect(res.json()).toEqual({ id: h.userId, email: h.config.bootstrapUserEmail });
  });

  it('sets security headers and hides unknown routes with the error shape', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /sources', () => {
  it('lists all seven external providers with NOT_CONNECTED placeholders', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/sources',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(200);
    const { sources } = res.json() as {
      sources: Array<{
        provider: string;
        displayName: string;
        connectionStatus: string;
        freshness: { status: string; expectedLatencySeconds: number };
        problems: string[];
      }>;
    };
    expect(sources.map((s) => s.provider)).toEqual([
      'withings',
      'apple_health',
      'oura',
      'stelo',
      'cronometer',
      'function',
      'clinical_records',
    ]);
    for (const s of sources) {
      expect(s.connectionStatus).toBe('not_connected');
      expect(s.freshness.status).toBe('NOT_CONNECTED');
      expect(s.freshness.expectedLatencySeconds).toBe(300);
      expect(s.problems).toEqual([]);
      expect(s.displayName.length).toBeGreaterThan(0);
    }
  });
});

describe('bp endpoints', () => {
  it('latest is null with INSUFFICIENT/NOT_CONNECTED freshness before any data', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/latest',
      headers: authHeaders(h.token),
    });
    expect(res.json()).toEqual({
      reading: null,
      freshness: expect.objectContaining({ status: 'NOT_CONNECTED', ageSeconds: null }),
    });
  });

  it('manual entry validates without echoing values', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/bp/manual',
      headers: authHeaders(h.token),
      payload: { systolic: 999, diastolic: 80, measuredAt: '2026-08-29T10:00:00Z' },
    });
    expect(res.statusCode).toBe(400);
    const { error } = res.json() as { error: { code: string; message: string } };
    expect(error.code).toBe('VALIDATION');
    expect(error.message).not.toContain('999');
  });

  it('stores a manual reading and serves it via latest with CURRENT freshness', async () => {
    const measuredAt = new Date(Date.now() - 60_000).toISOString();
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/bp/manual',
      headers: authHeaders(h.token),
      payload: {
        systolic: 122,
        diastolic: 81,
        pulse: 63,
        measuredAt,
        measuredTz: 'America/New_York',
        arm: 'left',
        bodyPosition: 'seated',
        note: 'after coffee',
        saveToAppleHealth: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const dto = (created.json() as { reading: Record<string, unknown> }).reading;
    expect(dto).toMatchObject({
      systolic: 122,
      diastolic: 81,
      pulse: 63,
      source: 'manual',
      arm: 'left',
      bodyPosition: 'seated',
      canonical: true,
      duplicateOf: null,
      measuredTz: 'America/New_York',
    });

    const latest = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/latest',
      headers: authHeaders(h.token),
    });
    const body = latest.json() as {
      reading: { id: string };
      freshness: { status: string; latestMeasuredAt: string };
    };
    expect(body.reading.id).toBe(dto.id);
    expect(body.freshness.status).toBe('CURRENT'); // 1 min old, manual counts as connected
  });

  it('summary rejects unknown windows and reports the manual reading', async () => {
    const bad = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/summary?window=90d',
      headers: authHeaders(h.token),
    });
    expect(bad.statusCode).toBe(400);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/summary?window=7d',
      headers: authHeaders(h.token),
    });
    const summary = res.json() as {
      window: string;
      readingCount: number;
      meanSystolic: number;
      daily: Array<{ date: string }>;
    };
    expect(summary.window).toBe('7d');
    expect(summary.readingCount).toBe(1);
    expect(summary.meanSystolic).toBe(122);
    expect(summary.daily).toHaveLength(1);
  });

  it('refresh without a Withings connection is NOT_CONNECTED', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/refresh',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_CONNECTED');
  });

  it('readings date filters validate', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/readings?from=yesterday',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(400);
  });
});
