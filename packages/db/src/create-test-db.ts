/**
 * Test helper: create a uniquely-named scratch database on the local cluster,
 * run all migrations into it, and hand back both connection strings:
 *
 * - `adminUrl` — superuser/owner connection (migrations, fixtures, assertions)
 * - `appUrl`   — connects as `benhealth_app` (LOGIN, no BYPASSRLS), the same
 *   role the platform service uses, so RLS behavior is exercised for real.
 *
 * The dev password below matches scripts/bootstrap-roles.sql; it is a
 * well-known local-development value, not a secret (local clusters use trust
 * auth anyway).
 */

import { randomBytes } from 'node:crypto';
import process from 'node:process';
import pg from 'pg';
import { APP_ROLE, runMigrations } from './migrate.js';

const { Client } = pg;

export const DEFAULT_ADMIN_URL = 'postgres://postgres@127.0.0.1:55432/postgres';
const APP_ROLE_DEV_PASSWORD = 'benhealth_app_dev';

export interface TestDatabase {
  /** Generated database name, e.g. benhealth_test_m1abc2_9f3d21e0. */
  name: string;
  /** Admin connection string pointing at the scratch database. */
  adminUrl: string;
  /** benhealth_app connection string pointing at the scratch database. */
  appUrl: string;
  /** Drops the scratch database (terminating any leftover connections). */
  drop(): Promise<void>;
}

function withDatabase(baseUrl: string, database: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url;
}

/**
 * Creates the scratch database and migrates it.
 *
 * @param baseAdminUrl admin URL for the cluster (its database part is only
 *   used for the maintenance connection). Defaults to $DATABASE_ADMIN_URL,
 *   then the local dev cluster.
 */
export async function createTestDatabase(
  baseAdminUrl: string = process.env.DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL,
): Promise<TestDatabase> {
  const name = `benhealth_test_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

  const maintenance = new Client({ connectionString: baseAdminUrl });
  await maintenance.connect();
  try {
    await maintenance.query(`create database "${name}"`);
  } finally {
    await maintenance.end();
  }

  const adminUrl = withDatabase(baseAdminUrl, name).toString();
  try {
    await runMigrations(adminUrl);
  } catch (err) {
    await dropDatabase(baseAdminUrl, name).catch(() => undefined);
    throw err;
  }

  const appUrl = withDatabase(baseAdminUrl, name);
  appUrl.username = APP_ROLE;
  appUrl.password = APP_ROLE_DEV_PASSWORD;

  return {
    name,
    adminUrl,
    appUrl: appUrl.toString(),
    drop: () => dropDatabase(baseAdminUrl, name),
  };
}

async function dropDatabase(baseAdminUrl: string, name: string): Promise<void> {
  const maintenance = new Client({ connectionString: baseAdminUrl });
  await maintenance.connect();
  try {
    await maintenance.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await maintenance.end();
  }
}
