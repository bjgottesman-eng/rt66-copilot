/**
 * Integration tests against the real local PostgreSQL 16 cluster
 * (DATABASE_ADMIN_URL, default postgres://postgres@127.0.0.1:55432/postgres).
 *
 * Covers the Phase 1 testing floor for packages/db:
 *  (a) clean-DB migration run succeeds; re-run is a no-op
 *  (b) RLS isolation between users through the benhealth_app role
 *  (c) raw_ingest_event dedup uniqueness incl. NULL external_id
 *  (d) FORCE RLS: admin-created rows invisible to an unscoped app connection
 */

import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { MIGRATIONS_DIR, createTestDatabase, runMigrations, type TestDatabase } from '../src/index.js';

const { Client } = pg;

let db: TestDatabase;
let admin: pg.Client;
let userA: string;
let userB: string;

async function connect(url: string): Promise<pg.Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Runs fn inside a transaction scoped to `userId` via app.user_id. */
async function asUser<T>(
  client: pg.Client,
  userId: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  }
}

function pgErrorCode(err: unknown): string | undefined {
  return err !== null && typeof err === 'object' && 'code' in err
    ? String((err as { code?: unknown }).code)
    : undefined;
}

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await connect(db.adminUrl);
  const users = await admin.query<{ id: string }>(
    `insert into app_user (email) values ('a@test.local'), ('b@test.local') returning id`,
  );
  userA = users.rows[0]!.id;
  userB = users.rows[1]!.id;
});

afterAll(async () => {
  await admin?.end();
  await db?.drop();
});

