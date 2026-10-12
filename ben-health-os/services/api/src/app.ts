import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { access, mkdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import type pg from 'pg';
import { loadConfig, type AppConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createVerifier } from './auth/jwt.js';
import { registerAuth } from './auth/plugin.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { ingestRoutes } from './routes/ingest.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { sourcesRoutes } from './routes/sources.js';
import { measurementRoutes } from './routes/measurements.js';
import { accountRoutes } from './routes/account.js';
import { demoRoutes } from './routes/demo.js';
import { oauthRoutes } from './routes/oauth.js';
import { webhookRoutes } from './routes/webhooks.js';
import { jobRoutes } from './routes/jobs.js';
import { analyticsRoutes } from './routes/analytics.js';
import { nutritionRoutes } from './routes/nutrition.js';
import { clinicalRoutes } from './routes/clinical.js';
import { intelligenceRoutes } from './routes/intelligence.js';
import { experimentRoutes } from './routes/experiments.js';
import { createConnectorRuntime, type ConnectorRuntime } from './services/connectors.js';

export interface AppContext {
  config: AppConfig;
  pool: pg.Pool;
  connectors: ConnectorRuntime;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export async function buildApp(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<FastifyInstance> {
  const config = loadConfig({ ...process.env, ...overrides });
  const pool = createPool(config.DATABASE_URL);
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Request logs carry method/url/status only. Bodies (health data) are never serialized.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url.split('?')[0], id: req.id }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      redact: ['req.headers.authorization'],
    },
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: true,
  });
  const ctx: AppContext = { config, pool, connectors: createConnectorRuntime(config, { warn: (m) => app.log.warn(m) }) };
  app.decorate('ctx', ctx);

  await app.register(cors, { origin: config.corsOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });
  registerAuth(app, createVerifier(config));

  // ---- Phase 8 hardening: rate limits per route class, security headers, readiness, JSON 404s.
  const limitFor = (method: string | string[], url: string): { max: number; timeWindow: string } | null => {
    const m = Array.isArray(method) ? method.join(',') : method;
    const minute = '1 minute';
    if (url === '/v1/auth/dev-login') return config.RATE_LIMIT_AUTH_MAX ? { max: config.RATE_LIMIT_AUTH_MAX, timeWindow: minute } : null;
    if (url.startsWith('/internal/jobs/')) return config.RATE_LIMIT_JOBS_MAX ? { max: config.RATE_LIMIT_JOBS_MAX, timeWindow: minute } : null;
    const heavy = url.startsWith('/v1/imports/') || url.startsWith('/v1/oauth/') || url === '/v1/demo/seed' || url === '/v1/me/export' || url === '/v1/me/data' || url === '/v1/analysis-packet' || (url.startsWith('/v1/reports/') && m.includes('POST')) || (url === '/v1/physician-brief' && m.includes('POST'));
    return heavy && config.RATE_LIMIT_HEAVY_MAX ? { max: config.RATE_LIMIT_HEAVY_MAX, timeWindow: minute } : null;
  };
  app.addHook('onRoute', (routeOptions) => {
    const limit = limitFor(routeOptions.method, routeOptions.url);
    if (limit) routeOptions.config = { ...(routeOptions.config ?? {}), rateLimit: limit };
  });
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => (request as { user?: { userId: string } }).user?.userId ?? request.ip,
    errorResponseBuilder: (_request, context) => ({ statusCode: 429, error: 'rate_limited', message: `Too many requests; retry in ${Math.ceil(context.ttl / 1000)} s.`, retryAfterSeconds: Math.ceil(context.ttl / 1000) }),
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
    if (config.PUBLIC_BASE_URL?.startsWith('https://')) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  });
  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: 'not_found', message: 'route not found' });
  });
  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, 'ok' | 'failed'> = { database: 'failed', documentStorage: 'failed' };
    try {
      await pool.query('select 1');
      checks.database = 'ok';
    } catch {
      /* reported below */
    }
    try {
      await mkdir(config.DOCUMENT_STORAGE_DIR, { recursive: true });
      await access(config.DOCUMENT_STORAGE_DIR, fsConstants.W_OK);
      checks.documentStorage = 'ok';
    } catch {
      /* reported below */
    }
    const ready = Object.values(checks).every((c) => c === 'ok');
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks, version: config.APP_VERSION });
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    if (statusCode === 429) {
      // @fastify/rate-limit hands the errorResponseBuilder object to the error handler.
      void reply.code(429).send({ error: 'rate_limited', message: err.message, retryAfterSeconds: (err as { retryAfterSeconds?: number }).retryAfterSeconds ?? null });
      return;
    }
    if (statusCode >= 500) request.log.error({ err: { message: err.message, name: err.name } }, 'request failed');
    void reply.code(statusCode).send({ error: statusCode >= 500 ? 'internal_error' : 'request_error', message: statusCode >= 500 ? 'internal error' : err.message });
  });

  await app.register(async (instance) => healthRoutes(instance, ctx));
  await app.register(async (instance) => authRoutes(instance, ctx));
  await app.register(async (instance) => ingestRoutes(instance, ctx));
  await app.register(async (instance) => dashboardRoutes(instance, ctx));
  await app.register(async (instance) => sourcesRoutes(instance, ctx));
  await app.register(async (instance) => measurementRoutes(instance, ctx));
  await app.register(async (instance) => accountRoutes(instance, ctx));
  await app.register(async (instance) => demoRoutes(instance, ctx));
  await app.register(async (instance) => oauthRoutes(instance, ctx));
  await app.register(async (instance) => webhookRoutes(instance, ctx));
  await app.register(async (instance) => jobRoutes(instance, ctx));
  await app.register(async (instance) => analyticsRoutes(instance, ctx));
  await app.register(async (instance) => nutritionRoutes(instance, ctx));
  await app.register(async (instance) => clinicalRoutes(instance, ctx));
  await app.register(async (instance) => intelligenceRoutes(instance, ctx));
  await app.register(async (instance) => experimentRoutes(instance, ctx));

  app.addHook('onClose', async () => {
    await pool.end();
  });
  return app;
}
