import { z } from 'zod';

/**
 * Environment configuration. See docs/environment.md for every variable.
 * AUTH_MODE=local is for development/tests only: it enables POST /v1/auth/dev-login and HS256
 * tokens signed with LOCAL_JWT_SECRET. AUTH_MODE=supabase verifies Supabase Auth JWTs via JWKS.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  AUTH_MODE: z.enum(['local', 'supabase']).default('local'),
  LOCAL_JWT_SECRET: z.string().min(16).default('local-dev-secret-change-me-please-32chars'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  /** base64 of 32 random bytes; encrypts OAuth tokens at rest. Required when any OAuth connector is enabled. */
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  ALLOW_DEMO_SEED: z.coerce.boolean().default(true),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8787'),
  APP_VERSION: z.string().default('0.1.0'),
});

export type AppConfig = z.infer<typeof EnvSchema> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid environment: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.AUTH_MODE === 'supabase' && !cfg.SUPABASE_URL && !cfg.SUPABASE_JWKS_URL && !cfg.SUPABASE_JWT_SECRET) {
    throw new Error('AUTH_MODE=supabase requires SUPABASE_URL (for JWKS) or SUPABASE_JWT_SECRET');
  }
  if (cfg.NODE_ENV === 'production' && cfg.AUTH_MODE === 'local') {
    throw new Error('AUTH_MODE=local is not allowed in production');
  }
  return { ...cfg, corsOrigins: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) };
}
