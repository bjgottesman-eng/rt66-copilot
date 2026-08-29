/**
 * Environment configuration for the platform service.
 *
 * Two modes (PLATFORM_MODE):
 * - `demo` (default): every missing secret gets a SAFE ephemeral/dev default so
 *   the service boots with zero configuration against the local dev cluster.
 *   Demo defaults are never real secrets: the JWT secret is random per boot
 *   (restart just invalidates demo sessions) and the token-encryption key is a
 *   fixed value derived from the string 'demo' (the data it protects is the
 *   synthetic persona).
 * - `production`: every required variable must be present; anything missing is
 *   a fatal boot error that lists the missing NAMES (never values).
 */

import { createHash, randomBytes } from 'node:crypto';

export type PlatformMode = 'demo' | 'production';

export interface WithingsConfig {
  clientId: string;
  clientSecret: string;
  /** Public URL Withings redirects the browser back to after authorize. */
  redirectUri: string;
  /** Public URL Withings POSTs notifications to (action=subscribe callbackurl). */
  webhookUrl: string;
}

export interface PlatformConfig {
  mode: PlatformMode;
  port: number;
  databaseUrl: string;
  /** HS256 signing secret for platform-issued JWTs. */
  authJwtSecret: string;
  /** 32-byte AES-256-GCM key for OAuth tokens at rest. */
  tokenEncKey: Buffer;
  bootstrapUserEmail: string;
  bootstrapUserPassword: string;
  corsOrigins: string[];
  withings: WithingsConfig;
}

export const DEMO_DATABASE_URL =
  'postgres://benhealth_app:benhealth_app_dev@127.0.0.1:55432/benhealth_dev';
export const DEMO_BOOTSTRAP_EMAIL = 'demo@benhealth.local';
export const DEMO_BOOTSTRAP_PASSWORD = 'demo-password';

/**
 * Fixed dev encryption key derived from 'demo'. Deliberately deterministic so
 * demo-mode restarts can still decrypt previously stored (synthetic) tokens.
 * NOT a secret and never valid in production.
 */
function demoTokenEncKey(): Buffer {
  return createHash('sha256').update('benhealth-demo-token-enc-key:demo').digest();
}

/** Accepts base64 (44 chars) or hex (64 chars) encodings of a 32-byte key. */
export function parseTokenEncKey(raw: string): Buffer {
  const tryDecode = (enc: BufferEncoding): Buffer | null => {
    try {
      const b = Buffer.from(raw, enc);
      // Round-trip check so e.g. hex strings are not mis-read as base64.
      return b.length === 32 && b.toString(enc).replace(/=+$/, '') === raw.replace(/=+$/, '')
        ? b
        : null;
    } catch {
      return null;
    }
  };
  const key = (/^[0-9a-fA-F]{64}$/.test(raw) ? tryDecode('hex') : null) ?? tryDecode('base64');
  if (key === null) {
    throw new Error('TOKEN_ENC_KEY must be a base64- or hex-encoded 32-byte key');
  }
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const modeRaw = env.PLATFORM_MODE ?? 'demo';
  if (modeRaw !== 'demo' && modeRaw !== 'production') {
    throw new Error(`PLATFORM_MODE must be 'demo' or 'production' (got '${modeRaw}')`);
  }
  const mode: PlatformMode = modeRaw;
  const demo = mode === 'demo';

  const missing: string[] = [];
  const req = (name: string, demoDefault: string | null): string => {
    const v = env[name];
    if (v !== undefined && v !== '') return v;
    if (demo && demoDefault !== null) return demoDefault;
    missing.push(name);
    return '';
  };

  const databaseUrl = req('DATABASE_URL', DEMO_DATABASE_URL);
  // Random per boot in demo: safe (only demo JWTs die on restart), never logged.
  const authJwtSecret = req('AUTH_JWT_SECRET', randomBytes(32).toString('hex'));
  const tokenEncKeyRaw = env.TOKEN_ENC_KEY;
  const bootstrapUserEmail = req('BOOTSTRAP_USER_EMAIL', DEMO_BOOTSTRAP_EMAIL);
  const bootstrapUserPassword = req('BOOTSTRAP_USER_PASSWORD', DEMO_BOOTSTRAP_PASSWORD);

  const portRaw = env.PLATFORM_PORT ?? env.PORT ?? '8787';
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PLATFORM_PORT/PORT must be a valid TCP port (got '${portRaw}')`);
  }

  const withings: WithingsConfig = {
    clientId: req('WITHINGS_CLIENT_ID', 'demo-withings-client-id'),
    clientSecret: req('WITHINGS_CLIENT_SECRET', 'demo-withings-client-secret'),
    redirectUri: req(
      'WITHINGS_REDIRECT_URI',
      `http://localhost:${port}/api/v1/integrations/withings/callback`,
    ),
    webhookUrl: req('WITHINGS_WEBHOOK_URL', `http://localhost:${port}/api/v1/webhooks/withings`),
  };

  let tokenEncKey: Buffer;
  if (tokenEncKeyRaw !== undefined && tokenEncKeyRaw !== '') {
    tokenEncKey = parseTokenEncKey(tokenEncKeyRaw);
  } else if (demo) {
    tokenEncKey = demoTokenEncKey();
  } else {
    missing.push('TOKEN_ENC_KEY');
    tokenEncKey = Buffer.alloc(0);
  }

  if (missing.length > 0) {
    // Names only — values must never appear in errors or logs.
    throw new Error(
      `PLATFORM_MODE=production requires environment variables: ${missing.join(', ')}`,
    );
  }

  const corsOrigins = (env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    mode,
    port,
    databaseUrl,
    authJwtSecret,
    tokenEncKey,
    bootstrapUserEmail,
    bootstrapUserPassword,
    corsOrigins,
    withings,
  };
}
