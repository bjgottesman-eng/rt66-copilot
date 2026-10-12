import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';

export async function healthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/health', async () => {
    const started = Date.now();
    await ctx.pool.query('select 1');
    return { status: 'ok', version: ctx.config.APP_VERSION, authMode: ctx.config.AUTH_MODE, dbLatencyMs: Date.now() - started, time: new Date().toISOString() };
  });
}
