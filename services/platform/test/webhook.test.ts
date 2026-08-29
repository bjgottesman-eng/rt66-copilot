/**
 * Withings webhook endpoint: HEAD validation, fast 200s, journaled duplicate
 * deliveries processed exactly once, cursor sync triggered by the matching
 * connection, and unknown userids ignored (untrusted body).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FIXTURES_DIR } from '../src/connectors/withings/fake.js';
import { adminCount, connectWithings, createHarness, postWebhook, type Harness } from './helpers.js';

let h: Harness;
let notifications: Array<{ userid: string; appli: number; startdate: number; enddate: number }>;

beforeAll(async () => {
  h = await createHarness();
  await connectWithings(h);
  notifications = (
    JSON.parse(readFileSync(path.join(DEFAULT_FIXTURES_DIR, 'webhook-notifications.json'), 'utf8')) as {
      notifications: typeof notifications;
    }
  ).notifications;
});
afterAll(async () => {
  await h.close();
});

describe('webhooks/withings', () => {
  it('answers callback validation HEAD with 200', async () => {
    const res = await h.app.inject({ method: 'HEAD', url: '/api/v1/webhooks/withings' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a notification, journals it, and triggers the cursor sync', async () => {
    const callsBefore = h.fake.getMeasuresCalls;
    const status = await postWebhook(h, notifications[0]!);
    expect(status).toBe(200);
    expect(await adminCount(h, `select count(*) as n from webhook_delivery`)).toBe(1);
    expect(
      await adminCount(h, `select count(*) as n from webhook_delivery where status = 'accepted'`),
    ).toBe(1);
    // The async sync actually ran against the source…
    expect(h.fake.getMeasuresCalls).toBeGreaterThan(callsBefore);
    // …and established/advanced the durable cursor.
    expect(
      await adminCount(
        h,
        `select count(*) as n from sync_cursor where cursor_type = 'withings_lastupdate'`,
      ),
    ).toBe(1);
    // The notification itself is journaled as an immutable raw event.
    expect(
      await adminCount(
        h,
        `select count(*) as n from raw_ingest_event where event_type = 'withings.notify'`,
      ),
    ).toBe(1);
  });

  it('processes a duplicated delivery exactly once (webhook_delivery unique)', async () => {
    // The fixture file ends with an exact duplicate of the last notification.
    const last = notifications[4]!;
    const dup = notifications[5]!;
    expect(dup).toEqual(last);

    expect(await postWebhook(h, last)).toBe(200);
    const callsAfterFirst = h.fake.getMeasuresCalls;
    const readingsAfterFirst = await adminCount(
      h,
      'select count(*) as n from blood_pressure_reading',
    );

    expect(await postWebhook(h, dup)).toBe(200); // duplicate: still 200, fast
    // Journaled once; not processed a second time.
    const hashes = await h.admin.query<{ delivery_hash: string }>(
      `select delivery_hash from webhook_delivery`,
    );
    expect(hashes.rows.length).toBe(new Set(hashes.rows.map((r) => r.delivery_hash)).size);
    expect(h.fake.getMeasuresCalls).toBe(callsAfterFirst);
    expect(await adminCount(h, 'select count(*) as n from blood_pressure_reading')).toBe(
      readingsAfterFirst,
    );
  });

  it('imports new measurements announced by a webhook', async () => {
    const base = h.fake.maxVisibleModified();
    h.fake.injectGroup({
      grpid: 999902,
      attrib: 0,
      date: base + 60,
      created: base + 90,
      modified: base + 90,
      category: 1,
      deviceid: 'wbp-demo-device-001',
      measures: [
        { value: 126, type: 10, unit: 0 },
        { value: 81, type: 9, unit: 0 },
        { value: 66, type: 11, unit: 0 },
      ],
    });
    expect(
      await postWebhook(h, {
        userid: 'demo-withings-user',
        appli: 4,
        startdate: base + 50,
        enddate: base + 70,
      }),
    ).toBe(200);
    expect(
      await adminCount(
        h,
        `select count(*) as n from blood_pressure_reading where external_group_id = '999902'`,
      ),
    ).toBe(1);
  });

  it('ignores notifications for unknown external users (body is untrusted)', async () => {
    const readingsBefore = await adminCount(h, 'select count(*) as n from blood_pressure_reading');
    const callsBefore = h.fake.getMeasuresCalls;
    expect(
      await postWebhook(h, { userid: 'someone-else', appli: 4, startdate: 1, enddate: 2 }),
    ).toBe(200);
    expect(h.fake.getMeasuresCalls).toBe(callsBefore);
    expect(await adminCount(h, 'select count(*) as n from blood_pressure_reading')).toBe(
      readingsBefore,
    );
  });
});
