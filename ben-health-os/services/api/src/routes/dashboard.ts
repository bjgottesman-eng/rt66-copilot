import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { metricById } from '@bho/shared-config';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { buildSeries, buildToday } from '../services/dashboard.js';

const SeriesQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  bucket: z.enum(['raw', 'day']).default('day'),
});

export async function dashboardRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/dashboard/today', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return buildToday(ctx.pool, user.userId);
  });

  app.get('/v1/metrics/:metricId/series', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { metricId } = request.params as { metricId: string };
    if (!metricById(metricId)) return reply.code(404).send({ error: 'not_found', message: `unknown metric ${metricId}` });
    const q = SeriesQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid query', details: q.error.issues });
    const to = q.data.to ?? new Date().toISOString();
    const from = q.data.from ?? new Date(Date.parse(to) - 90 * 86_400_000).toISOString();
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return reply.code(400).send({ error: 'bad_request', message: 'from/to must be ISO-8601' });
    await ensureProfile(ctx.pool, ctx.config, user);
    return buildSeries(ctx.pool, user.userId, metricId, from, to, q.data.bucket);
  });
}
