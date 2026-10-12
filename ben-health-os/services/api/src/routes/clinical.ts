import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AllergyInputSchema, ConditionInputSchema, LabImportRequestSchema, LabReviewRequestSchema, ManualLabResultInputSchema, MedicationInputSchema, PhysicianBriefRequestSchema, PreventiveCompleteSchema, PreventiveItemInputSchema, ReconcileRequestSchema, SupplementInputSchema, UuidSchema } from '@bho/contracts';
import { localDateOf } from '@bho/analytics';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import type { AuthenticatedUser } from '../auth/jwt.js';
import { withUser } from '../db/pool.js';
import { createManualLabResult, decideReviews, importLabFile, labsOverview, reviewQueue } from '../services/labs.js';
import { createCondition, deleteCondition, listClinicalRecords, updateCondition } from '../services/clinicalRecords.js';
import { createAllergy, createMedication, createSupplement, deleteAllergy, deleteMedication, deleteSupplement, medicationsOverview, reconcileMedications, updateMedication, updateSupplement } from '../services/medications.js';
import { completePreventive, createPreventive, deletePreventive, listPreventive, preventiveCalendar, updatePreventive } from '../services/preventive.js';
import { generatePhysicianBrief, getPhysicianBrief, listPhysicianBriefs } from '../services/brief.js';

function idParam(request: FastifyRequest, reply: FastifyReply): string | null {
  const id = UuidSchema.safeParse((request.params as { id: string }).id);
  if (!id.success) {
    void reply.code(400).send({ error: 'bad_request', message: 'invalid id' });
    return null;
  }
  return id.data;
}