describe('(a) migrations', () => {
  it('applied every migration file into the clean database', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThanOrEqual(5);
    const rows = await admin.query<{ version: string }>(
      'select version from schema_migrations order by version',
    );
    expect(rows.rows.map((r) => r.version)).toEqual(files.map((f) => f.replace(/\.sql$/, '')));
  });

  it('re-running the runner is a no-op', async () => {
    const before = await admin.query('select count(*)::int as n from schema_migrations');
    const result = await runMigrations(db.adminUrl);
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBe(before.rows[0].n);
    const after = await admin.query('select count(*)::int as n from schema_migrations');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('bootstrapped the benhealth_app role without BYPASSRLS or superuser', async () => {
    const role = await admin.query(
      `select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'benhealth_app'`,
    );
    expect(role.rowCount).toBe(1);
    expect(role.rows[0]).toEqual({ rolcanlogin: true, rolsuper: false, rolbypassrls: false });
  });
});

describe('(b) RLS isolation through the app role', () => {
  it('lets user A insert and read only their own BP rows', async () => {
    const app = await connect(db.appUrl);
    try {
      // Admin plants a row for user B that must stay invisible to A.
      await admin.query(
        `insert into blood_pressure_reading (user_id, measured_at, systolic_mmhg, diastolic_mmhg, source)
         values ($1, '2026-08-01T08:00:00Z', 118, 76, 'withings_api')`,
        [userB],
      );

      await asUser(app, userA, async (c) => {
        await c.query(
          `insert into blood_pressure_reading (user_id, measured_at, systolic_mmhg, diastolic_mmhg, pulse_bpm, source)
           values ($1, '2026-08-01T08:05:00Z', 121, 79, 62, 'manual')`,
          [userA],
        );
      });

      const visible = await asUser(app, userA, (c) =>
        c.query<{ user_id: string; systolic_mmhg: string }>(
          'select user_id, systolic_mmhg from blood_pressure_reading order by measured_at',
        ),
      );
      expect(visible.rowCount).toBe(1);
      expect(visible.rows[0]!.user_id).toBe(userA);
      expect(Number(visible.rows[0]!.systolic_mmhg)).toBe(121);

      // ...while the admin sees both rows.
      const all = await admin.query('select count(*)::int as n from blood_pressure_reading');
      expect(all.rows[0].n).toBe(2);
    } finally {
      await app.end();
    }
  });

  it("rejects inserting a row for another user's user_id", async () => {
    const app = await connect(db.appUrl);
    try {
      let code: string | undefined;
      try {
        await asUser(app, userA, (c) =>
          c.query(
            `insert into blood_pressure_reading (user_id, measured_at, systolic_mmhg, diastolic_mmhg, source)
             values ($1, '2026-08-01T09:00:00Z', 130, 85, 'manual')`,
            [userB],
          ),
        );
      } catch (err) {
        code = pgErrorCode(err);
      }
      // 42501: new row violates row-level security policy
      expect(code).toBe('42501');
    } finally {
      await app.end();
    }
  });

  it("hides user A's connections/raw events from user B", async () => {
    await admin.query(
      `insert into source_connection (user_id, provider, status) values ($1, 'withings', 'connected')`,
      [userA],
    );
    const app = await connect(db.appUrl);
    try {
      const asB = await asUser(app, userB, (c) =>
        c.query('select count(*)::int as n from source_connection'),
      );
      expect(asB.rows[0].n).toBe(0);
      const asA = await asUser(app, userA, (c) =>
        c.query('select count(*)::int as n from source_connection'),
      );
      expect(asA.rows[0].n).toBe(1);
    } finally {
      await app.end();
    }
  });
});

describe('(c) raw_ingest_event dedup uniqueness', () => {
  function insertRaw(externalId: string | null, payloadHash: string) {
    return admin.query(
      `insert into raw_ingest_event (user_id, connector, external_id, event_type, payload, payload_hash, parser_version)
       values ($1, 'withings', $2, 'withings.getmeas.group', '{}'::jsonb, $3, 1)`,
      [userA, externalId, payloadHash],
    );
  }

  it('enforces unique(connector, external_id, payload_hash)', async () => {
    await insertRaw('grp-1', 'hash-a');
    let code: string | undefined;
    try {
      await insertRaw('grp-1', 'hash-a');
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe('23505');
  });

  it('tolerates the same external_id with a different payload_hash (corrected measurement)', async () => {
    await expect(insertRaw('grp-1', 'hash-b')).resolves.toBeDefined();
  });

  it('treats NULL external_id rows with identical hashes as duplicates', async () => {
    await insertRaw(null, 'hash-n1');
    let code: string | undefined;
    try {
      await insertRaw(null, 'hash-n1');
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe('23505');
    // ...but a different payload under NULL external_id is a new event.
    await expect(insertRaw(null, 'hash-n2')).resolves.toBeDefined();
  });
});

describe('(d) FORCE row level security', () => {
  it('shows zero rows to the app role when app.user_id is not set', async () => {
    const app = await connect(db.appUrl);
    try {
      for (const table of [
        'app_user',
        'source_connection',
        'raw_ingest_event',
        'blood_pressure_reading',
      ]) {
        const res = await app.query(`select count(*)::int as n from ${table}`);
        expect(res.rows[0].n, `${table} must be empty without app.user_id`).toBe(0);
      }
      // The same tables are provably non-empty for the admin.
      const adminSees = await admin.query('select count(*)::int as n from blood_pressure_reading');
      expect(adminSees.rows[0].n).toBeGreaterThan(0);
    } finally {
      await app.end();
    }
  });

  it('keeps webhook_delivery and schema_migrations usable without user scoping', async () => {
    const app = await connect(db.appUrl);
    try {
      await app.query(
        `insert into webhook_delivery (provider, delivery_hash, status) values ('withings', 'wh-1', 'accepted')`,
      );
      const wh = await app.query('select count(*)::int as n from webhook_delivery');
      expect(wh.rows[0].n).toBe(1);
      const sm = await app.query('select count(*)::int as n from schema_migrations');
      expect(sm.rows[0].n).toBeGreaterThan(0);
    } finally {
      await app.end();
    }
  });
});

describe('schema behaviors', () => {
  it('maintains updated_at via trigger', async () => {
    const inserted = await admin.query<{ id: string; updated_at: Date }>(
      `insert into bp_session (user_id, started_at) values ($1, '2026-08-01T08:00:00Z')
       returning id, updated_at`,
      [userA],
    );
    const { id, updated_at: before } = inserted.rows[0]!;
    await admin.query(`update bp_session set reading_count = 2 where id = $1`, [id]);
    const after = await admin.query<{ updated_at: Date }>(
      'select updated_at from bp_session where id = $1',
      [id],
    );
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.getTime());
  });

  it('blocks the app role from hard-deleting raw events and readings (immutability grants)', async () => {
    const app = await connect(db.appUrl);
    try {
      for (const table of ['raw_ingest_event', 'blood_pressure_reading']) {
        let code: string | undefined;
        try {
          await asUser(app, userA, (c) => c.query(`delete from ${table}`));
        } catch (err) {
          code = pgErrorCode(err);
        }
        expect(code, `${table} DELETE must be denied`).toBe('42501');
      }
    } finally {
      await app.end();
    }
  });
});
