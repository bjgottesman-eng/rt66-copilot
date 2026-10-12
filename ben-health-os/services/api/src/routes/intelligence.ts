import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { HealthMemoryInputSchema, HealthMemoryUpdateSchema, NotificationPrefsSchema, RecommendationUpdateSchema, ReportGenerateRequestSchema, UuidSchema } from '@bho/contracts';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { aiStatus, createMemory, deleteMemory, generateMonthlyReport, generateWeeklyReport, getNotificationPrefs, getReport, listAlerts, listMemories, listRecommendations, listReports, previewPacket, refreshAlerts, reportsJob, setNotificationPrefs, updateAlert, updateMemory, updateRecommendation } from '../services/intelligence.js';

export async function intelligenceRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const log = (m: string) => app.log.warn(m);
  // ---- Recommendations inbox
  app.get('/v1/recommendations', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    const status = (request.query as { status?: string }).status;
    return listRecommendations(ctx.pool, user.userId, status);
  });
  app.patch('/v1/recommendations/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = UuidSchema.safeParse((request.params as { id: string }).id);
    const body = RecommendationUpdateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'bad_request', message: 'status (and snoozedUntil / dismissReason) required', details: body.success ? [] : body.error.issues });
    if (body.data.status === 'SNOOZED' && !body.data.snoozedUntil) return reply.code(400).send({ error: 'bad_request', message: 'snoozedUntil is required to snooze' });
    const updated = await updateRecommendation(ctx.pool, user.userId, id.data, body.data);
    return updated ?? reply.code(404).send({ error: 'not_found', message: 'recommendation not found' });
  });
  // ---- Reports
  app.get('/v1/reports', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return { reports: await listReports(ctx.pool, user.userId) };
  });
  for (const kind of ['weekly', 'monthly'] as const) {
    app.post(`/v1/reports/${kind}`, async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const body = ReportGenerateRequestSchema.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid body', details: body.error.issues });
      await ensureProfile(ctx.pool, ctx.config, user);
      const report = kind === 'weekly' ? await generateWeeklyReport(ctx.pool, ctx.config, user.userId, body.data, new Date(), log) : await generateMonthlyReport(ctx.pool, ctx.config, user.userId, body.data, new Date(), log);
      return reply.code(201).send(report);
    });
    app.get(`/v1/reports/${kind}/:id`, async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const id = UuidSchema.safeParse((request.params as { id: string }).id);
      if (!id.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid id' });
      const report = await getReport(ctx.pool, user.userId, kind, id.data);
      return report ?? reply.code(404).send({ error: 'not_found', message: 'report not found' });
    });
  }
  app.get('/v1/ai/status', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return aiStatus(ctx.pool, ctx.config, user.userId);
  });
  app.get('/v1/analysis-packet', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const kind = (request.query as { kind?: string }).kind === 'monthly' ? 'monthly' : 'weekly';
    await ensureProfile(ctx.pool, ctx.config, user);
    return previewPacket(ctx.pool, ctx.config, user.userId, kind);
  });
  // ---- Alerts and notification preferences
  app.get('/v1/alerts', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    const q = request.query as { unread?: string; refresh?: string };
    if (q.refresh === '1') await refreshAlerts(ctx.pool, ctx.config, user.userId);
    return listAlerts(ctx.pool, user.userId, q.unread === '1');
  });
  app.patch('/v1/alerts/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = UuidSchema.safeParse((request.params as { id: string }).id);
    const body = z.object({ action: z.enum(['read', 'dismissed', 'delivered']) }).safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'bad_request', message: 'action read | dismissed | delivered' });
    return (await updateAlert(ctx.pool, user.userId, id.data, body.data.action)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'alert not found' });
  });
  app.get('/v1/notifications/prefs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return getNotificationPrefs(ctx.pool, user.userId);
  });
  app.patch('/v1/notifications/prefs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = NotificationPrefsSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid preferences', details: body.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    await setNotificationPrefs(ctx.pool, user.userId, body.data);
    return body.data;
  });
  // ---- Health memory
  app.get('/v1/memories', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return { memories: await listMemories(ctx.pool, user.userId, (request.query as { archived?: string }).archived === '1'), notes: ['Memories are labelled by origin (clinician-documented, device measurement, user-reported, derived calculation, AI hypothesis) and verification status. An AI hypothesis never becomes a fact by repetition; confirm, archive or delete each one.'] };
  });
  app.post('/v1/memories', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = HealthMemoryInputSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid memory', details: body.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send(await createMemory(ctx.pool, user.userId, body.data));
  });
  app.patch('/v1/memories/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = UuidSchema.safeParse((request.params as { id: string }).id);
    const body = HealthMemoryUpdateSchema.safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid update' });
    const m = await updateMemory(ctx.pool, user.userId, id.data, body.data);
    return m ?? reply.code(404).send({ error: 'not_found', message: 'memory not found' });
  });
  app.delete('/v1/memories/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = UuidSchema.safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid id' });
    return (await deleteMemory(ctx.pool, user.userId, id.data)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'memory not found' });
  });
  // ---- Scheduled job
  app.post('/internal/jobs/reports', async (request, reply) => {
    const secret = ctx.config.JOB_SECRET;
    if (!secret) return reply.code(503).send({ error: 'jobs_disabled', message: 'JOB_SECRET is not configured' });
    const given = Buffer.from(String(request.headers['x-job-secret'] ?? ''));
    const expected = Buffer.from(secret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return reply.code(401).send({ error: 'unauthorized' });
    const summary = await reportsJob(ctx.pool, ctx.config, new Date(), log);
    request.log.info(summary, 'reports job finished');
    return summary;
  });
}
