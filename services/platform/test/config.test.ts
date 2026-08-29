import { describe, expect, it } from 'vitest';
import { DEMO_DATABASE_URL, loadConfig, parseTokenEncKey } from '../src/config.js';

describe('loadConfig', () => {
  it('demo mode boots with zero configuration', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('demo');
    expect(config.databaseUrl).toBe(DEMO_DATABASE_URL);
    expect(config.port).toBe(8787);
    expect(config.bootstrapUserEmail).toBe('demo@benhealth.local');
    expect(config.tokenEncKey.length).toBe(32);
    expect(config.authJwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('demo token-enc key is a fixed value derived from demo (restart-safe)', () => {
    const a = loadConfig({});
    const b = loadConfig({});
    expect(a.tokenEncKey.equals(b.tokenEncKey)).toBe(true);
    // the JWT secret however is ephemeral per boot
    expect(a.authJwtSecret).not.toBe(b.authJwtSecret);
  });

  it('production mode fails fast, listing missing variable NAMES only', () => {
    expect(() => loadConfig({ PLATFORM_MODE: 'production' })).toThrow(
      /DATABASE_URL.*AUTH_JWT_SECRET|AUTH_JWT_SECRET.*DATABASE_URL/s,
    );
    try {
      loadConfig({ PLATFORM_MODE: 'production' });
      expect.unreachable();
    } catch (err) {
      const msg = (err as Error).message;
      for (const name of [
        'DATABASE_URL',
        'AUTH_JWT_SECRET',
        'TOKEN_ENC_KEY',
        'WITHINGS_CLIENT_ID',
        'WITHINGS_CLIENT_SECRET',
        'WITHINGS_REDIRECT_URI',
        'WITHINGS_WEBHOOK_URL',
        'BOOTSTRAP_USER_EMAIL',
        'BOOTSTRAP_USER_PASSWORD',
      ]) {
        expect(msg).toContain(name);
      }
    }
  });

  it('production boots when everything is provided', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const config = loadConfig({
      PLATFORM_MODE: 'production',
      DATABASE_URL: 'postgres://benhealth_app:pw@db:5432/benhealth',
      AUTH_JWT_SECRET: 'x'.repeat(48),
      TOKEN_ENC_KEY: key,
      BOOTSTRAP_USER_EMAIL: 'ben@example.com',
      BOOTSTRAP_USER_PASSWORD: 'pw',
      WITHINGS_CLIENT_ID: 'cid',
      WITHINGS_CLIENT_SECRET: 'cs',
      WITHINGS_REDIRECT_URI: 'https://api.example.com/api/v1/integrations/withings/callback',
      WITHINGS_WEBHOOK_URL: 'https://api.example.com/api/v1/webhooks/withings',
      CORS_ORIGINS: 'https://app.example.com, https://other.example.com',
    });
    expect(config.mode).toBe('production');
    expect(config.corsOrigins).toEqual(['https://app.example.com', 'https://other.example.com']);
    expect(config.tokenEncKey.equals(Buffer.alloc(32, 7))).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(() => loadConfig({ PLATFORM_MODE: 'staging' })).toThrow(/PLATFORM_MODE/);
    expect(() => loadConfig({ PLATFORM_PORT: 'nope' })).toThrow(/port/i);
    expect(() => parseTokenEncKey('too-short')).toThrow(/32-byte/);
    expect(parseTokenEncKey(Buffer.alloc(32, 1).toString('hex')).length).toBe(32);
  });
});
