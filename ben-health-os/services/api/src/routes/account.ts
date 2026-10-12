import type { FastifyInstance } from 'fastify';
import { DeleteAllDataRequestSchema } from '@bho/contracts';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { deleteAllData, exportAll } from '../services/account.js';

export async function accountRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/me/export', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    const bundle = await exportAll(ctx.pool, user.userId);
    reply.header('content-disposition', `attachment; filename="ben-health-os-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return bundle;
  });

  app.delete('/v1/me/data', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = DeleteAllDataRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'confirmation phrase required', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    const counts = await deleteAllData(ctx.pool, user.userId);
    return { deleted: counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
}
