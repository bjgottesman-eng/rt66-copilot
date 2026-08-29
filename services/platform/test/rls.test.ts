/**
 * RLS through the API: two users on the same instance; user B can never see
 * user A's readings, sessions, sources, or connector state (empty lists /
 * 404s — never data).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminCount, authHeaders, connectWithings, createHarness, login, type Harness } from './helpers.js';

let h: Harness;
let tokenB: string;

beforeAll(async () => {
  h = await createHarness();
  await connectWithings(h); // user A: 427 readings
  await h.ctx.auth.ensureUser('other@benhealth.local', 'other-password');
  tokenB = await login(h.app, 'other@benhealth.local', 'other-password');
});
afterAll(async () => {
  await h.close();
});

describe('RLS through the API', () => {
  it('gives the two users different identities', async () => {
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(tokenB),
    });
    const idB = (me.json() as { id: string }).id;
    expect(idB).not.toBe(h.userId);
  });

  it('user A sees the imported data', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/readings',
      headers: authHeaders(h.token),
    });
    expect((res.json() as { readings: unknown[] }).readings).toHaveLength(427);
  });

  it("user B cannot read user A's readings, latest, sessions, or summary", async () => {
    expect(await adminCount(h, 'select count(*) as n from blood_pressure_reading')).toBe(427);

    const readings = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/readings?includeDuplicates=true',
      headers: authHeaders(tokenB),
    });
    expect((readings.json() as { readings: unknown[] }).readings).toEqual([]);

    const latest = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/latest',
      headers: authHeaders(tokenB),
    });
    expect((latest.json() as { reading: unknown }).reading).toBeNull();

    const sessions = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/sessions',
      headers: authHeaders(tokenB),
    });
    expect((sessions.json() as { sessions: unknown[] }).sessions).toEqual([]);

    const summary = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/summary?window=30d',
      headers: authHeaders(tokenB),
    });
    expect((summary.json() as { readingCount: number }).readingCount).toBe(0);
  });

  it("user B does not see user A's Withings connection and cannot drive it", async () => {
    const sources = await h.app.inject({
      method: 'GET',
      url: '/api/v1/sources',
      headers: authHeaders(tokenB),
    });
    const withings = (
      sources.json() as { sources: Array<{ provider: string; connectionStatus: string }> }
    ).sources.find((s) => s.provider === 'withings');
    expect(withings?.connectionStatus).toBe('not_connected');

    const refresh = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/refresh',
      headers: authHeaders(tokenB),
    });
    expect(refresh.statusCode).toBe(404);
  });

  it("user B's own writes stay invisible to user A", async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/bp/manual',
      headers: authHeaders(tokenB),
      payload: { systolic: 100, diastolic: 60, measuredAt: '2026-08-29T09:00:00Z' },
    });
    expect(created.statusCode).toBe(201);
    const readingsA = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/readings?from=2026-08-29T08:00:00Z&to=2026-08-29T10:00:00Z',
      headers: authHeaders(h.token),
    });
    expect((readingsA.json() as { readings: unknown[] }).readings).toEqual([]);
  });
});
