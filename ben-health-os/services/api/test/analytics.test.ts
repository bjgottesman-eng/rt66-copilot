import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { generateDemoDataset } from '@bho/fixtures';
import { DeriveResultSchema, TrendsResponseSchema, TodayResponseSchema } from '@bho/contracts';
import { login, TEST_DATABASE_URL, testApp, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let pool: pg.Pool;
beforeAll(async () => {
  app = await testApp();
  pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

describe('Phase 3 analytics', () => {
  it('derives versioned window stats, baselines, signals and zone-2 minutes; reruns are idempotent', async () => {
    const { auth, userId } = await login(app, uniqueEmail('derive'));
    const ds = generateDemoDataset({ days: 70, detailedDays: 14, glucoseDays: 5, endDate: yesterday });
    for (const b of ds.batches) expect((await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: b })).statusCode).toBe(200);

    // Without max HR or birth date, Zone 2 stays INSUFFICIENT_DATA with an actionable reason.
    const first = DeriveResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/analytics/derive', headers: auth })).json());
    expect(first.metricsComputed).toBeGreaterThan(10);
    expect(first.windowsWritten).toBe(first.metricsComputed * 5);
    expect(first.zone2Workouts).toBe(0);
    const today = TodayResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/dashboard/today', headers: auth })).json());
    const z = today.domains[1]!.metrics.find((m) => m.metricId === 'zone2_minutes')!;
    expect(z.freshness.status).toBe('INSUFFICIENT_DATA');
    expect(z.freshness.reason).toContain('Settings');

    // Set a birth date → Tanaka estimate → zone-2 minutes derived for runs that have heart-rate samples.
    expect((await app.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { birthDate: '1986-06-15' } })).statusCode).toBe(204);
    const second = DeriveResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/analytics/derive', headers: auth })).json());
    expect(second.zone2Workouts).toBeGreaterThan(0);
    const rows = await pool.query<{ n: number; versions: number }>(`select count(*)::int as n, count(distinct algorithm_version)::int as versions from public.derived_metrics where user_id = $1 and algorithm = 'window_stats'`, [userId]);
    expect(Number(rows.rows[0]!.n)).toBe(first.windowsWritten - first.metricsComputed + (second.metricsComputed - first.metricsComputed) * 4);
    expect(Number(rows.rows[0]!.versions)).toBe(1);
    const sig = await pool.query<{ n: number }>(`select count(*)::int as n from public.signals where user_id = $1`, [userId]);
    expect(Number(sig.rows[0]!.n)).toBe(second.signals);

    const trends = TrendsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/analytics/trends/resting_heart_rate', headers: auth })).json());
    expect(trends.windows.map((w) => w.days)).toEqual([7, 28, 90, 365]);
    expect(trends.windows[0]!.stats.n).toBeGreaterThan(3);
    expect(trends.windows[2]!.stats.daysWithData).toBeGreaterThan(50);
    expect(trends.windows[3]!.stats.coverage).toBeLessThan(0.3); // only 70 days of data in the 365 window: coverage is honest
    expect(trends.percentile365).not.toBeNull();
    expect(trends.daily).toHaveLength(365);
    expect(trends.windows[0]!.computedAt).not.toBe(trends.daily[0]!.date);
    const zone = TrendsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/analytics/trends/zone2_minutes', headers: auth })).json());
    expect(zone.zone?.source).toBe('tanaka_estimate');
    expect(zone.zone?.zone2![0]).toBeGreaterThan(90);

    const signals = (await app.inject({ method: 'GET', url: '/v1/analytics/signals', headers: auth })).json().signals as Array<{ kind: string; metricId: string }>;
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.some((s) => s.kind === 'IMPLAUSIBLE_VALUES' && s.metricId === 'weight')).toBe(true);

    // Removing the physiology again removes the derived zone-2 observations (no stale derived data).
    expect((await app.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { birthDate: null } })).statusCode).toBe(204);
    const third = DeriveResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/analytics/derive', headers: auth })).json());
    expect(third.zone2Workouts).toBe(0);
    const left = await pool.query<{ n: number }>(`select count(*)::int as n from public.observations where user_id = $1 and metric_id = 'zone2_minutes'`, [userId]);
    expect(Number(left.rows[0]!.n)).toBe(0);
  });

  it('the internal derive job requires the secret', async () => {
    const other = await (await import('../src/app.js')).buildApp({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_MODE: 'local', LOG_LEVEL: 'silent', LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret', JOB_SECRET: 'derive-secret' });
    try {
      expect((await other.inject({ method: 'POST', url: '/internal/jobs/derive' })).statusCode).toBe(401);
      const res = await other.inject({ method: 'POST', url: '/internal/jobs/derive', headers: { 'x-job-secret': 'derive-secret' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().users).toBeGreaterThan(0);
      expect(res.json().failed).toBe(0);
    } finally {
      await other.close();
    }
  });
});
