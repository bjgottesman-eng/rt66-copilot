/** POST /demo/seed (demo mode only, authenticated) and GET /health (public). */

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { seedDemoData } from '../demo/seed.js';
import { forbidden } from '../errors.js';

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', async () => ({ ok: true }));
}

export function registerDemoRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/demo/seed', async (req) => {
    if (ctx.config.mode !== 'demo') {
      throw forbidden('DEMO_ONLY', 'seeding is available in demo mode only');
    }
    const counts = await seedDemoData(ctx, req.userId!);
    return { seeded: true, counts };
  });
}
