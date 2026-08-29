/**
 * Sync semantics: historical import (427 fixture groups, paging), the durable
 * lastupdate cursor (missed-webhook recovery), backfill idempotence, and
 * token rotation (old refresh token never reused; pair persisted atomically;
 * invalid_grant marks the connection error).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptToken } from '../src/crypto.js';
import { adminCount, authHeaders, connectWithings, createHarness, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  await connectWithings(h);
});
afterAll(async () => {
  await h.close();
});

describe('historical import', () => {
  it('imports all 427 fixture groups as readings via paged getmeas', async () => {
    expect(
      await adminCount(
        h,
        `select count(*) as n from blood_pressure_reading where source = 'withings_api'`,
      ),
    ).toBe(427);
    expect(
      await adminCount(h, `select count(*) as n from raw_ingest_event where connector = 'withings'`),
    ).toBe(427);
    // 427 groups at 100/page -> at least 5 pages were fetched.
    expect(h.fake.getMeasuresCalls).toBeGreaterThanOrEqual(5);
  });

  it('never produces a zero pulse (missing values stay null)', async () => {
    expect(
      await adminCount(h, 'select count(*) as n from blood_pressure_reading where pulse_bpm = 0'),
    ).toBe(0);
  });

  it('groups readings into sessions with the fixture cadence (2–3 readings)', async () => {
    const sessions = await adminCount(h, 'select count(*) as n from bp_session');
    expect(sessions).toBe(170); // fixture: 170 sessions
    const orphans = await adminCount(
      h,
      `select count(*) as n from blood_pressure_reading
        where canonical and deleted_at is null and session_id is null`,
    );
    expect(orphans).toBe(0);
  });
});

describe('durable lastupdate cursor', () => {
  it('manual refresh establishes the cursor from the response updatetime', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/refresh',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { imported: number }).imported).toBe(0); // backfill already got everything
    const cursor = await h.admin.query<{ cursor_value: string }>(
      `select cursor_value from sync_cursor where cursor_type = 'withings_lastupdate'`,
    );
    expect(Number(cursor.rows[0]!.cursor_value)).toBe(h.fake.maxVisibleModified());
  });

  it('heals a missed webhook: new data is imported by manual refresh via the cursor', async () => {
    const base = h.fake.maxVisibleModified();
    h.fake.injectGroup({
      grpid: 999901,
      attrib: 0,
      date: base + 3600,
      created: base + 3660,
      modified: base + 3660,
      category: 1,
      deviceid: 'wbp-demo-device-001',
      measures: [
        { value: 133, type: 10, unit: 0 },
        { value: 88, type: 9, unit: 0 },
        { value: 71, type: 11, unit: 0 },
      ],
    });
    // No webhook arrives. A manual refresh must import exactly the gap.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/refresh',
      headers: authHeaders(h.token),
    });
    expect((res.json() as { imported: number }).imported).toBe(1);
    expect(
      await adminCount(
        h,
        `select count(*) as n from blood_pressure_reading where external_group_id = '999901'`,
      ),
    ).toBe(1);
    // Cursor advanced to the new max modified.
    const cursor = await h.admin.query<{ cursor_value: string }>(
      `select cursor_value from sync_cursor where cursor_type = 'withings_lastupdate'`,
    );
    expect(Number(cursor.rows[0]!.cursor_value)).toBe(base + 3660);
  });

  it('backfill after the webhook-era sync is idempotent (no duplicates)', async () => {
    const before = await adminCount(h, 'select count(*) as n from blood_pressure_reading');
    const rawBefore = await adminCount(h, 'select count(*) as n from raw_ingest_event');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/backfill',
      headers: authHeaders(h.token),
      payload: { sinceDays: 400 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { imported: number }).imported).toBe(0);
    expect(await adminCount(h, 'select count(*) as n from blood_pressure_reading')).toBe(before);
    expect(await adminCount(h, 'select count(*) as n from raw_ingest_event')).toBe(rawBefore);
  });
});

describe('token rotation', () => {
  it('rotates on 343, persists the new pair, and never reuses the old refresh token', async () => {
    expect(h.fake.rotationCount).toBe(0);
    h.fake.expireAccessToken();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/refresh',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(200);
    expect(h.fake.rotationCount).toBe(1);
    expect(h.fake.deadRefreshTokens.has('fake-refresh-1')).toBe(true);

    // The rotated pair is what is stored at rest.
    const tokens = await h.admin.query<{ access: Buffer; refresh: Buffer }>(
      'select access_token_enc as access, refresh_token_enc as refresh from oauth_token',
    );
    expect(tokens.rows).toHaveLength(1);
    expect(decryptToken(h.config.tokenEncKey, tokens.rows[0]!.access)).toBe('fake-access-2');
    expect(decryptToken(h.config.tokenEncKey, tokens.rows[0]!.refresh)).toBe('fake-refresh-2');

    // Reusing the rotated-away refresh token is a hard failure at the source.
    await expect(h.fake.refresh('fake-refresh-1')).rejects.toThrow(/invalid_grant/);

    // A second expiry rotates again — the service always uses the CURRENT token.
    h.fake.expireAccessToken();
    const again = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/refresh',
      headers: authHeaders(h.token),
    });
    expect(again.statusCode).toBe(200);
    expect(h.fake.rotationCount).toBe(2);
  });

  it('invalid_grant marks the connection error and surfaces SYNC_ERROR', async () => {
    h.fake.revokeRefreshTokens();
    h.fake.expireAccessToken();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/refresh',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(500);
    const conn = await h.admin.query<{ status: string }>(
      `select status from source_connection where provider = 'withings'`,
    );
    expect(conn.rows[0]!.status).toBe('error');

    const sources = await h.app.inject({
      method: 'GET',
      url: '/api/v1/sources',
      headers: authHeaders(h.token),
    });
    const withings = (
      sources.json() as { sources: Array<{ provider: string; freshness: { status: string } }> }
    ).sources.find((s) => s.provider === 'withings');
    expect(withings?.freshness.status).toBe('SYNC_ERROR');
  });
});
