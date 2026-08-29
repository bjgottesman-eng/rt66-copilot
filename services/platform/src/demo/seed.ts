/**
 * Demo persona seeding (contracts §7): wipe + reseed the demo user's data
 * from fixtures/demo-persona via the REAL ingestion pipeline —
 * WithingsFake full sync (including the corrected measurement), the Apple
 * Health batch, and the manual entries — then dedup + session grouping have
 * already run as part of ingestion.
 *
 * WIPE: the service role deliberately has no DELETE on raw_ingest_event /
 * blood_pressure_reading (migration 0005). The one sanctioned wipe path is
 * deleting the user's app_user row inside their own RLS scope: every
 * user-data table references app_user ON DELETE CASCADE, and referential
 * actions run regardless of the per-table grants. The row is then recreated
 * with the SAME deterministic id and password hash, so existing JWTs stay
 * valid. audit_log intentionally survives (append-only, no FK).
 *
 * CLI: `pnpm --filter @benhealth/platform demo:seed`
 * API: `POST /api/v1/demo/seed` (demo mode only).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { HealthKitBpBatch, ManualBpEntry } from '@benhealth/shared';
import { AuthService } from '../auth.js';
import { loadConfig, type PlatformConfig } from '../config.js';
import { DEFAULT_FIXTURES_DIR, WithingsFake } from '../connectors/withings/fake.js';
import { WithingsService } from '../connectors/withings/service.js';
import type { AppContext } from '../context.js';
import { Db } from '../db.js';
import { UserDirectory } from '../directory.js';
import { forbidden } from '../errors.js';
import { ingestAppleHealth } from '../ingest/apple.js';
import { ingestManualEntry, validateManualEntry } from '../ingest/normalize.js';
import { createLogger } from '../logging.js';
import { recomputeSessions } from '../sessions.js';

export interface SeedCounts {
  withingsImported: number;
  withingsCorrected: number;
  appleAccepted: number;
  appleDuplicates: number;
  manualEntries: number;
  rawEvents: number;
  readings: number;
  canonicalReadings: number;
  duplicateReadings: number;
  sessions: number;
}

type SeedContext = Pick<
  AppContext,
  'config' | 'db' | 'auth' | 'directory' | 'withings' | 'withingsFake'
>;

export async function seedDemoData(ctx: SeedContext, userId: string): Promise<SeedCounts> {
  if (ctx.config.mode !== 'demo') {
    throw forbidden('DEMO_ONLY', 'seeding is available in demo mode only');
  }
  const fake = ctx.withingsFake;
  if (fake === null) throw forbidden('DEMO_ONLY', 'demo fixture server is not active');

  fake.reset();

  // Wipe + recreate (see module doc): preserve identity + password hash.
  const identity = await ctx.db.withUserTx(userId, async (client) => {
    const res = await client.query<{ email: string; password_hash: string | null }>(
      'select email, password_hash from app_user where id = $1',
      [userId],
    );
    return res.rows[0];
  });
  if (identity === undefined) throw forbidden('DEMO_ONLY', 'unknown user');
  await ctx.db.withUserTx(userId, async (client) => {
    await client.query('delete from app_user where id = $1', [userId]);
    await client.query('insert into app_user (id, email, password_hash) values ($1, $2, $3)', [
      userId,
      identity.email,
      identity.password_hash,
    ]);
    await client.query(
      `insert into audit_log (user_id, actor, action, entity, entity_id, details)
       values ($1::uuid, 'platform.demo', 'demo.reseeded', 'app_user', $1::text, '{}')`,
      [userId],
    );
  });
  ctx.directory.register(userId, identity.email);

  // Withings: OAuth connect via the fake (stores encrypted tokens, subscribes
  // appli=4, historical backfill), then establish the lastupdate cursor.
  const { authorizeUrl } = await ctx.withings.startConnect(userId);
  const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
  await ctx.withings.handleCallback('demo-authorization-code', state);
  const initial = await ctx.withings.syncViaCursor(userId);

  // The corrected measurement: serve it, re-cover its window via backfill
  // (idempotent for every unchanged group), which updates the reading.
  fake.applyCorrections();
  const correctionPass = await ctx.withings.backfill(userId, 120);

  const fixturesDir = DEFAULT_FIXTURES_DIR;
  const appleBatch = JSON.parse(
    readFileSync(path.join(fixturesDir, 'bp-apple-health.json'), 'utf8'),
  ) as HealthKitBpBatch;
  const apple = await ingestAppleHealth(ctx.db, userId, appleBatch);

  const manual = JSON.parse(readFileSync(path.join(fixturesDir, 'bp-manual.json'), 'utf8')) as {
    entries: ManualBpEntry[];
  };
  let manualCount = 0;
  await ctx.db.withUserTx(userId, async (client) => {
    for (const entry of manual.entries) {
      const problem = validateManualEntry(entry);
      if (problem !== null) throw new Error(`fixture manual entry invalid: ${problem}`);
      await ingestManualEntry(client, { userId, connectionId: null }, entry);
      manualCount += 1;
    }
    await recomputeSessions(client, userId);
  });

  const totals = await ctx.db.withUserTx(userId, async (client) => {
    const one = async (sql: string): Promise<number> =>
      Number((await client.query<{ n: string }>(sql)).rows[0]?.n ?? '0');
    return {
      rawEvents: await one('select count(*) as n from raw_ingest_event'),
      readings: await one(
        'select count(*) as n from blood_pressure_reading where deleted_at is null',
      ),
      canonicalReadings: await one(
        'select count(*) as n from blood_pressure_reading where canonical and deleted_at is null',
      ),
      duplicateReadings: await one(
        'select count(*) as n from blood_pressure_reading where not canonical and deleted_at is null',
      ),
      sessions: await one('select count(*) as n from bp_session'),
    };
  });

  // The connect-time backfill did the bulk import; the cursor sync afterwards
  // is expected to find nothing new (initial.imported ~ 0).
  void initial;
  return {
    withingsImported: await countWithingsReadings(ctx, userId),
    withingsCorrected: correctionPass.counts.corrected,
    appleAccepted: apple.accepted,
    appleDuplicates: apple.duplicates,
    manualEntries: manualCount,
    ...totals,
  };
}

/** Readings imported from Withings (the connect-time backfill did the bulk). */
async function countWithingsReadings(ctx: SeedContext, userId: string): Promise<number> {
  return ctx.db.withUserTx(userId, async (client) => {
    const res = await client.query<{ n: string }>(
      `select count(*) as n from blood_pressure_reading where source = 'withings_api'`,
    );
    return Number(res.rows[0]?.n ?? '0');
  });
}

async function main(): Promise<void> {
  const config: PlatformConfig = loadConfig(process.env);
  if (config.mode !== 'demo') {
    console.error('[demo:seed] PLATFORM_MODE must be demo');
    process.exitCode = 1;
    return;
  }
  const logger = createLogger();
  const db = new Db(config.databaseUrl);
  const directory = new UserDirectory();
  const auth = new AuthService(db, directory, config.authJwtSecret);
  const fake = new WithingsFake();
  const withings = new WithingsService({ db, api: fake, config, directory, logger });
  try {
    const user = await auth.ensureUser(config.bootstrapUserEmail, config.bootstrapUserPassword);
    const counts = await seedDemoData(
      { config, db, auth, directory, withings, withingsFake: fake },
      user.id,
    );
    console.log('[demo:seed] seeded demo persona:');
    for (const [key, value] of Object.entries(counts)) {
      console.log(`[demo:seed]   ${key}: ${value}`);
    }
  } finally {
    await db.end();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[demo:seed] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
