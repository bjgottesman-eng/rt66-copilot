import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { IngestResultSchema, SourcesResponseSchema, BloodPressureSummarySchema, SeriesResponseSchema } from '@bho/contracts';
import { buildApp } from '../src/app.js';
import { login, TEST_DATABASE_URL, uniqueEmail } from './helpers.js';
import { startMockProviders, type MockState } from './mock-providers.js';

let app: FastifyInstance;
let mock: MockState;
let pool: pg.Pool;
const ENC_KEY = Buffer.alloc(32, 7).toString('base64');

beforeAll(async () => {
  mock = await startMockProviders();
  pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  app = await buildApp({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret',
    PUBLIC_BASE_URL: 'https://api.example.test',
    WEB_BASE_URL: 'https://web.example.test',
    TOKEN_ENCRYPTION_KEY: ENC_KEY,
    OURA_CLIENT_ID: 'oura-client',
    OURA_CLIENT_SECRET: 'oura-secret',
    OURA_API_BASE: mock.base,
    OURA_AUTH_BASE: mock.base,
    OURA_WEBHOOK_VERIFICATION_TOKEN: 'verify-me',
    OURA_HISTORY_DAYS: '14',
    WITHINGS_CLIENT_ID: 'withings-client',
    WITHINGS_CLIENT_SECRET: 'withings-secret',
    WITHINGS_API_BASE: mock.base,
    WITHINGS_ACCOUNT_BASE: mock.base,
    JOB_SECRET: 'job-secret',
  });
});
afterAll(async () => {
  await app.close();
  await pool.end();
  await mock.close();
});

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('Oura connector', () => {
  let auth: { authorization: string };
  let userId: string;

  it('OAuth start → callback imports history, stores encrypted tokens and shows CONNECTED', async () => {
    const l = await login(app, uniqueEmail('oura'));
    auth = l.auth;
    userId = l.userId;
    const start = await app.inject({ method: 'GET', url: '/v1/oauth/oura/start?client=web', headers: auth });
    expect(start.statusCode).toBe(200);
    const url = new URL(start.json().url);
    expect(url.origin + url.pathname).toBe(`${mock.base}/oauth/authorize`);
    const state = url.searchParams.get('state')!;
    const challenge = url.searchParams.get('code_challenge')!;

    const cb = await app.inject({ method: 'GET', url: `/v1/oauth/oura/callback?code=good&state=${state}` });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('https://web.example.test/sources?connected=oura');
    // PKCE verifier sent to the token endpoint matches the challenge we were shown
    const tokenReq = mock.requests.find((r) => r.url === '/oauth/token')!;
    const verifier = new URLSearchParams(tokenReq.body).get('code_verifier')!;
    expect(b64url(createHash('sha256').update(verifier).digest())).toBe(challenge);
    // state is single-use
    expect((await app.inject({ method: 'GET', url: `/v1/oauth/oura/callback?code=good&state=${state}` })).statusCode).toBe(302);
    expect((await app.inject({ method: 'GET', url: `/v1/oauth/oura/callback?code=good&state=${state}` })).headers.location).toContain('error=');

    const row = await pool.query<{ status: string; external_user_id: string; access_token_ciphertext: Buffer }>('select status, external_user_id, access_token_ciphertext from public.source_connections where user_id = $1 and connector = $2', [userId, 'oura']);
    expect(row.rows[0]!.status).toBe('CONNECTED');
    expect(row.rows[0]!.external_user_id).toBe('oura-user-1');
    expect(row.rows[0]!.access_token_ciphertext.toString('utf8')).not.toContain('oura-access');

    const sources = SourcesResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/sources', headers: auth })).json());
    const oura = sources.sources.find((s) => s.connectorId === 'oura')!;
    expect(oura.connectionStatus).toBe('CONNECTED');
    expect(oura.implementationStatus).not.toBe('BLOCKED_BY_CREDENTIALS');
    expect(oura.observationCount).toBeGreaterThan(10);
    expect(oura.actions).toContain('reconnect');
    expect(oura.actions).toContain('refresh');
    expect(mock.oura.subscriptions.length).toBeGreaterThan(0);

    const series = SeriesResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/metrics/readiness_score/series?from=2026-10-01T00:00:00Z&to=2026-10-12T00:00:00Z&bucket=raw', headers: auth })).json());
    expect(series.points).toHaveLength(1);
    expect(series.points[0]!.value).toBe(79);
    const sleep = SeriesResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/metrics/sleep_duration/series?from=2026-10-01T00:00:00Z&to=2026-10-12T00:00:00Z&bucket=raw', headers: auth })).json());
    expect(sleep.points.map((p) => p.value).sort()).toEqual([410, 430]); // naps carry no nightly metrics
  });

  it('refuses unconfigured connectors elsewhere and reports BLOCKED BY CREDENTIALS', async () => {
    const other = await buildApp({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_MODE: 'local', LOG_LEVEL: 'silent', LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret' });
    try {
      const l = await login(other, uniqueEmail('nocreds'));
      const start = await other.inject({ method: 'GET', url: '/v1/oauth/oura/start', headers: l.auth });
      expect(start.statusCode).toBe(503);
      expect(start.json().message).toContain('BLOCKED BY CREDENTIALS');
      const sources = SourcesResponseSchema.parse((await other.inject({ method: 'GET', url: '/v1/sources', headers: l.auth })).json());
      expect(sources.sources.find((s) => s.connectorId === 'oura')!.implementationStatus).toBe('BLOCKED_BY_CREDENTIALS');
      expect(sources.sources.find((s) => s.connectorId === 'oura')!.actions).not.toContain('connect');
    } finally {
      await other.close();
    }
  });

  it('webhook: verification handshake, signature checks, replay-safe processing and deletes', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/webhooks/oura?verification_token=wrong&challenge=abc' })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/v1/webhooks/oura?verification_token=verify-me&challenge=abc' });
    expect(ok.json()).toEqual({ challenge: 'abc' });

    mock.oura.docs.sleep!.push({ id: 'sl-3', day: '2026-10-12', type: 'long_sleep', bedtime_start: '2026-10-11T23:00:00-04:00', bedtime_end: '2026-10-12T06:30:00-04:00', total_sleep_duration: 25200, time_in_bed: 27000, efficiency: 93, average_hrv: 48, lowest_heart_rate: 49, average_breath: 14.0, sleep_phase_5_min: '42221133' });
    const event = JSON.stringify({ event_type: 'create', data_type: 'sleep', object_id: 'sl-3', event_time: '2026-10-12T11:00:00+00:00', user_id: 'oura-user-1' });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', 'oura-secret').update(ts + event).digest('hex').toUpperCase();
    const bad = await app.inject({ method: 'POST', url: '/v1/webhooks/oura', headers: { 'content-type': 'application/json', 'x-oura-timestamp': ts, 'x-oura-signature': 'DEADBEEF' }, payload: event });
    expect(bad.statusCode).toBe(401);
    const first = await app.inject({ method: 'POST', url: '/v1/webhooks/oura', headers: { 'content-type': 'application/json', 'x-oura-timestamp': ts, 'x-oura-signature': sig }, payload: event });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('processed');
    const again = await app.inject({ method: 'POST', url: '/v1/webhooks/oura', headers: { 'content-type': 'application/json', 'x-oura-timestamp': ts, 'x-oura-signature': sig }, payload: event });
    expect(again.json().status).toBe('duplicate');
    const sleep = SeriesResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/metrics/sleep_duration/series?from=2026-10-01T00:00:00Z&to=2026-10-13T00:00:00Z&bucket=raw', headers: auth })).json());
    expect(sleep.points).toHaveLength(3);

    const del = JSON.stringify({ event_type: 'delete', data_type: 'sleep', object_id: 'sl-3', event_time: '2026-10-12T12:00:00+00:00', user_id: 'oura-user-1' });
    const delSig = createHmac('sha256', 'oura-secret').update(ts + del).digest('hex').toUpperCase();
    expect((await app.inject({ method: 'POST', url: '/v1/webhooks/oura', headers: { 'content-type': 'application/json', 'x-oura-timestamp': ts, 'x-oura-signature': delSig }, payload: del })).statusCode).toBe(200);
    const after = SeriesResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/metrics/sleep_duration/series?from=2026-10-01T00:00:00Z&to=2026-10-13T00:00:00Z&bucket=raw', headers: auth })).json());
    expect(after.points).toHaveLength(2);

    const unknown = JSON.stringify({ event_type: 'create', data_type: 'sleep', object_id: 'sl-1', event_time: 'x', user_id: 'someone-else' });
    const unknownSig = createHmac('sha256', 'oura-secret').update(ts + unknown).digest('hex').toUpperCase();
    expect((await app.inject({ method: 'POST', url: '/v1/webhooks/oura', headers: { 'content-type': 'application/json', 'x-oura-timestamp': ts, 'x-oura-signature': unknownSig }, payload: unknown })).json().status).toBe('ignored');
  });

  it('refresh endpoint rotates an expiring token (single-use refresh) and re-imports idempotently', async () => {
    await pool.query(`update public.source_connections set token_expires_at = now() - interval '1 minute' where user_id = $1 and connector = 'oura'`, [userId]);
    const before = mock.oura.refreshCount;
    const res = await app.inject({ method: 'POST', url: '/v1/sources/oura/refresh', headers: auth });
    expect(res.statusCode).toBe(200);
    const r = IngestResultSchema.parse(res.json());
    expect(mock.oura.refreshCount).toBe(before + 1);
    expect(r.inserted).toBe(0);
    expect(r.unchangedDuplicates).toBeGreaterThan(0);
    const exported = await app.inject({ method: 'GET', url: '/v1/me/export', headers: auth });
    expect(exported.json().audit_log.map((e: { action: string }) => e.action)).toContain('TOKEN_REFRESH');
    expect(exported.json().source_connections[0].access_token_ciphertext).toBeUndefined();
  });
});

