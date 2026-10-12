import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST ?? 'postgres://bho:bho@127.0.0.1:5432/ben_health_os_test';

export default async function setup(): Promise<void> {
  const adminUrl = `${TEST_DATABASE_URL.slice(0, TEST_DATABASE_URL.lastIndexOf('/'))}/postgres`;
  const dbName = TEST_DATABASE_URL.slice(TEST_DATABASE_URL.lastIndexOf('/') + 1);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.query(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }
  execFileSync('node', [join(here, '..', '..', '..', 'scripts', 'db-migrate.mjs')], { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: 'inherit' });
}
