import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { BloodPressureReadingSchema, IngestResultSchema } from '@bho/contracts';
import { login, testApp, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await testApp();
});
afterAll(async () => {
  await app.close();
});

const NOW = new Date();

describe('manual measurements', () => {
  it('manual BP entry is idempotent, grouped into sessions, and deduplicated against a cuff reading', async () => {
    const { auth } = await login(app, uniqueEmail('bp'));
    const t = new Date(NOW.getTime() - 3_600_000).toISOString();
    const entry = { systolic: 122, diastolic: 78, pulse: 61, measuredAt: t, arm: 'LEFT', posture: 'SEATED', seatedRestMinutes: 5, clientEntryId: 'manual-entry-0001' };
    const first = await app.inject({ method: 'POST', url: '/v1/measurements/blood-pressure', headers: auth, payload: entry });
    expect(first.statusCode).toBe(201);
    const reading = BloodPressureReadingSchema.parse(first.json());
    const second = await app.inject({ method: 'POST', url: '/v1/measurements/blood-pressure', headers: auth, payload: entry });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(reading.id);
    // a second reading two minutes later joins the same session
    const t2 = new Date(Date.parse(t) + 120_000).toISOString();
    const r2 = await app.inject({ method: 'POST', url: '/v1/measurements/blood-pressure', headers: auth, payload: { ...entry, measuredAt: t2, systolic: 118, clientEntryId: 'manual-entry-0002' } });
    expect(r2.json().sessionId).toBe(reading.sessionId);
    const summary = await app.inject({ method: 'GET', url: '/v1/blood-pressure/summary', headers: auth });
    expect(summary.json().sessions[0].n).toBe(2);
    expect(summary.json().sessions[0].systolic).toBe(120);

    // The same measurement arriving from the Withings cuff via Health Connect becomes canonical; manual becomes the duplicate
    const cuff = { recordType: 'BloodPressure', hcId: 'cuff-1', dataOrigin: 'com.withings.wiscale2', lastModifiedTime: t, recordingMethod: 'AUTOMATICALLY_RECORDED', time: new Date(Date.parse(t) + 30_000).toISOString(), zoneOffset: '-04:00', payload: { systolicMmHg: 122, diastolicMmHg: 78 } };
    const ing = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: { source: 'health_connect', deviceInstanceId: 'test-device-00000002', appVersion: 't', timeZone: 'America/New_York', clientTime: NOW.toISOString(), mode: 'CHANGES', records: [cuff], deletions: [] } });
    expect(IngestResultSchema.parse(ing.json()).crossSourceDuplicates).toBe(1);
    const after = await app.inject({ method: 'GET', url: '/v1/blood-pressure/summary', headers: auth });
    const readings = after.json().readings as Array<{ id: string; connector: string; canonical: boolean }>;
    expect(readings.find((r) => r.id === reading.id)!.canonical).toBe(false);
    expect(readings.find((r) => r.connector === 'health_connect')!.canonical).toBe(true);
    expect(after.json().avg30d.n).toBe(2); // manual duplicate counted once
  });

  it('rejects implausible manual entries that violate the schema and flags out-of-range body values', async () => {
    const { auth } = await login(app, uniqueEmail('body'));
    const bad = await app.inject({ method: 'POST', url: '/v1/measurements/blood-pressure', headers: auth, payload: { systolic: 90, diastolic: 95, measuredAt: NOW.toISOString(), clientEntryId: 'manual-entry-bad' } });
    expect(bad.statusCode).toBe(400);
    const typo = await app.inject({ method: 'POST', url: '/v1/measurements/body', headers: auth, payload: { metricId: 'weight', value: 8.2, measuredAt: NOW.toISOString(), clientEntryId: 'manual-weight-typo' } });
    expect(typo.statusCode).toBe(201);
    expect(typo.json().qualityFlags).toContain('IMPLAUSIBLE_VALUE');
  });
});

describe('account export and deletion, RLS isolation', () => {
  it('users only ever see their own data; export contains rows; delete empties everything', async () => {
    const a = await login(app, uniqueEmail('rls-a'));
    const b = await login(app, uniqueEmail('rls-b'));
    await app.inject({ method: 'POST', url: '/v1/measurements/body', headers: a.auth, payload: { metricId: 'weight', value: 80, measuredAt: NOW.toISOString(), clientEntryId: 'a-weight-1' } });
    const bSeries = await app.inject({ method: 'GET', url: '/v1/metrics/weight/series?bucket=raw', headers: b.auth });
    expect(bSeries.json().points).toHaveLength(0);
    const bExport = await app.inject({ method: 'GET', url: '/v1/me/export', headers: b.auth });
    expect(bExport.json().observations).toHaveLength(0);

    const aExport = await app.inject({ method: 'GET', url: '/v1/me/export', headers: a.auth });
    expect(aExport.json().observations).toHaveLength(1);
    expect(aExport.json().raw_ingest_events).toHaveLength(1);

    const refused = await app.inject({ method: 'DELETE', url: '/v1/me/data', headers: a.auth, payload: { confirmation: 'yes' } });
    expect(refused.statusCode).toBe(400);
    const deleted = await app.inject({ method: 'DELETE', url: '/v1/me/data', headers: a.auth, payload: { confirmation: 'DELETE ALL MY HEALTH DATA' } });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().total).toBeGreaterThan(0);
    const afterExport = await app.inject({ method: 'GET', url: '/v1/me/export', headers: a.auth });
    expect(afterExport.json().observations).toHaveLength(0);
    expect(afterExport.json().audit_log.map((e: { action: string }) => e.action)).toContain('DELETE_ALL');
  });

  it('demo seed refuses to overwrite real data and can be cleared', async () => {
    const { auth } = await login(app, uniqueEmail('demo'));
    await app.inject({ method: 'POST', url: '/v1/measurements/body', headers: auth, payload: { metricId: 'weight', value: 80, measuredAt: NOW.toISOString(), clientEntryId: 'real-weight-1' } });
    const refused = await app.inject({ method: 'POST', url: '/v1/demo/seed', headers: auth, payload: { days: 10 } });
    expect(refused.statusCode).toBe(409);
    await app.inject({ method: 'DELETE', url: '/v1/me/data', headers: auth, payload: { confirmation: 'DELETE ALL MY HEALTH DATA' } });
    const seeded = await app.inject({ method: 'POST', url: '/v1/demo/seed', headers: auth, payload: { days: 10 } });
    expect(seeded.statusCode).toBe(200);
    expect(seeded.json().ingest.rejected).toBe(0);
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    expect(me.json().demoMode).toBe(true);
    const cleared = await app.inject({ method: 'DELETE', url: '/v1/demo', headers: auth });
    expect(cleared.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: auth })).json().demoMode).toBe(false);
  });
});
