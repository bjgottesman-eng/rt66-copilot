import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { AppContext } from '../app.js';
import { reconcileAll } from '../services/connectors.js';

/** Internal endpoints for scheduled jobs (pg_cron + pg_net on Supabase, or a container cron). */
export async function jobRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/internal/jobs/reconcile', async (request, reply) => {
    const secret = ctx.config.JOB_SECRET;
    if (!secret) return reply.code(503).send({ error: 'jobs_disabled', message: 'JOB_SECRET is not configured' });
    const given = String(request.headers['x-job-secret'] ?? '');
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return reply.code(401).send({ error: 'unauthorized' });
    const summary = await reconcileAll(ctx.pool, ctx.connectors);
    request.log.info({ processed: summary.processed, failed: summary.failed }, 'reconcile job finished');
    return summary;
  });
}