describe('Withings connector', () => {
  let auth: { authorization: string };
  let userId: string;

  it('connects, imports BP history with pulse and device, and dedups a Health Connect copy', async () => {
    const l = await login(app, uniqueEmail('withings'));
    auth = l.auth;
    userId = l.userId;
    const start = await app.inject({ method: 'GET', url: '/v1/oauth/withings/start?client=android', headers: auth });
    const url = new URL(start.json().url);
    expect(url.pathname).toBe('/oauth2_user/authorize2');
    expect(url.searchParams.get('scope')).toBe('user.info,user.metrics,user.activity');
    const cb = await app.inject({ method: 'GET', url: `/v1/oauth/withings/callback?code=good&state=${url.searchParams.get('state')}` });
    expect(cb.statusCode).toBe(200);
    expect(cb.headers['content-type']).toContain('text/html');
    expect(cb.body).toContain('Withings connected');
    expect(mock.withings.subscribeCalls).toBe(2);

    const summary = BloodPressureSummarySchema.parse((await app.inject({ method: 'GET', url: '/v1/blood-pressure/summary?days=365', headers: auth })).json());
    expect(summary.readings.length).toBe(2);
    expect(summary.latest!.pulse).toBe(59);
    expect(summary.latest!.deviceLabel).toBe('Withings BPM Connect');
    expect(summary.sessions[0]!.n).toBe(2);
    const weight = SeriesResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/metrics/weight/series?from=2026-10-01T00:00:00Z&to=2026-10-13T00:00:00Z&bucket=raw', headers: auth })).json());
    expect(weight.points[0]!.value).toBeCloseTo(81.2);

    // The Withings app also exported the same reading to Health Connect → one canonical reading.
    const hc = { recordType: 'BloodPressure', hcId: 'hc-bp-copy', dataOrigin: 'com.withings.wiscale2', lastModifiedTime: '2026-10-12T09:05:00Z', recordingMethod: 'AUTOMATICALLY_RECORDED', time: new Date(1791795690 * 1000 + 20_000).toISOString(), zoneOffset: '-04:00', payload: { systolicMmHg: 119, diastolicMmHg: 77 } };
    const ing = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: { source: 'health_connect', deviceInstanceId: 'phone-000000001', appVersion: 't', timeZone: 'America/New_York', clientTime: new Date().toISOString(), mode: 'CHANGES', records: [hc], deletions: [] } });
    expect(IngestResultSchema.parse(ing.json()).crossSourceDuplicates).toBe(1);
    const after = BloodPressureSummarySchema.parse((await app.inject({ method: 'GET', url: '/v1/blood-pressure/summary?days=365', headers: auth })).json());
    expect(after.readings.filter((r) => r.canonical)).toHaveLength(2);
    expect(after.readings.find((r) => r.connector === 'health_connect')!.canonical).toBe(false);
    expect(after.avg30d!.n + (after.readings.length - after.readings.filter((r) => r.canonical).length)).toBe(3);
  });

  it('notification callback: HEAD validation, incremental fetch, duplicate delivery', async () => {
    expect((await app.inject({ method: 'HEAD', url: '/v1/webhooks/withings' })).statusCode).toBe(200);
    mock.withings.groups.push({ grpid: 1004, attrib: 5, date: 1791882000, created: 1791882100, modified: 1791882100, category: 1, deviceid: 'dev-1', hash_deviceid: 'hash-1', model: 'BPM Connect', measures: [{ value: 117, type: 10, unit: 0 }, { value: 76, type: 9, unit: 0 }, { value: 58, type: 11, unit: 0 }] });
    const form = 'userid=777&appli=4&startdate=1791882000&enddate=1791882100';
    const first = await app.inject({ method: 'POST', url: '/v1/webhooks/withings', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: form });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('processed');
    expect((await app.inject({ method: 'POST', url: '/v1/webhooks/withings', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: form })).json().status).toBe('duplicate');
    const summary = BloodPressureSummarySchema.parse((await app.inject({ method: 'GET', url: '/v1/blood-pressure/summary?days=365', headers: auth })).json());
    expect(summary.readings.filter((r) => r.connector === 'withings')).toHaveLength(3);
    expect((await app.inject({ method: 'POST', url: '/v1/webhooks/withings', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'userid=999&appli=4&startdate=1&enddate=2' })).json().status).toBe('ignored');
  });

  it('incremental reconcile uses lastupdate; expired tokens rotate; disconnect clears tokens', async () => {
    const before = mock.requests.length;
    const res = await app.inject({ method: 'POST', url: '/v1/sources/withings/refresh', headers: auth });
    expect(res.statusCode).toBe(200);
    const meas = mock.requests.slice(before).find((r) => r.url === '/measure')!;
    expect(new URLSearchParams(meas.body).get('lastupdate')).toBe('1791800000');
    await pool.query(`update public.source_connections set token_expires_at = now() where user_id = $1 and connector = 'withings'`, [userId]);
    const rc = mock.withings.refreshCount;
    expect((await app.inject({ method: 'POST', url: '/v1/sources/withings/refresh', headers: auth })).statusCode).toBe(200);
    expect(mock.withings.refreshCount).toBe(rc + 1);
    expect((await app.inject({ method: 'POST', url: '/v1/sources/withings/disconnect', headers: auth })).statusCode).toBe(204);
    const row = await pool.query<{ status: string; access_token_ciphertext: Buffer | null }>('select status, access_token_ciphertext from public.source_connections where user_id = $1 and connector = $2', [userId, 'withings']);
    expect(row.rows[0]).toEqual({ status: 'DISCONNECTED', access_token_ciphertext: null });
    expect((await app.inject({ method: 'POST', url: '/v1/sources/withings/refresh', headers: auth })).statusCode).toBe(409);
  });
});

describe('reconcile job', () => {
  it('requires the job secret and reconciles every connected account', async () => {
    expect((await app.inject({ method: 'POST', url: '/internal/jobs/reconcile' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/internal/jobs/reconcile', headers: { 'x-job-secret': 'job-secret' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBeGreaterThanOrEqual(1);
    expect(res.json().failed).toBe(0);
  });
});
