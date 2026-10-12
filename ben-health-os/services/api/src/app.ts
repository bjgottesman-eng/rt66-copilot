import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
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

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
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

  app.addHook('onClose', async () => {
    await pool.end();
  });
  return app;
}
