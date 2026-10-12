import type { FastifyInstance } from 'fastify';
import { AdherenceInputSchema, CheckInInputSchema, ExperimentInputSchema, ExperimentUpdateSchema, TrainingSetsInputSchema, UuidSchema } from '@bho/contracts';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { createExperiment, evaluateExperimentNow, getExperiment, listExperiments, recordAdherence, updateExperiment } from '../services/experiments.js';
import { addTrainingSets, createCheckIn, deleteCheckIn, deleteTrainingSet, listCheckIns, trainingOverview } from '../services/training.js';

const idOf = (request: { params: unknown }) => UuidSchema.safeParse((request.params as { id: string }).id);

export async function experimentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // ---- Experiments
  app.get('/v1/experiments', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return listExperiments(ctx.pool, user.userId);
  });
  app.post('/v1/experiments', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = ExperimentInputSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid experiment', details: body.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    try {
      return reply.code(201).send(await createExperiment(ctx.pool, user.userId, body.data));
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode) return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message });
      throw e;
    }
  });
  app.get('/v1/experiments/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idOf(request);
    if (!id.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid id' });
    return (await getExperiment(ctx.pool, user.userId, id.data)) ?? reply.code(404).send({ error: 'not_found', message: 'experiment not found' });
  });
  app.patch('/v1/experiments/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idOf(request);
    const body = ExperimentUpdateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'bad_request', message: 'action start | abandon | decide | extend_intervention', details: body.success ? [] : body.error.issues });
    try {
      return (await updateExperiment(ctx.pool, user.userId, id.data, body.data)) ?? reply.code(404).send({ error: 'not_found', message: 'experiment not found' });
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.statusCode === 409 ? 'conflict' : 'bad_request', message: err.message });
      throw e;
    }
  });
  app.post('/v1/experiments/:id/adherence', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idOf(request);
    const body = AdherenceInputSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'bad_request', message: 'date and adhered are required' });
    try {
      return (await recordAdherence(ctx.pool, user.userId, id.data, body.data)) ?? reply.code(404).send({ error: 'not_found', message: 'experiment not found or not started' });
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode) return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message });
      throw e;
    }
  });
  app.post('/v1/experiments/:id/evaluate', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idOf(request);
    if (!id.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid id' });
    return (await evaluateExperimentNow(ctx.pool, user.userId, id.data)) ?? reply.code(404).send({ error: 'not_found', message: 'experiment not found' });
  });
  // ---- Training
  app.get('/v1/training', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    const days = Math.min(365, Math.max(14, Number((request.query as { days?: string }).days ?? 56) || 56));
    return trainingOverview(ctx.pool, user.userId, days);
  });
  app.post('/v1/training/sets', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = TrainingSetsInputSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'sets[] with localDate, exercise, setIndex, reps, loadKg', details: body.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send({ sets: await addTrainingSets(ctx.pool, user.userId, body.data.sets) });
  });
  app.delete('/v1/training/sets/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idOf(request);
    if (!id.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid id' });
    return (await deleteTrainingSet(ctx.pool, user.userId, id.data)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'set not found' });
  });
  // ---- Check-ins
  app.get('/v1/checkins', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return listCheckIns(ctx.pool, user.userId);
  });
  app.post('/v1/checkins', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = CheckInInputSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'ratings must be integers 1–10 (pain 0–10)', details: body.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send(await createCheckIn(ctx.pool, user.userId, body.data));
  });
  app.delete('/v1/checkins/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idOf(request);
    if (!id.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid id' });
    return (await deleteCheckIn(ctx.pool, user.userId, id.data)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'check-in not found' });
  });
}
