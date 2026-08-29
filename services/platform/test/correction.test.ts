/**
 * Corrected Withings measurement: same grpid re-delivered with a newer
 * `modified` → a SECOND raw event row (raws are immutable and both retained),
 * an in-place update of the normalized reading, and a 'bp.corrected' audit
 * entry. Re-delivery WITHOUT newer content is skipped_duplicate.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminCount, authHeaders, connectWithings, createHarness, type Harness } from './helpers.js';

let h: Harness;
const GRPID = '500342'; // the fixture's corrected measurement

beforeAll(async () => {
  h = await createHarness();
  await connectWithings(h);
});
afterAll(async () => {
  await h.close();
});

describe('correction flow', () => {
  it('applies the corrected group on the next sync', async () => {
    // Original import: systolic 119.
    const before = await h.admin.query<{ systolic_mmhg: string }>(
      `select systolic_mmhg from blood_pressure_reading where external_group_id = $1`,
      [GRPID],
    );
    expect(Number(before.rows[0]!.systolic_mmhg)).toBe(119);

    h.fake.applyCorrections();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/refresh',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { imported: number }).imported).toBe(1); // just the correction

    // Reading updated in place (−8 mmHg systolic), still exactly one reading.
    const after = await h.admin.query<{ systolic_mmhg: string; canonical: boolean }>(
      `select systolic_mmhg, canonical from blood_pressure_reading where external_group_id = $1`,
      [GRPID],
    );
    expect(after.rows).toHaveLength(1);
    expect(Number(after.rows[0]!.systolic_mmhg)).toBe(111);
    expect(after.rows[0]!.canonical).toBe(true);

    // Both raw versions retained.
    expect(
      await adminCount(h, `select count(*) as n from raw_ingest_event where external_id = $1`, [
        GRPID,
      ]),
    ).toBe(2);

    // Audit trail (ids only, no BP values).
    const audit = await h.admin.query<{ details: Record<string, string> }>(
      `select details from audit_log where action = 'bp.corrected'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.details.grpid).toBe(GRPID);
    // Pre-redacted details: ids only, never measurement values.
    expect(Object.keys(audit.rows[0]!.details).sort()).toEqual(['grpid', 'rawEventId']);
  });

  it('re-delivery of the same corrected group is idempotent', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/backfill',
      headers: authHeaders(h.token),
      payload: { sinceDays: 120 },
    });
    expect((res.json() as { imported: number }).imported).toBe(0);
    expect(
      await adminCount(h, `select count(*) as n from raw_ingest_event where external_id = $1`, [
        GRPID,
      ]),
    ).toBe(2);
    expect(await adminCount(h, `select count(*) as n from audit_log where action = 'bp.corrected'`)).toBe(1);
  });

  it('an older re-delivery for a known grpid is marked skipped_duplicate', async () => {
    // Simulate an out-of-order re-delivery: same grpid, OLDER modified, and a
    // payload that differs (so the raw unique index does not swallow it).
    const group = {
      grpid: 500342,
      attrib: 1, // differs -> new payload hash
      date: 1786496857,
      created: 1786496888,
      modified: 1786496000, // older than both stored versions
      category: 1,
      deviceid: 'wbp-demo-device-001',
      measures: [
        { value: 119, type: 10, unit: 0 },
        { value: 77, type: 9, unit: 0 },
        { value: 68, type: 11, unit: 0 },
      ],
    };
    await h.ctx.db.withUserTx(h.userId, async (client) => {
      const { ingestWithingsGroups } = await import('../src/ingest/normalize.js');
      const counts = await ingestWithingsGroups(
        client,
        { userId: h.userId, connectionId: null },
        [group],
        'America/New_York',
      );
      expect(counts).toEqual({ inserted: 0, corrected: 0, rawDuplicates: 0, skipped: 1 });
    });
    const states = await h.admin.query<{ processing_state: string }>(
      `select processing_state from raw_ingest_event where external_id = $1 order by received_at`,
      [GRPID],
    );
    expect(states.rows.map((r) => r.processing_state)).toEqual([
      'processed',
      'processed',
      'skipped_duplicate',
    ]);
    // The reading still shows the corrected values.
    const reading = await h.admin.query<{ systolic_mmhg: string }>(
      `select systolic_mmhg from blood_pressure_reading where external_group_id = $1`,
      [GRPID],
    );
    expect(Number(reading.rows[0]!.systolic_mmhg)).toBe(111);
  });
});
