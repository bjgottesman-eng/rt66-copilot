/**
 * Fastify application assembly: security headers, CORS (restricted to
 * CORS_ORIGINS), rate limiting on auth + webhook routes, JWT auth guard,
 * contract error shape, and all /api/v1 routes.
 */

import type { Writable } from 'node:stream';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { registerAuthRoutes, registerPublicAuthRoutes } from './api/auth-routes.js';
import { registerBpRoutes } from './api/bp-routes.js';
import { registerDemoRoutes, registerHealthRoute } from './api/demo-routes.js';
import { registerIngestRoutes } from './api/ingest-routes.js';
import { registerSourceRoutes, registerWithingsCallbackRoute } from './api/source-routes.js';
import { registerWebhookRoutes } from './api/webhook-routes.js';
import { AuthService } from './auth.js';
import type { PlatformConfig } from './config.js';
import type { WithingsApi } from './connectors/withings/api.js';
import { WithingsFake } from './connectors/withings/fake.js';
import { WithingsHttp } from './connectors/withings/http.js';
import { WithingsService } from './connectors/withings/service.js';
import { BackgroundTasks, type AppContext } from './context.js';
import { Db } from './db.js';
import { UserDirectory } from './directory.js';
import { ApiError, unauthorized } from './errors.js';
import { createLogger } from './logging.js';

export interface BuildAppOptions {
  config: PlatformConfig;
  /** Override the Withings implementation (tests inject a WithingsFake). */
  withingsApi?: WithingsApi;
  /** Capture the pino stream (log-redaction tests). */
  loggerStream?: Writable;
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const { config } = options;
  const logger = createLogger(options.loggerStream);
  const db = new Db(config.databaseUrl);
  const directory = new UserDirectory();
  const auth = new AuthService(db, directory, config.authJwtSecret);

  const withingsApi =
    options.withingsApi ??
    (config.mode === 'demo'
      ? new WithingsFake()
      : new WithingsHttp({
          clientId: config.withings.clientId,
          clientSecret: config.withings.clientSecret,
          redirectUri: config.withings.redirectUri,
        }));
  const withingsFake = withingsApi instanceof WithingsFake ? withingsApi : null;
  const withings = new WithingsService({ db, api: withingsApi, config, directory, logger });

  const ctx: AppContext = {
    config,
    db,
    logger,
    auth,
    directory,
    withings,
    withingsFake,
    background: new BackgroundTasks(),
  };

  const app = Fastify({ loggerInstance: logger, trustProxy: true });
  app.addHook('onClose', async () => {
    await ctx.background.drain();
    await db.end();
  });

  // Raw-body-preserving urlencoded parser (webhook delivery hashing needs the
  // exact bytes; @fastify/formbody would discard them).
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 64 * 1024 },
    (req, body, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      req.rawBody = raw;
      done(null, Object.fromEntries(new URLSearchParams(raw)));
    },
  );

  // Helmet-equivalent headers (API-only surface; no inline content).
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-resource-policy', 'same-site');
    reply.header('cache-control', 'no-store');
    return payload;
  });

  // Contract error shape { error: { code, message } }. Messages never carry
  // secrets or health values (ApiError constructors + validation messages obey
  // this; unexpected errors are masked).
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      void reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    const fe = err as { statusCode?: unknown; code?: unknown; message?: unknown };
    const statusCode = typeof fe.statusCode === 'number' ? fe.statusCode : 500;
    if (statusCode === 429) {
      void reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'too many requests' } });
      return;
    }
    if (statusCode >= 500) {
      req.log.error({ err }, 'unhandled error');
      void reply.status(500).send({ error: { code: 'INTERNAL', message: 'internal error' } });
      return;
    }
    void reply.status(statusCode).send({
      error: {
        code: typeof fe.code === 'string' ? fe.code : 'BAD_REQUEST',
        message: typeof fe.message === 'string' ? fe.message : 'bad request',
      },
    });
  });
  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser callers (no Origin header) pass; browsers must match.
      if (origin === undefined || config.corsOrigins.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
  });
  await app.register(rateLimit, { global: false });

  const authGuard = async (req: FastifyRequest): Promise<void> => {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) throw unauthorized();
    const user = await auth.verifyToken(header.slice('Bearer '.length));
    if (user === null) throw unauthorized();
    req.userId = user.id;
    req.userEmail = user.email;
  };

  await app.register(
    async (api) => {
      // Public routes: liveness, login, OAuth redirect target, webhooks.
      registerHealthRoute(api);
      registerPublicAuthRoutes(api, ctx);
      registerWithingsCallbackRoute(api, ctx);
      registerWebhookRoutes(api, ctx);

      // Authenticated routes.
      await api.register(async (secured) => {
        secured.addHook('preHandler', authGuard);
        registerAuthRoutes(secured, ctx);
        registerBpRoutes(secured, ctx);
        registerSourceRoutes(secured, ctx);
        registerIngestRoutes(secured, ctx);
        registerDemoRoutes(secured, ctx);
      });
    },
    { prefix: '/api/v1' },
  );

  // Local auth mode: ensure the bootstrap user exists before serving.
  await auth.ensureUser(config.bootstrapUserEmail, config.bootstrapUserPassword);

  // Widen the pino-typed instance back to the default logger generic.
  return { app: app as unknown as FastifyInstance, ctx };
}
