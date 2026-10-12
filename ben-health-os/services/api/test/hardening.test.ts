import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { login, uniqueEmail, TEST_DATABASE_URL } from './helpers.js';

const BASE = { NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_MODE: 'local', LOG_LEVEL: 'silent', ALLOW_DEMO_SEED: 'true', LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret' } as const;
let app: FastifyInstance;
const storage = mkdtempSync(join(tmpdir(), 'bho-ready-'));
beforeAll(async () => {
  app = await buildApp({ ...BASE, RATE_LIMIT_AUTH_MAX: '3', RATE_LIMIT_HEAVY_MAX: '2', DOCUMENT_STORAGE_DIR: storage, PUBLIC_BASE_URL: 'https://api.example.test' });
});
afterAll(async () => {
  await app.close();
});

describe('Phase 8: hardening', () => {
  it('rate limits login and heavy endpoints with a JSON envelope and Retry-After', async () => {
    const email = uniqueEmail('limit');
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload: { email } })).statusCode).toBe(200);
    const limited = await app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload: { email } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'rate_limited' });
    expect(limited.json().retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.headers['retry-after']).toBeTruthy();
    // Heavy endpoints are limited per user, not per IP: a second user still gets through
    const other = await buildApp({ ...BASE, RATE_LIMIT_HEAVY_MAX: '2', DOCUMENT_STORAGE_DIR: storage });
    try {
      const a = await login(other, uniqueEmail('heavy-a'));
      const b = await login(other, uniqueEmail('heavy-b'));
      expect((await other.inject({ method: 'GET', url: '/v1/me/export', headers: a.auth })).statusCode).toBe(200);
      expect((await other.inject({ method: 'GET', url: '/v1/me/export', headers: a.auth })).statusCode).toBe(200);
      expect((await other.inject({ method: 'GET', url: '/v1/me/export', headers: a.auth })).statusCode).toBe(429);
      expect((await other.inject({ method: 'GET', url: '/v1/me/export', headers: b.auth })).statusCode).toBe(200);
      // Ordinary reads are not limited
      for (let i = 0; i < 5; i++) expect((await other.inject({ method: 'GET', url: '/v1/dashboard/today', headers: a.auth })).statusCode).toBe(200);
    } finally {
      await other.close();
    }
  });

  it('adds security headers, serves readiness honestly, and answers unknown routes with the error envelope', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['referrer-policy']).toBe('no-referrer');
    expect(health.headers['cache-control']).toBe('no-store');
    expect(health.headers['strict-transport-security']).toContain('max-age=');
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ready', checks: { database: 'ok', documentStorage: 'ok' } });
    const notFound = await app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({ error: 'not_found', message: 'route not found' });
    // Readiness fails when the document directory cannot be created (a file sits where the directory should be)
    const blocker = join(storage, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const broken = await buildApp({ ...BASE, DOCUMENT_STORAGE_DIR: join(blocker, 'docs') });
    try {
      const r = await broken.inject({ method: 'GET', url: '/ready' });
      expect(r.statusCode).toBe(503);
      expect(r.json().checks).toMatchObject({ database: 'ok', documentStorage: 'failed' });
    } finally {
      await broken.close();
    }
  });

  it('refuses unsafe production configuration', () => {
    const prod = { NODE_ENV: 'production', DATABASE_URL: TEST_DATABASE_URL, AUTH_MODE: 'supabase', SUPABASE_URL: 'https://example.supabase.co', ALLOW_DEMO_SEED: 'false', PUBLIC_BASE_URL: 'https://api.example.test' };
    expect(() => loadConfig({ ...prod, AUTH_MODE: 'local' })).toThrow(/AUTH_MODE=local/);
    expect(() => loadConfig({ ...prod, ALLOW_DEMO_SEED: 'true' })).toThrow(/ALLOW_DEMO_SEED/);
    expect(() => loadConfig({ ...prod, PUBLIC_BASE_URL: 'http://api.example.test' })).toThrow(/https/);
    expect(() => loadConfig({ ...prod, OURA_CLIENT_ID: 'x' })).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...prod, OURA_CLIENT_ID: 'x', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') })).not.toThrow();
    expect(() => loadConfig({ ...prod, PUBLIC_BASE_URL: undefined })).toThrow(/https/); // the development default is http and must be overridden
    expect(loadConfig({ ...prod }).RATE_LIMIT_AUTH_MAX).toBe(30);
  });
});
