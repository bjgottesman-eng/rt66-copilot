import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateDemoDataset } from '@bho/fixtures';
import { IngestResultSchema, TodayResponseSchema, SourcesResponseSchema, SeriesResponseSchema, BloodPressureSummarySchema, type HealthConnectIngestBatch } from '@bho/contracts';
import { login, testApp, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await testApp();
});
afterAll(async () => {
  await app.close();
});

const NOW = new Date();
const yesterday = new Date(NOW.getTime() - 86_400_000).toISOString().slice(0, 10);

function smallBatch(overrides: Partial<HealthConnectIngestBatch> = {}): HealthConnectIngestBatch {
  return {
    source: 'health_connect',
    deviceInstanceId: 'test-device-00000001',
    deviceLabel: 'Test phone',
    appVersion: '0.1.0-test',
    timeZone: 'America/New_York',
    clientTime: NOW.toISOString(),
    mode: 'CHANGES',
    records: [],
    deletions: [],
    permissions: [{ permission: 'android.permission.health.READ_STEPS', granted: true }, { permission: 'android.permission.health.READ_SLEEP', granted: false }],
    ...overrides,
  };
}

describe('Health Connect ingest', () => {
  it('rejects an invalid batch with details', async () => {
    const { auth } = await login(app, uniqueEmail('ingest-bad'));
    const res = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: { source: 'health_connect', records: [{ recordType: 'Steps' }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_request');
  });

  it('ingests the synthetic dataset idempotently and dedups across sources', async () => {
    const { auth } = await login(app, uniqueEmail('ingest'));
    const ds = generateDemoDataset({ days: 40, detailedDays: 10, glucoseDays: 5, endDate: yesterday });
    let inserted = 0;
    let cross = 0;
    let rejected = 0;
    for (const batch of ds.batches) {
      const res = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: batch });
      expect(res.statusCode).toBe(200);
      const r = IngestResultSchema.parse(res.json());
      inserted += r.inserted;
      cross += r.crossSourceDuplicates;
      rejected += r.rejected.length;
    }
    expect(rejected).toBe(0);
    expect(inserted).toBe(ds.summary.total_records);
    // Oura + Samsung overlapping sleep sessions and runs were linked as duplicates
    expect(cross).toBeGreaterThanOrEqual((ds.summary.sleep_samsung_overlap ?? 0) + (ds.summary.workouts_oura_overlap ?? 0));

    // Re-sending the same batches is a no-op (idempotent sync)
    const again = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: ds.batches[0] });
    const r2 = IngestResultSchema.parse(again.json());
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(0);
    expect(r2.unchangedDuplicates).toBe(ds.batches[0]!.records.length);

    // A modified record (Health Connect edit) is an update, retaining the previous raw event
    const first = structuredClone(ds.batches[0]!.records.find((r) => r.recordType === 'Weight')!);
    (first.payload as { kg: number }).kg += 0.5;
    first.lastModifiedTime = NOW.toISOString();
    const upd = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: smallBatch({ records: [first] }) });
    expect(IngestResultSchema.parse(upd.json())).toMatchObject({ inserted: 0, updated: 1 });
    const exported = await app.inject({ method: 'GET', url: '/v1/me/export', headers: auth });
    const raws = (exported.json().raw_ingest_events as Array<{ external_id: string; processing_status: string }>).filter((r) => r.external_id === first.hcId);
    expect(raws.map((r) => r.processing_status).sort()).toEqual(['NORMALIZED', 'SUPERSEDED']);

    // Today dashboard validates against the contract and reports real freshness
    const today = await app.inject({ method: 'GET', url: '/v1/dashboard/today', headers: auth });
    expect(today.statusCode).toBe(200);
    const t = TodayResponseSchema.parse(today.json());
    expect(t.domains.map((d) => d.domain)).toEqual(['recovery', 'cardio', 'strength_body', 'metabolic_nutrition', 'clinical_preventive']);
    const rhr = t.domains[0]!.metrics.find((m) => m.metricId === 'resting_heart_rate')!;
    expect(rhr.latest).not.toBeNull();
    expect(['CURRENT', 'RECENT']).toContain(rhr.freshness.status);
    expect(rhr.comparison?.changeClass).not.toBe('INSUFFICIENT_EVIDENCE');
    const labs = t.domains[4]!.metrics.find((m) => m.metricId === 'lab_result')!;
    expect(labs.freshness.status).toBe('NOT_CONNECTED');
    expect(t.dataQuality.crossSourceDuplicates30d).toBeGreaterThan(0);
    expect(t.dataQuality.implausibleValues30d).toBe(1);

    // Steps are never summed across origins: the daily value equals the single best origin, not the sum
    const steps = t.domains[1]!.metrics.find((m) => m.metricId === 'steps')!;
    const lastDay = steps.sparkline.filter((p) => p.value !== null).at(-1)!;
    const samsungTotal = ds.batches
      .flatMap((b) => b.records)
      .filter((r) => r.recordType === 'Steps' && r.dataOrigin === 'com.sec.android.app.shealth' && r.startTime!.startsWith(lastDay.date))
      .reduce((a, r) => a + (r.payload as { count: number }).count, 0);
    const ouraTotal = ds.batches
      .flatMap((b) => b.records)
      .filter((r) => r.recordType === 'Steps' && r.dataOrigin === 'com.ouraring.oura' && r.startTime!.startsWith(lastDay.date))
      .reduce((a, r) => a + (r.payload as { count: number }).count, 0);
    expect(lastDay.value).toBeLessThan(samsungTotal + ouraTotal);
    expect(lastDay.value).toBeGreaterThan(0);

    // Sources screen
    const sources = await app.inject({ method: 'GET', url: '/v1/sources', headers: auth });
    const s = SourcesResponseSchema.parse(sources.json());
    const hc = s.sources.find((x) => x.connectorId === 'health_connect')!;
    expect(hc.connectionStatus).toBe('CONNECTED');
    expect(hc.observationCount).toBeGreaterThan(1000);
    expect(hc.devices.length).toBeGreaterThan(3);
    expect(hc.availableMetrics).toContain('steps');
    expect(s.sources.find((x) => x.connectorId === 'oura')!.implementationStatus).toBe('NOT_IMPLEMENTED');

    // Series endpoint: daily buckets have nulls for missing days (never zero)
    const series = await app.inject({ method: 'GET', url: `/v1/metrics/resting_heart_rate/series?from=${new Date(NOW.getTime() - 45 * 86_400_000).toISOString()}&to=${NOW.toISOString()}&bucket=raw`, headers: auth });
    const ser = SeriesResponseSchema.parse(series.json());
    expect(ser.points.length).toBeGreaterThan(30);
    expect(ser.daily.some((d) => d.value === null)).toBe(true);

    // Blood pressure summary includes cuff pulse attached from the same-origin heart-rate record
    const bp = await app.inject({ method: 'GET', url: '/v1/blood-pressure/summary?days=30', headers: auth });
    const b = BloodPressureSummarySchema.parse(bp.json());
    expect(b.latest?.pulse).not.toBeNull();
    expect(b.sessions.length).toBeGreaterThan(5);
    expect(b.sessions[0]!.n).toBe(2);
  });

  it('handles deletions, partial permissions and sync reports', async () => {
    const { auth } = await login(app, uniqueEmail('ingest-del'));
    const t = NOW.toISOString();
    const rec = { recordType: 'Weight' as const, hcId: 'w-del-1', dataOrigin: 'com.withings.wiscale2', lastModifiedTime: t, recordingMethod: 'AUTOMATICALLY_RECORDED' as const, time: t, zoneOffset: '-04:00', payload: { kg: 80.5 } };
    const ins = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: smallBatch({ records: [rec] }) });
    expect(IngestResultSchema.parse(ins.json()).inserted).toBe(1);
    const del = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: smallBatch({ deletions: [{ hcId: 'w-del-1' }] }) });
    expect(IngestResultSchema.parse(del.json()).deleted).toBe(1);
    const series = await app.inject({ method: 'GET', url: '/v1/metrics/weight/series?bucket=raw', headers: auth });
    expect(SeriesResponseSchema.parse(series.json()).points).toHaveLength(0);

    const sources = await app.inject({ method: 'GET', url: '/v1/sources', headers: auth });
    const hc = SourcesResponseSchema.parse(sources.json()).sources.find((x) => x.connectorId === 'health_connect')!;
    expect(hc.missingPermissions).toEqual(['android.permission.health.READ_SLEEP']);

    const report = await app.inject({ method: 'POST', url: '/v1/sources/health-connect/sync-report', headers: auth, payload: { deviceInstanceId: 'test-device-00000001', appVersion: '0.1.0-test', attemptedAt: t, status: 'ERROR', sdkStatus: 'SDK_AVAILABLE', grantedPermissions: [], requestedPermissions: ['android.permission.health.READ_STEPS'], backgroundReadGranted: false, historyReadGranted: null, error: 'permissions revoked by user', recordsRead: 0 } });
    expect(report.statusCode).toBe(204);
    const after = SourcesResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/sources', headers: auth })).json()).sources.find((x) => x.connectorId === 'health_connect')!;
    expect(after.connectionStatus).toBe('REVOKED');
    expect(after.lastError).toContain('revoked');
    const today = TodayResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/dashboard/today', headers: auth })).json());
    const steps = today.domains[1]!.metrics.find((m) => m.metricId === 'steps')!;
    expect(['SYNC_ERROR', 'INSUFFICIENT_DATA']).toContain(steps.freshness.status);
  });
});
