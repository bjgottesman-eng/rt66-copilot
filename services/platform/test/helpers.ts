/**
 * Integration-test harness: a scratch database (via @benhealth/db's
 * create-test-db helper, so migrations + the real benhealth_app role + RLS are
 * exercised for real) plus a Fastify app wired to a WithingsFake.
 *
 * `admin` runs assertions as the cluster superuser (bypasses RLS — for
 * verifying what is REALLY in the tables, e.g. encrypted bytea, cross-user
 * counts); the app itself only ever uses the RLS-bound app role.
 */

import { Writable } from 'node:stream';
import { createTestDatabase, type TestDatabase } from '@benhealth/db';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig, type PlatformConfig } from '../src/config.js';
import { WithingsFake } from '../src/connectors/withings/fake.js';
import type { AppContext } from '../src/context.js';

const { Pool } = pg;

export interface Harness {
  app: FastifyInstance;
  ctx: AppContext;
  fake: WithingsFake;
  config: PlatformConfig;
  testDb: TestDatabase;
  admin: pg.Pool;
  /** Bootstrap demo user. */
  userId: string;
  token: string;
  close(): Promise<void>;
}

export const TEST_PASSWORD = 'demo-password';

export async function createHarness(options: { loggerStream?: Writable } = {}): Promise<Harness> {
  const testDb = await createTestDatabase();
  const config = loadConfig({
    PLATFORM_MODE: 'demo',
    DATABASE_URL: testDb.appUrl,
    AUTH_JWT_SECRET: 'integration-test-jwt-secret-0123456789abcdef',
    CORS_ORIGINS: 'http://localhost:3000',
  });
  const fake = new WithingsFake();
  // Default to a discard stream so test output stays readable; the redaction
  // test passes its own capturing stream.
  const loggerStream =
    options.loggerStream ??
    new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
  const { app, ctx } = await buildApp({ config, withingsApi: fake, loggerStream });
  const admin = new Pool({ connectionString: testDb.adminUrl, max: 3 });

  const token = await login(app, config.bootstrapUserEmail, TEST_PASSWORD);
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${token}` },
  });
  const userId = (me.json() as { id: string }).id;

  return {
    app,
    ctx,
    fake,
    config,
    testDb,
    admin,
    userId,
    token,
    async close() {
      await app.close();
      await admin.end();
      await testDb.drop();
    },
  };
}

export async function login(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  return (res.json() as { token: string }).token;
}

export function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Full OAuth connect flow through the API (includes the historical backfill). */
export async function connectWithings(h: Harness, token = h.token): Promise<void> {
  const connect = await h.app.inject({
    method: 'POST',
    url: '/api/v1/sources/withings/connect',
    headers: authHeaders(token),
  });
  if (connect.statusCode !== 200) {
    throw new Error(`connect failed: ${connect.statusCode} ${connect.body}`);
  }
  const { authorizeUrl } = connect.json() as { authorizeUrl: string };
  const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
  const cb = await h.app.inject({
    method: 'GET',
    url: `/api/v1/integrations/withings/callback?code=demo-code&state=${state}`,
  });
  if (cb.statusCode !== 302) {
    throw new Error(`callback failed: ${cb.statusCode} ${cb.body}`);
  }
}

/** POST a Withings-style urlencoded webhook delivery and await its async sync. */
export async function postWebhook(
  h: Harness,
  fields: Record<string, string | number>,
): Promise<number> {
  const body = new URLSearchParams(
    Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
  ).toString();
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/withings',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: body,
  });
  await h.ctx.background.drain();
  return res.statusCode;
}

export async function adminCount(h: Harness, sql: string, params: unknown[] = []): Promise<number> {
  const res = await h.admin.query<{ n: string }>(sql, params);
  return Number(res.rows[0]?.n ?? '0');
}
