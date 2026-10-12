import type { FastifyInstance } from 'fastify';
import { ManualBloodPressureInputSchema, ManualBodyMeasurementInputSchema } from '@bho/contracts';
import { metricById } from '@bho/shared-config';
import { localDateOf, payloadHash, plausibilityFlags, timestampFlags } from '@bho/analytics';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { withUser } from '../db/pool.js';
import { bloodPressureSummary, createManualBloodPressure } from '../services/bp.js';
import { dedupPoint } from '../services/ingest.js';

export async function measurementRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/v1/measurements/blood-pressure', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = ManualBloodPressureInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid blood pressure entry', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    const { reading, created } = await createManualBloodPressure(ctx.pool, user.userId, parsed.data);
    return reply.code(created ? 201 : 200).send(reading);
  });

  app.get('/v1/blood-pressure/summary', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    await ensureProfile(ctx.pool, ctx.config, user);
    const days = Math.min(365, Math.max(7, Number((request.query as { days?: string }).days ?? 30) || 30));
    return bloodPressureSummary(ctx.pool, user.userId, new Date(), days);
  });

  app.post('/v1/measurements/body', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = ManualBodyMeasurementInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid body measurement', details: parsed.error.issues });
    await ensureProfile(ctx.pool, ctx.config, user);
    const input = parsed.data;
    const def = metricById(input.metricId)!;
    const nowIso = new Date().toISOString();
    const result = await withUser(ctx.pool, user.userId, async (tx) => {
      const existing = await tx.query<{ id: string }>(`select id from public.observations where user_id = $1 and connector = 'manual' and external_id = $2 and metric_id = $3`, [user.userId, input.clientEntryId, input.metricId]);
      if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
      const prof = await tx.query<{ time_zone: string }>('select time_zone from public.profiles where id = $1', [user.userId]);
      const localDate = localDateOf(input.measuredAt, null, prof.rows[0]?.time_zone ?? 'UTC');
      await tx.query(
        `insert into public.source_connections (user_id, connector, status, last_sync_attempt_at, last_successful_sync_at, last_sync_status) values ($1, 'manual', 'CONNECTED', $2, $2, 'SUCCESS')
         on conflict (user_id, connector) do update set status = 'CONNECTED', last_sync_attempt_at = excluded.last_sync_attempt_at, last_successful_sync_at = excluded.last_successful_sync_at, last_sync_status = 'SUCCESS'`,
        [user.userId, nowIso],
      );
      const payload = { kind: 'manual_body_measurement', ...input };
      const raw = await tx.query<{ id: string }>(
        `insert into public.raw_ingest_events (user_id, connector, external_id, record_type, original_time, payload, payload_hash, processing_status) values ($1, 'manual', $2, $3, $4, $5, $6, 'NORMALIZED') returning id`,
        [user.userId, input.clientEntryId, input.metricId, input.measuredAt, JSON.stringify(payload), payloadHash(payload)],
      );
      const flags = [...timestampFlags(input.measuredAt, nowIso), ...plausibilityFlags(input.metricId, input.value)];
      const ins = await tx.query<{ id: string }>(
        `insert into public.observations (user_id, metric_id, value, unit, measured_at, local_date, connector, external_id, raw_event_id, recording_method, quality_flags) values ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, 'MANUAL_ENTRY', $9) returning id`,
        [user.userId, input.metricId, input.value, def.unit, input.measuredAt, localDate, input.clientEntryId, raw.rows[0]!.id, flags],
      );
      await dedupPoint(tx, user.userId, ins.rows[0]!.id, input.metricId, input.measuredAt, input.value, 'manual', null);
      return { id: ins.rows[0]!.id, created: true, qualityFlags: flags };
    });
    return reply.code(result.created ? 201 : 200).send(result);
  });
}
