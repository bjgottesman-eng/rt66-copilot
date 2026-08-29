/**
 * Deduplication matrix — the seven build-brief §13 scenarios (contracts §4):
 *
 * 1. direct API + Apple Health duplicate (the fixture's 128 exact mirrors
 *    collapse cross-source, canonical priority withings_api > apple_health);
 * 2. multiple webhook delivery            — test/webhook.test.ts;
 * 3. backfill after webhook               — test/sync.test.ts + here (raws);
 * 4. manual entry equal to a device reading;
 * 5. corrected Withings measurement       — test/correction.test.ts;
 * 6. deleted Apple Health measurement (soft delete only);
 * 7. same-day multiple legitimate readings stay canonical.
 * Plus: canonicality TRANSFER when the higher-priority source arrives later.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { HealthKitBpBatch } from '@benhealth/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FIXTURES_DIR } from '../src/connectors/withings/fake.js';
import { ingestWithingsGroups } from '../src/ingest/normalize.js';
import { adminCount, authHeaders, connectWithings, createHarness, type Harness } from './helpers.js';

let h: Harness;
let appleBatch: HealthKitBpBatch;

beforeAll(async () => {
  h = await createHarness();
  await connectWithings(h); // 427 canonical withings readings
  appleBatch = JSON.parse(
    readFileSync(path.join(DEFAULT_FIXTURES_DIR, 'bp-apple-health.json'), 'utf8'),
  ) as HealthKitBpBatch;
});
afterAll(async () => {
  await h.close();
});

async function ingestApple(batch: HealthKitBpBatch): Promise<{
  accepted: number;
  duplicates: number;
  deleted: number;
}> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/ingest/healthkit',
    headers: authHeaders(h.token),
    payload: batch,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { accepted: number; duplicates: number; deleted: number };
}

describe('scenario 1: direct API + Apple Health duplicates collapse', () => {
  it('marks the 128 fixture mirrors as duplicates of the Withings readings', async () => {
    const result = await ingestApple(appleBatch);
    expect(result.accepted).toBe(137);
    expect(result.duplicates).toBe(128);

    // All 137 samples stored, but only the 9 Qardio-only readings canonical.
    expect(
      await adminCount(
        h,
        `select count(*) as n from blood_pressure_reading where source = 'apple_health'`,
      ),
    ).toBe(137);
    expect(
      await adminCount(
        h,
        `select count(*) as n from blood_pressure_reading
          where source = 'apple_health' and canonical`,
      ),
    ).toBe(9);

    // Every duplicate links its canonical Withings winner with the rule recorded.
    expect(
      await adminCount(
        h,
        `select count(*) as n from blood_pressure_reading d
           join blood_pressure_reading w on w.id = d.duplicate_of
          where d.source = 'apple_health' and not d.canonical
            and w.source = 'withings_api' and w.canonical
            and d.dedup_reason = 'cross_source_within_tolerance'`,
      ),
    ).toBe(128);

    // Dedup decisions are audited.
    expect(
      await adminCount(h, `select count(*) as n from audit_log where action = 'bp.dedup.duplicate'`),
    ).toBe(128);

    // The three null-pulse Qardio samples stay null — never zero.
    expect(
      await adminCount(
        h,
        `select count(*) as n from blood_pressure_reading
          where source = 'apple_health' and pulse_bpm is null and deleted_at is null`,
      ),
    ).toBe(3);
    expect(
      await adminCount(h, `select count(*) as n from blood_pressure_reading where pulse_bpm = 0`),
    ).toBe(0);
  });

  it('re-sending the same batch is idempotent', async () => {
    const before = await adminCount(h, 'select count(*) as n from blood_pressure_reading');
    const result = await ingestApple(appleBatch);
    expect(result.accepted).toBe(0);
    expect(result.duplicates).toBe(137); // all raw-level duplicates now
    expect(await adminCount(h, 'select count(*) as n from blood_pressure_reading')).toBe(before);
  });

  it('skips our own HealthKit write-backs (syncIdentifier benhealthos.*)', async () => {
    const writeBack: HealthKitBpBatch = {
      samples: [
        {
          hkUuid: '00000000-0000-4000-8000-00000000dead',
          measuredAt: '2026-08-20T12:00:00Z',
          systolic: 121,
          diastolic: 79,
          pulse: 61,
          sourceApp: 'Ben Health OS',
          sourceDevice: 'iPhone',
          sourceBundleId: 'com.benhealth.ios',
          syncIdentifier: 'benhealthos.manual.abc123',
        },
      ],
    };
    const result = await ingestApple(writeBack);
    expect(result.accepted).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(
      await adminCount(
        h,
        `select count(*) as n from blood_pressure_reading where external_group_id like '%dead'`,
      ),
    ).toBe(0);
  });
});

describe('scenario 4: manual entry equal to a device reading', () => {
  it('records the manual entry as a linked duplicate of the Withings reading', async () => {
    const manual = (
      JSON.parse(readFileSync(path.join(DEFAULT_FIXTURES_DIR, 'bp-manual.json'), 'utf8')) as {
        entries: Array<Record<string, unknown>>;
      }
    ).entries;
    // Fixture entry 0 exactly matches a Withings reading's time and values.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/bp/manual',
      headers: authHeaders(h.token),
      payload: manual[0],
    });
    expect(res.statusCode).toBe(201);
    const { reading } = res.json() as {
      reading: { id: string; canonical: boolean; duplicateOf: string | null };
    };
    expect(reading.canonical).toBe(false);
    expect(reading.duplicateOf).not.toBeNull();
    const winner = await h.admin.query<{ source: string; canonical: boolean }>(
      'select source, canonical from blood_pressure_reading where id = $1',
      [reading.duplicateOf],
    );
    expect(winner.rows[0]).toEqual({ source: 'withings_api', canonical: true });

    // Both rows retained; the duplicate is excluded from canonical queries.
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/readings?from=2026-07-20T01:00:00Z&to=2026-07-20T02:00:00Z',
      headers: authHeaders(h.token),
    });
    const readings = (list.json() as { readings: Array<{ id: string }> }).readings;
    expect(readings.some((r) => r.id === reading.id)).toBe(false);
    const withDups = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/readings?from=2026-07-20T01:00:00Z&to=2026-07-20T02:00:00Z&includeDuplicates=true',
      headers: authHeaders(h.token),
    });
    expect(
      (withDups.json() as { readings: Array<{ id: string }> }).readings.some(
        (r) => r.id === reading.id,
      ),
    ).toBe(true);
  });

  it('a distinct manual entry stays canonical', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/bp/manual',
      headers: authHeaders(h.token),
      payload: {
        systolic: 118,
        diastolic: 76,
        pulse: null,
        measuredAt: '2026-08-25T02:11:00Z',
        measuredTz: 'America/New_York',
        note: 'pharmacy reading',
      },
    });
    expect(res.statusCode).toBe(201);
    const { reading } = res.json() as { reading: { canonical: boolean; pulse: number | null } };
    expect(reading.canonical).toBe(true);
    expect(reading.pulse).toBeNull(); // absent pulse survives end-to-end
  });
});

describe('scenario 6: deleted Apple Health measurement', () => {
  it('soft-deletes the reading and keeps every raw event', async () => {
    // A canonical Qardio-only sample (not a mirror).
    const qardio = appleBatch.samples.find((s) => s.sourceApp === 'Qardio' && s.pulse !== null)!;
    const rawBefore = await adminCount(h, 'select count(*) as n from raw_ingest_event');

    const result = await ingestApple({ samples: [], deletedHkUuids: [qardio.hkUuid] });
    expect(result.deleted).toBe(1);

    const row = await h.admin.query<{ deleted_at: Date | null; session_id: string | null }>(
      `select deleted_at, session_id from blood_pressure_reading where external_group_id = $1`,
      [qardio.hkUuid],
    );
    expect(row.rows[0]!.deleted_at).not.toBeNull();
    expect(row.rows[0]!.session_id).toBeNull(); // left its session on recompute

    // Raw events are immutable: nothing removed, a deletion event added.
    expect(await adminCount(h, 'select count(*) as n from raw_ingest_event')).toBe(rawBefore + 1);
    expect(
      await adminCount(
        h,
        `select count(*) as n from audit_log where action = 'bp.deleted' and entity_id is not null`,
      ),
    ).toBe(1);

    // Idempotent: deleting again touches nothing.
    const again = await ingestApple({ samples: [], deletedHkUuids: [qardio.hkUuid] });
    expect(again.deleted).toBe(0);
  });
});

describe('scenario 7: same-day multiple legitimate readings stay canonical', () => {
  it('keeps distinct readings of a session canonical and separately stored', async () => {
    // The fixture's sessions have 2–3 readings 60–120 s apart with differing
    // values: within the 180 s cross-source window but NOT equal -> no dedup.
    const sessions = await h.app.inject({
      method: 'GET',
      url: '/api/v1/bp/sessions?from=2026-08-20T00:00:00Z&to=2026-08-29T00:00:00Z',
      headers: authHeaders(h.token),
    });
    const list = (
      sessions.json() as {
        sessions: Array<{ readingCount: number; readings: Array<{ canonical: boolean }> }>;
      }
    ).sessions;
    expect(list.length).toBeGreaterThan(0);
    const multi = list.filter((s) => s.readingCount >= 2);
    expect(multi.length).toBeGreaterThan(0);
    for (const s of multi) {
      expect(s.readings).toHaveLength(s.readingCount);
      for (const r of s.readings) expect(r.canonical).toBe(true);
    }
    // And a triple-reading session uses mean_excluding_first.
    const triple = (
      sessions.json() as { sessions: Array<{ readingCount: number; averagingMethod: string; firstReadingExcluded: boolean }> }
    ).sessions.find((s) => s.readingCount >= 3);
    expect(triple).toBeDefined();
    expect(triple!.averagingMethod).toBe('mean_excluding_first');
    expect(triple!.firstReadingExcluded).toBe(true);
  });
});

describe('canonicality transfer (higher-priority source arrives later)', () => {
  it('promotes a late Withings reading over an existing Apple Health one', async () => {
    // A NEW measurement seen by Apple Health first…
    const measuredAt = '2026-08-28T22:10:00Z';
    const hkUuid = '11111111-2222-4333-8444-555566667777';
    await ingestApple({
      samples: [
        {
          hkUuid,
          measuredAt,
          systolic: 127,
          diastolic: 83,
          pulse: 67,
          sourceApp: 'Health Mate',
          sourceDevice: 'BPM Connect',
          sourceBundleId: 'com.withings.wiScaleNG',
        },
      ],
    });
    const ah = await h.admin.query<{ id: string; canonical: boolean }>(
      `select id, canonical from blood_pressure_reading where external_group_id = $1`,
      [hkUuid],
    );
    expect(ah.rows[0]!.canonical).toBe(true);

    // …then the Withings API delivers the same measurement 30 s apart.
    const date = Math.floor(Date.parse(measuredAt) / 1000) + 30;
    await h.ctx.db.withUserTx(h.userId, (client) =>
      ingestWithingsGroups(
        client,
        { userId: h.userId, connectionId: null },
        [
          {
            grpid: 999903,
            attrib: 0,
            date,
            created: date + 20,
            modified: date + 20,
            category: 1,
            deviceid: 'wbp-demo-device-001',
            measures: [
              { value: 127, type: 10, unit: 0 },
              { value: 83, type: 9, unit: 0 },
              { value: 66, type: 11, unit: 0 }, // |Δ pulse| = 1 ≤ 5
            ],
          },
        ],
        'America/New_York',
      ),
    );

    const after = await h.admin.query<{ source: string; canonical: boolean; duplicate_of: string | null; dedup_reason: string | null }>(
      `select source, canonical, duplicate_of, dedup_reason from blood_pressure_reading
        where external_group_id in ($1, '999903') order by source`,
      [hkUuid],
    );
    const apple = after.rows.find((r) => r.source === 'apple_health')!;
    const withings = after.rows.find((r) => r.source === 'withings_api')!;
    expect(withings.canonical).toBe(true); // promoted
    expect(apple.canonical).toBe(false); // demoted
    expect(apple.dedup_reason).toBe('cross_source_within_tolerance');
    const winnerId = await h.admin.query<{ id: string }>(
      `select id from blood_pressure_reading where external_group_id = '999903'`,
    );
    expect(apple.duplicate_of).toBe(winnerId.rows[0]!.id);

    // The transfer is audited.
    expect(
      await adminCount(
        h,
        `select count(*) as n from audit_log where action = 'bp.dedup.canonical_transferred'`,
      ),
    ).toBe(1);
  });
});