export async function clinicalRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const storageDir = ctx.config.DOCUMENT_STORAGE_DIR;

  // ---- Labs
  app.post('/v1/imports/labs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = LabImportRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'expected { csv | pdfBase64, source?, fileName?, laboratory?, collectedAt?, dryRun? }', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return importLabFile(ctx.pool, user.userId, storageDir, parsed.data);
  });
  app.get('/v1/labs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return labsOverview(ctx.pool, user.userId);
  });
  app.get('/v1/labs/review', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return reviewQueue(ctx.pool, user.userId);
  });
  app.post('/v1/labs/review', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = LabReviewRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'expected { decisions: [{ id, action, corrections? }] }', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return decideReviews(ctx.pool, user.userId, parsed.data);
  });
  app.post('/v1/labs/results', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = ManualLabResultInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid lab result', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    const { result, created } = await createManualLabResult(ctx.pool, user.userId, parsed.data);
    return reply.code(created ? 201 : 200).send(result);
  });
  app.get('/v1/documents/:id/file', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    const doc = await withUser(ctx.pool, user.userId, (tx) => tx.query<{ storage_path: string | null; mime_type: string | null; title: string }>('select storage_path, mime_type, title from public.documents where user_id = $1 and id = $2', [user.userId, id]));
    const row = doc.rows[0];
    if (!row?.storage_path) return reply.code(404).send({ error: 'not_found', message: 'document not found' });
    const path = join(storageDir, row.storage_path);
    const info = await stat(path).catch(() => null);
    if (!info) return reply.code(404).send({ error: 'not_found', message: 'file missing from storage' });
    reply.header('content-type', row.mime_type ?? 'application/octet-stream');
    reply.header('content-length', String(info.size));
    reply.header('content-disposition', `inline; filename="${row.title.replace(/[^A-Za-z0-9._ -]/g, '_')}"`);
    return reply.send(createReadStream(path));
  });

  // ---- Clinical records
  app.get('/v1/clinical/records', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return listClinicalRecords(ctx.pool, user.userId);
  });
  app.post('/v1/clinical/conditions', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = ConditionInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid condition', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send({ id: await createCondition(ctx.pool, user.userId, parsed.data) });
  });
  app.patch('/v1/clinical/conditions/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    const parsed = ConditionInputSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid condition', details: parsed.error.issues });
    return (await updateCondition(ctx.pool, user.userId, id, parsed.data)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'condition not found' });
  });
  app.delete('/v1/clinical/conditions/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    return (await deleteCondition(ctx.pool, user.userId, id)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'condition not found' });
  });

  // ---- Medications, supplements, allergies
  app.get('/v1/medications', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return medicationsOverview(ctx.pool, user.userId);
  });
  app.post('/v1/medications', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = MedicationInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid medication', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send({ id: await createMedication(ctx.pool, user.userId, parsed.data) });
  });
  app.patch('/v1/medications/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    const parsed = MedicationInputSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid medication', details: parsed.error.issues });
    return (await updateMedication(ctx.pool, user.userId, id, parsed.data)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'medication not found' });
  });
  app.delete('/v1/medications/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    return (await deleteMedication(ctx.pool, user.userId, id)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'medication not found' });
  });
  app.post('/v1/medications/reconcile', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = ReconcileRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid reconciliation', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reconcileMedications(ctx.pool, user.userId, parsed.data);
  });
  app.post('/v1/supplements', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = SupplementInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid supplement', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send({ id: await createSupplement(ctx.pool, user.userId, parsed.data) });
  });
  app.patch('/v1/supplements/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    const parsed = SupplementInputSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid supplement', details: parsed.error.issues });
    return (await updateSupplement(ctx.pool, user.userId, id, parsed.data)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'supplement not found' });
  });
  app.delete('/v1/supplements/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    return (await deleteSupplement(ctx.pool, user.userId, id)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'supplement not found' });
  });
  app.post('/v1/allergies', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = AllergyInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid allergy', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send({ id: await createAllergy(ctx.pool, user.userId, parsed.data) });
  });
  app.delete('/v1/allergies/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    return (await deleteAllergy(ctx.pool, user.userId, id)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'allergy not found' });
  });

  // ---- Preventive care
  const todayFor = async (user: AuthenticatedUser) => {
    const profile = await ensureProfile(ctx.pool, ctx.config, user);
    return localDateOf(new Date(), null, profile.time_zone);
  };
  app.get('/v1/preventive', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return listPreventive(ctx.pool, user.userId, await todayFor(user));
  });
  app.get('/v1/preventive/calendar.ics', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const list = await listPreventive(ctx.pool, user.userId, await todayFor(user));
    reply.header('content-type', 'text/calendar; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="preventive-care.ics"');
    return reply.send(preventiveCalendar(list.items));
  });
  app.post('/v1/preventive', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = PreventiveItemInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'title, category and guidelineSource are required', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send({ id: await createPreventive(ctx.pool, user.userId, parsed.data) });
  });
  app.patch('/v1/preventive/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    const parsed = PreventiveItemInputSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid item', details: parsed.error.issues });
    return (await updatePreventive(ctx.pool, user.userId, id, parsed.data)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'item not found' });
  });
  app.post('/v1/preventive/:id/complete', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    const parsed = PreventiveCompleteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'completedAt (YYYY-MM-DD) required', details: parsed.error.issues });
    return (await completePreventive(ctx.pool, user.userId, id, parsed.data.completedAt, parsed.data.note ?? null)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'item not found' });
  });
  app.delete('/v1/preventive/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    return (await deletePreventive(ctx.pool, user.userId, id)) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found', message: 'item not found' });
  });

  // ---- Physician brief
  app.post('/v1/physician-brief', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = PhysicianBriefRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'reasonForVisit required', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    return reply.code(201).send(await generatePhysicianBrief(ctx.pool, user.userId, storageDir, parsed.data));
  });
  app.get('/v1/physician-brief', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    return { briefs: await listPhysicianBriefs(ctx.pool, user.userId) };
  });
  app.get('/v1/physician-brief/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    const brief = await getPhysicianBrief(ctx.pool, user.userId, id);
    return brief ?? reply.code(404).send({ error: 'not_found', message: 'brief not found' });
  });
  app.get('/v1/physician-brief/:id/pdf', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const id = idParam(request, reply);
    if (!id) return;
    const brief = await getPhysicianBrief(ctx.pool, user.userId, id);
    if (!brief?.pdfPath) return reply.code(404).send({ error: 'not_found', message: 'brief not found' });
    const path = join(storageDir, brief.pdfPath);
    const info = await stat(path).catch(() => null);
    if (!info) return reply.code(404).send({ error: 'not_found', message: 'PDF missing from storage' });
    reply.header('content-type', 'application/pdf');
    reply.header('content-length', String(info.size));
    reply.header('content-disposition', `inline; filename="physician-brief-${brief.generatedAt.slice(0, 10)}.pdf"`);
    return reply.send(createReadStream(path));
  });
  void z;
}
