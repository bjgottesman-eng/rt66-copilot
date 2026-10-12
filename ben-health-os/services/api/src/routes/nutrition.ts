import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AnnotationInputSchema, CronometerImportRequestSchema, IsoDateSchema, UuidSchema } from '@bho/contracts';
import { addDays, localDateOf } from '@bho/analytics';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { importCronometerCsv, nutritionDays } from '../services/nutrition.js';
import { createAnnotation, deleteAnnotation, glucoseDay, listAnnotations, repeatedMealsReport } from '../services/glucose.js';

const RangeQuery = z.object({ from: IsoDateSchema.optional(), to: IsoDateSchema.optional() });
const DayQuery = z.object({ date: IsoDateSchema.optional() });
const DaysQuery = z.object({ days: z.coerce.number().int().min(7).max(90).default(28) });

export async function nutritionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/v1/imports/cronometer', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = CronometerImportRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'expected { csv, fileName?, dryRun? }', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return importCronometerCsv(ctx.pool, user.userId, parsed.data);
  });

  app.get('/v1/nutrition/days', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const q = RangeQuery.safeParse(request.query ?? {});
    if (!q.success) return reply.code(400).send({ error: 'bad_request', message: 'from/to must be YYYY-MM-DD' });
    const profile = await ensureProfile(ctx.pool, ctx.config, user);
    const to = q.data.to ?? localDateOf(new Date(), null, profile.time_zone);
    const from = q.data.from ?? addDays(to, -27);
    if (from > to) return reply.code(400).send({ error: 'bad_request', message: 'from must not be after to' });
    return nutritionDays(ctx.pool, user.userId, from, to);
  });

  app.get('/v1/glucose/day', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const q = DayQuery.safeParse(request.query ?? {});
    if (!q.success) return reply.code(400).send({ error: 'bad_request', message: 'date must be YYYY-MM-DD' });
    await ensureProfile(ctx.pool, ctx.config, user);
    return glucoseDay(ctx.pool, user.userId, q.data.date ?? null);
  });

  app.get('/v1/glucose/repeated-meals', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const q = DaysQuery.safeParse(request.query ?? {});
    if (!q.success) return reply.code(400).send({ error: 'bad_request', message: 'days must be 7..90' });
    await ensureProfile(ctx.pool, ctx.config, user);
    return repeatedMealsReport(ctx.pool, user.userId, q.data.days);
  });

  app.get('/v1/annotations', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const q = RangeQuery.safeParse(request.query ?? {});
    if (!q.success) return reply.code(400).send({ error: 'bad_request', message: 'from/to must be YYYY-MM-DD' });
    const profile = await ensureProfile(ctx.pool, ctx.config, user);
    const to = q.data.to ?? localDateOf(new Date(), null, profile.time_zone);
    const from = q.data.from ?? addDays(to, -27);
    return { from, to, annotations: await listAnnotations(ctx.pool, user.userId, from, to) };
  });

  app.post('/v1/annotations', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = AnnotationInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid annotation', details: parsed.error.issues });
    if (parsed.data.endAt && Date.parse(parsed.data.endAt) < Date.parse(parsed.data.at)) return reply.code(400).send({ error: 'bad_request', message: 'endAt must not be before at' });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send(await createAnnotation(ctx.pool, user.userId, parsed.data));
  });

  app.delete('/v1/annotations/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = UuidSchema.safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid id' });
    await ensureProfile(ctx.pool, ctx.config, user);
    const ok = await deleteAnnotation(ctx.pool, user.userId, id.data);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'annotation not found' });
  });
}
