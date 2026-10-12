import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST ?? 'postgres://bho:bho@127.0.0.1:5432/ben_health_os_test';

export async function testApp(): Promise<FastifyInstance> {
  return buildApp({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    ALLOW_DEMO_SEED: 'true',
    LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret',
  });
}

export async function login(app: FastifyInstance, email: string): Promise<{ token: string; userId: string; auth: { authorization: string } }> {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload: { email } });
  if (res.statusCode !== 200) throw new Error(`dev-login failed ${res.statusCode}: ${res.body}`);
  const body = res.json() as { accessToken: string; userId: string };
  return { token: body.accessToken, userId: body.userId, auth: { authorization: `Bearer ${body.accessToken}` } };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}
