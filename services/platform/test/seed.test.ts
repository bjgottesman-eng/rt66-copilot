/**
 * Demo seeding (contracts §7): POST /demo/seed wipes + reseeds the demo
 * user's data from fixtures through the real pipeline, and is repeatable.
 * Expected numbers derive from the fixture invariants (see
 * fixtures/demo-persona/README.md): 427 Withings groups, 1 correction,
 * 137 Apple Health samples (128 mirrors), 4 manual entries (1 device dup),
 * 170 Withings sessions + 9 Qardio + 3 canonical manual = 182 sessions.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminCount, authHeaders, createHarness, type Harness } from './helpers.js';

let h: Harness;

const EXPECTED_COUNTS = {
  withingsImported: 427,
  withingsCorrected: 1,
  appleAccepted: 137,
  appleDuplicates: 128,
  manualEntries: 4,
  rawEvents: 569, // 427 groups + 1 correction + 137 samples + 4 manual
  readings: 568, // 427 + 137 + 4
  canonicalReadings: 439, // 427 withings + 9 Qardio + 3 manual
  duplicateReadings: 129, // 128 mirrors + 1 manual device dup
  sessions: 182,
};

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('POST /demo/seed', () => {
  it('requires authentication', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/demo/seed' });
    expect(res.statusCode).toBe(401);
  });

  it('seeds the full demo persona through the real pipeline', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/demo/seed',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { seeded: boolean; counts: typeof EXPECTED_COUNTS };
    expect(body.seeded).toBe(true);
    expect(body.counts).toEqual(EXPECTED_COUNTS);

    // The corrected measurement is live (−8 mmHg systolic on grpid 500342).
    const corrected = await h.admin.query<{ systolic_mmhg: string }>(
      `select systolic_mmhg from blood_pressure_reading where external_group_id = '500342'`,
    );
    expect(Number(corrected.rows[0]!.systolic_mmhg)).toBe(111);

    // Tokens are stored (encrypted) and the appli=4 subscription is in place.
    expect(await adminCount(h, 'select count(*) as n from oauth_token')).toBe(1);
    expect(h.fake.subscriptions).toEqual([
      { callbackUrl: h.config.withings.webhookUrl, appli: 4 },
    ]);
  });

  it('reseeding wipes and reproduces the exact same state (idempotent outcome)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/demo/seed',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { counts: unknown }).counts).toEqual(EXPECTED_COUNTS);

    // No data accretion across reseeds.
    expect(await adminCount(h, 'select count(*) as n from blood_pressure_reading')).toBe(
      EXPECTED_COUNTS.readings,
    );
    expect(await adminCount(h, 'select count(*) as n from raw_ingest_event')).toBe(
      EXPECTED_COUNTS.rawEvents,
    );
    expect(await adminCount(h, 'select count(*) as n from bp_session')).toBe(
      EXPECTED_COUNTS.sessions,
    );

    // The user can still log in afterwards (identity + password preserved).
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: h.config.bootstrapUserEmail, password: 'demo-password' },
    });
    expect(login.statusCode).toBe(200);

    // And the existing JWT still works (same deterministic user id).
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: authHeaders(h.token),
    });
    expect(me.statusCode).toBe(200);
  });
});
