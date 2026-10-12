import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { metricById } from '@bho/shared-config';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { deriveAll, deriveForUser, latestSignals, trendsForMetric } from '../services/derived.js';

export async function analyticsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/analytics/trends/:metricId', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { metricId } = request.params as { metricId: string };
    if (!metricById(metricId)) return reply.code(404).send({ error: 'not_found', message: `unknown metric ${metricId}` });
    await ensureProfile(ctx.pool, ctx.config, user);
    return trendsForMetric(ctx.pool, user.userId, metricId);
  });

  app.get('/v1/analytics/signals', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    const q = request.query as { asOf?: string };
    return { signals: await latestSignals(ctx.pool, user.userId, q.asOf) };
  });

  app.post('/v1/analytics/derive', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return deriveForUser(ctx.pool, user.userId);
  });

  app.post('/internal/jobs/derive', async (request, reply) => {
    const secret = ctx.config.JOB_SECRET;
    if (!secret) return reply.code(503).send({ error: 'jobs_disabled', message: 'JOB_SECRET is not configured' });
    const given = Buffer.from(String(request.headers['x-job-secret'] ?? ''));
    const expected = Buffer.from(secret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return reply.code(401).send({ error: 'unauthorized' });
    return deriveAll(ctx.pool);
  });
}
