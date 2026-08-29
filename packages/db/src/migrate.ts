/**
 * Migration runner for Ben Health OS (packages/db).
 *
 * - Connects with the ADMIN connection string (DATABASE_ADMIN_URL). Only the
 *   migration runner uses the admin URL; the platform service runs as the
 *   non-BYPASSRLS role `benhealth_app`.
 * - Bootstraps the `benhealth_app` role (scripts/bootstrap-roles.sql) when it
 *   is missing — roles are cluster-global, so this is not a migration.
 * - Creates `schema_migrations(version, applied_at)` if missing.
 * - Applies pending `migrations/NNNN_name.sql` files in order, each inside its
 *   own transaction, recording the version in the same transaction.
 *
 * CLI: `pnpm --filter @benhealth/db migrate`
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Resolves for both src/ (tsx) and dist/ (compiled) execution. */
export const MIGRATIONS_DIR = path.resolve(HERE, '..', 'migrations');
export const BOOTSTRAP_ROLES_SQL_PATH = path.resolve(HERE, '..', 'scripts', 'bootstrap-roles.sql');

export const APP_ROLE = 'benhealth_app';

/** Arbitrary constant key so concurrent runners serialize via advisory lock. */
const MIGRATION_LOCK_KEY = 727_566_001;

const MIGRATION_FILE_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrateResult {
  /** Migration versions applied by this run, in order. */
  applied: string[];
  /** Versions that were already recorded and therefore skipped. */
  skipped: string[];
}

export interface MigrateOptions {
  /** Defaults to the package's migrations/ directory. */
  migrationsDir?: string;
  log?: (message: string) => void;
}

async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  const entries = await readdir(migrationsDir);
  const files = entries.filter((name) => MIGRATION_FILE_RE.test(name));
  files.sort(); // NNNN_ prefix => lexicographic order == numeric order
  return files;
}

async function ensureAppRole(client: pg.Client, log: (m: string) => void): Promise<void> {
  const res = await client.query('select 1 from pg_catalog.pg_roles where rolname = $1', [
    APP_ROLE,
  ]);
  if (res.rowCount === 0) {
    log(`role ${APP_ROLE} missing — applying scripts/bootstrap-roles.sql`);
    const sql = await readFile(BOOTSTRAP_ROLES_SQL_PATH, 'utf8');
    await client.query(sql);
  }
}

async function ensureSchemaMigrations(client: pg.Client): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

/**
 * Applies all pending migrations against the database in `adminUrl`.
 * Idempotent: re-running against an up-to-date database applies nothing.
 */
export async function runMigrations(
  adminUrl: string,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const migrationsDir = options.migrationsDir ?? MIGRATIONS_DIR;
  const log = options.log ?? (() => undefined);

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // Serialize concurrent runners (session-level lock, released on disconnect).
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await ensureAppRole(client, log);
    await ensureSchemaMigrations(client);

    const files = await listMigrationFiles(migrationsDir);
    const appliedRes = await client.query<{ version: string }>(
      'select version from schema_migrations',
    );
    const alreadyApplied = new Set(appliedRes.rows.map((r) => r.version));

    const result: MigrateResult = { applied: [], skipped: [] };
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (alreadyApplied.has(version)) {
        result.skipped.push(version);
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [version]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : err}`, {
          cause: err,
        });
      }
      log(`applied ${version}`);
      result.applied.push(version);
    }
    return result;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!adminUrl) {
    console.error(
      'DATABASE_ADMIN_URL is not set (e.g. postgres://postgres@127.0.0.1:55432/benhealth).',
    );
    process.exitCode = 1;
    return;
  }
  // Never log the connection string itself (may carry credentials).
  const result = await runMigrations(adminUrl, { log: (m) => console.log(`[migrate] ${m}`) });
  console.log(
    `[migrate] done: ${result.applied.length} applied, ${result.skipped.length} already up to date`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[migrate] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
