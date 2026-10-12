import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateDemoDataset } from '@bho/fixtures';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { withUser } from '../db/pool.js';
import { deleteAllData } from '../services/account.js';
import { createManualBloodPressure } from '../services/bp.js';
import { ingestHealthConnectBatch } from '../services/ingest.js';
import { deriveForUser } from '../services/derived.js';
import { localDateOf, addDays } from '@bho/analytics';

const SeedBody = z.object({
  days: z.number().int().min(7).max(120).default(120),
  seed: z.number().int().optional(),
  /** Replace existing demo data. Real (non-demo) data is never overwritten; clear it explicitly first. */
  replace: z.boolean().default(false),
});

export async function demoRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  if (!ctx.config.ALLOW_DEMO_SEED) return;

  app.post('/v1/demo/seed', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = SeedBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid body', details: body.error.issues });
    const profile = await ensureProfile(ctx.pool, ctx.config, user);
    const state = await withUser(ctx.pool, user.userId, async (tx) => {
      const n = await tx.query<{ n: number }>('select count(*)::int as n from public.observations where user_id = $1', [user.userId]);
      return { observations: Number(n.rows[0]!.n), demoMode: profile.demo_mode };
    });
    if (state.observations > 0 && !state.demoMode) return reply.code(409).send({ error: 'conflict', message: 'This account holds real (non-demo) data. Demo data is never mixed with real sources; delete your data first if you really want a demo.' });
    if (state.observations > 0 && state.demoMode && !body.data.replace) return reply.code(409).send({ error: 'conflict', message: 'Demo data already loaded; pass replace=true to regenerate.' });
    if (state.observations > 0) await deleteAllData(ctx.pool, user.userId);

    const endDate = addDays(localDateOf(new Date().toISOString(), null, profile.time_zone), -1);
    const ds = generateDemoDataset({ days: body.data.days, seed: body.data.seed, endDate, timeZone: profile.time_zone, detailedDays: Math.min(45, body.data.days), glucoseDays: Math.min(14, body.data.days) });
    const totals = { received: 0, inserted: 0, updated: 0, unchangedDuplicates: 0, crossSourceDuplicates: 0, rejected: 0 };
    for (const batch of ds.batches) {
      const r = await ingestHealthConnectBatch(ctx.pool, user.userId, batch);
      totals.received += r.received;
      totals.inserted += r.inserted;
      totals.updated += r.updated;
      totals.unchangedDuplicates += r.unchangedDuplicates;
      totals.crossSourceDuplicates += r.crossSourceDuplicates;
      totals.rejected += r.rejected.length;
    }
    for (const m of ds.manualBloodPressure) await createManualBloodPressure(ctx.pool, user.userId, m);
    await withUser(ctx.pool, user.userId, (tx) => tx.query('update public.profiles set demo_mode = true, birth_date = coalesce(birth_date, $2::date) where id = $1', [user.userId, '1986-06-15']));
    const derived = await deriveForUser(ctx.pool, user.userId);
    return { seeded: true, endDate, scenario: ds.scenario, summary: ds.summary, ingest: totals, manualBloodPressure: ds.manualBloodPressure.length, derived };
  });

  app.delete('/v1/demo', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const profile = await ensureProfile(ctx.pool, ctx.config, user);
    if (!profile.demo_mode) return reply.code(409).send({ error: 'conflict', message: 'Demo mode is not active; use DELETE /v1/me/data to remove real data.' });
    const counts = await deleteAllData(ctx.pool, user.userId);
    return { cleared: true, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
}
