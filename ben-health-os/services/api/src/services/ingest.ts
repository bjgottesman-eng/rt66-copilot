import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { ExternalRecordInput, HealthConnectIngestBatch, HealthConnectRecord, IngestResult, NormalizedRecord } from '@bho/contracts';
import { DEDUP_WINDOWS, HEALTH_CONNECT_ORIGINS, metricById, priorityRank } from '@bho/shared-config';
import { findIntervalDuplicate, findPointDuplicate, payloadHash, resolveDailySteps } from '@bho/analytics';
import { withUser, type Tx } from '../db/pool.js';
import { normalizeHealthConnectRecord } from './normalize.js';

const HC = 'health_connect';
const ACTIVITY_METRICS = new Set(['steps', 'distance_m', 'active_calories', 'exercise_minutes', 'resistance_sessions']);

export interface IngestCounters {
  inserted: number;
  updated: number;
  unchangedDuplicates: number;
  crossSourceDuplicates: number;
  deleted: number;
  rejected: Array<{ index: number; hcId?: string; reason: string }>;
}

export interface PersistContext {
  tx: Tx;
  userId: string;
  connector: string;
  connectionId: string;
  runId: string;
  nowIso: string;
  counters: IngestCounters;
  affectedDates: Set<string>;
  /** Local dates whose meals changed: same-day nutrition dedup + nutrition_days rollup run afterwards. */
  mealDates: Set<string>;
  deviceCache: Map<string, string>;
}

export function newCounters(): IngestCounters {
  return { inserted: 0, updated: 0, unchangedDuplicates: 0, crossSourceDuplicates: 0, deleted: 0, rejected: [] };
}

function hcDeviceLabel(origin: string, device: HealthConnectRecord['device']): string {
  const friendly = HEALTH_CONNECT_ORIGINS[origin]?.label ?? origin;
  const model = device?.model ? ` ${device.model}` : '';
  return `${friendly}${model}`.trim();
}

export async function upsertDevice(tx: Tx, userId: string, connectionId: string, connector: string, externalDeviceId: string, label: string, device: { manufacturer?: string | null; model?: string | null; type?: string | null } | null, seenAt: string, cache: Map<string, string>): Promise<string> {
  const cacheKey = `${connector}|${externalDeviceId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const res = await tx.query<{ id: string }>(
    `insert into public.source_devices (user_id, connection_id, connector, external_device_id, label, manufacturer, model, device_type, first_seen_at, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     on conflict (user_id, connector, external_device_id) do update set last_seen_at = greatest(public.source_devices.last_seen_at, excluded.last_seen_at), label = excluded.label, connection_id = excluded.connection_id
     returning id`,
    [userId, connectionId, connector, externalDeviceId, label, device?.manufacturer ?? null, device?.model ?? null, device?.type != null ? String(device.type) : null, seenAt],
  );
  cache.set(cacheKey, res.rows[0]!.id);
  return res.rows[0]!.id;
}

async function upsertObservations(ctx: PersistContext, rec: ExternalRecordInput, rawId: string, deviceId: string | null, groupId: string | null, n: NormalizedRecord): Promise<Array<{ id: string; metricId: string; measuredAt: string; value: number; localDate: string }>> {
  const out: Array<{ id: string; metricId: string; measuredAt: string; value: number; localDate: string }> = [];
  for (const o of n.observations) {
    const res = await ctx.tx.query<{ id: string }>(
      `insert into public.observations (user_id, metric_id, value, unit, measured_at, start_at, end_at, local_date, zone_offset, connector, data_origin, device_id, external_id, raw_event_id, group_id, recording_method, quality_flags, source_modified_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       on conflict (user_id, connector, external_id, metric_id) do update set
         value = excluded.value, unit = excluded.unit, measured_at = excluded.measured_at, start_at = excluded.start_at, end_at = excluded.end_at,
         local_date = excluded.local_date, zone_offset = excluded.zone_offset, data_origin = excluded.data_origin, device_id = excluded.device_id,
         raw_event_id = excluded.raw_event_id, group_id = coalesce(public.observations.group_id, excluded.group_id), recording_method = excluded.recording_method,
         quality_flags = excluded.quality_flags, source_modified_at = excluded.source_modified_at, deleted_at = null
       returning id`,
      [ctx.userId, o.metricId, o.value, o.unit, o.measuredAt, o.startAt, o.endAt, o.localDate, o.zoneOffset, ctx.connector, rec.dataOrigin, deviceId, o.externalId, rawId, groupId, rec.recordingMethod, o.qualityFlags, rec.sourceModifiedAt],
    );
    out.push({ id: res.rows[0]!.id, metricId: o.metricId, measuredAt: o.measuredAt, value: o.value, localDate: o.localDate });
  }
  return out;
}

/** Cross-source dedup for a single point observation; returns 1 when a duplicate link was made. */
export async function dedupPoint(tx: Tx, userId: string, obsId: string, metricId: string, measuredAt: string, value: number, connector: string, dataOrigin: string | null, companions?: Record<string, number>): Promise<number> {
  const metric = metricById(metricId);
  if (!metric) return 0;
  const windowSeconds = DEDUP_WINDOWS[metric.metricClass]?.windowSeconds ?? 0;
  if (windowSeconds <= 0) return 0;
  const t = new Date(measuredAt).getTime();
  const from = new Date(t - windowSeconds * 1000).toISOString();
  const to = new Date(t + windowSeconds * 1000).toISOString();
  const cands = await tx.query<{ id: string; connector: string; data_origin: string | null; measured_at: Date; value: number; group_id: string | null }>(
    `select id, connector, data_origin, measured_at, value, group_id from public.observations
     where user_id = $1 and metric_id = $2 and canonical and deleted_at is null and id <> $3 and measured_at between $4 and $5`,
    [userId, metricId, obsId, from, to],
  );
  const existing = [] as Array<{ id: string; connector: string; dataOrigin: string | null; measuredAt: string; value: number; companions?: Record<string, number> }>;
  for (const c of cands.rows) {
    let comp: Record<string, number> | undefined;
    if (companions && c.group_id) {
      const sib = await tx.query<{ metric_id: string; value: number }>('select metric_id, value from public.observations where group_id = $1 and id <> $2 and metric_id = any($3)', [c.group_id, c.id, Object.keys(companions)]);
      comp = Object.fromEntries(sib.rows.map((s) => [s.metric_id, Number(s.value)]));
    }
    existing.push({ id: c.id, connector: c.connector, dataOrigin: c.data_origin, measuredAt: new Date(c.measured_at).toISOString(), value: Number(c.value), companions: comp });
  }
  const decision = findPointDuplicate({ id: obsId, connector, dataOrigin, measuredAt, value, companions }, existing, metric.metricClass);
  if (!decision) return 0;
  await tx.query(
    `update public.observations set canonical = false, duplicate_of = $2, duplicate_reason = $3
     where id = $1 or (group_id is not null and group_id = (select group_id from public.observations where id = $1))`,
    [decision.duplicate.id, decision.canonical.id, decision.reason],
  );
  await tx.query(
    `update public.observations set canonical = true, duplicate_of = null, duplicate_reason = null
     where id = $1 or (group_id is not null and group_id = (select group_id from public.observations where id = $1))`,
    [decision.canonical.id],
  );
  await tx.query(
    `update public.blood_pressure_readings b set canonical = o.canonical, duplicate_of = (select b2.id from public.blood_pressure_readings b2 join public.observations o2 on o2.group_id = b2.id where o2.id = o.duplicate_of limit 1), duplicate_reason = o.duplicate_reason
     from public.observations o where o.group_id = b.id and o.id in ($1, $2) and b.user_id = $3`,
    [decision.duplicate.id, decision.canonical.id, userId],
  );
  return 1;
}

async function dedupInterval(ctx: PersistContext, table: 'sleep_sessions' | 'workouts', id: string, dataOrigin: string | null, startAt: string, endAt: string, metricClass: 'sleep' | 'workout', windowHours: number): Promise<void> {
  const cands = await ctx.tx.query<{ id: string; connector: string; data_origin: string | null; start_at: Date; end_at: Date }>(
    `select id, connector, data_origin, start_at, end_at from public.${table} where user_id = $1 and canonical and deleted_at is null and id <> $2 and start_at between $3::timestamptz - make_interval(hours => $4) and $3::timestamptz + make_interval(hours => $4)`,
    [ctx.userId, id, startAt, windowHours],
  );
  const d = findIntervalDuplicate({ id, connector: ctx.connector, dataOrigin, startAt, endAt }, cands.rows.map((c) => ({ id: c.id, connector: c.connector, dataOrigin: c.data_origin, startAt: new Date(c.start_at).toISOString(), endAt: new Date(c.end_at).toISOString() })), metricClass);
  if (!d) return;
  await ctx.tx.query(`update public.${table} set canonical = false, duplicate_of = $2, duplicate_reason = $3 where id = $1`, [d.duplicate.id, d.canonical.id, d.reason]);
  await ctx.tx.query(`update public.${table} set canonical = true, duplicate_of = null, duplicate_reason = null where id = $1`, [d.canonical.id]);
  await ctx.tx.query(`update public.observations o set canonical = s.canonical, duplicate_of = null, duplicate_reason = s.duplicate_reason from public.${table} s where o.group_id = s.id and s.id in ($1, $2)`, [d.duplicate.id, d.canonical.id]);
  ctx.counters.crossSourceDuplicates++;
}

/** Persists one external record: immutable raw event, typed rows, observations, dedup. */
export async function persistRecord(ctx: PersistContext, rec: ExternalRecordInput, index: number, existing: Map<string, { id: string; payload_hash: string; processing_status: string }>): Promise<void> {
  const { tx, userId, connector } = ctx;
  const hash = payloadHash(rec.rawPayload);
  const prev = existing.get(rec.externalId);
  if (prev && prev.payload_hash === hash && prev.processing_status !== 'DELETED') {
    ctx.counters.unchangedDuplicates++;
    return;
  }
  const sp = `rec_${index}`;
  await tx.query(`savepoint ${sp}`);
  try {
    const deviceId = rec.device ? await upsertDevice(tx, userId, ctx.connectionId, connector, rec.device.externalId, rec.device.label, rec.device, rec.sourceModifiedAt ?? ctx.nowIso, ctx.deviceCache) : null;
    const raw = await tx.query<{ id: string }>(
      `insert into public.raw_ingest_events (user_id, connector, external_id, source_user_id, device_id, record_type, original_time, original_end_time, original_zone_offset, source_modified_at, payload, payload_hash, parser_version, processing_status, sync_run_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, 'RECEIVED', $13) returning id`,
      [userId, connector, rec.externalId, rec.sourceUserId ?? null, deviceId, rec.recordType, rec.originalTime, rec.originalEndTime ?? null, rec.originalZoneOffset ?? null, rec.sourceModifiedAt, JSON.stringify(rec.rawPayload), hash, ctx.runId],
    );
    const rawId = raw.rows[0]!.id;
    if (prev) await tx.query(`update public.raw_ingest_events set processing_status = 'SUPERSEDED', superseded_by = $2 where id = $1`, [prev.id, rawId]);

    const n = rec.normalized;
    let groupId: string | null = null;
    const deferred: Array<() => Promise<void>> = [];

    if (n.bp) {
      const bp = n.bp;
      const res = await tx.query<{ id: string }>(
        `insert into public.blood_pressure_readings (user_id, measured_at, local_date, zone_offset, systolic, diastolic, pulse, connector, data_origin, device_id, external_id, raw_event_id, recording_method, source_attrib, quality_flags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         on conflict (user_id, connector, external_id) do update set measured_at = excluded.measured_at, local_date = excluded.local_date, zone_offset = excluded.zone_offset, systolic = excluded.systolic, diastolic = excluded.diastolic,
           pulse = coalesce(excluded.pulse, public.blood_pressure_readings.pulse), data_origin = excluded.data_origin, device_id = excluded.device_id, raw_event_id = excluded.raw_event_id, quality_flags = excluded.quality_flags, deleted_at = null
         returning id`,
        [userId, bp.measuredAt, bp.localDate, bp.zoneOffset, bp.systolic, bp.diastolic, bp.pulse ?? null, connector, rec.dataOrigin, deviceId, bp.externalId, rawId, rec.recordingMethod, `${connector}:${rec.recordingMethod}${bp.bodyPosition != null ? `;pos=${bp.bodyPosition}` : ''}`, bp.qualityFlags],
      );
      groupId = res.rows[0]!.id;
    }
    if (n.sleep) {
      const s = n.sleep;
      const res = await tx.query<{ id: string }>(
        `insert into public.sleep_sessions (user_id, start_at, end_at, start_zone_offset, end_zone_offset, local_date, duration_min, time_in_bed_min, efficiency, deep_min, light_min, rem_min, awake_min, title, notes, connector, data_origin, device_id, external_id, raw_event_id, recording_method, quality_flags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         on conflict (user_id, connector, external_id) do update set start_at = excluded.start_at, end_at = excluded.end_at, start_zone_offset = excluded.start_zone_offset, end_zone_offset = excluded.end_zone_offset, local_date = excluded.local_date,
           duration_min = excluded.duration_min, time_in_bed_min = excluded.time_in_bed_min, efficiency = excluded.efficiency, deep_min = excluded.deep_min, light_min = excluded.light_min, rem_min = excluded.rem_min, awake_min = excluded.awake_min,
           title = excluded.title, notes = excluded.notes, data_origin = excluded.data_origin, device_id = excluded.device_id, raw_event_id = excluded.raw_event_id, quality_flags = excluded.quality_flags, deleted_at = null
         returning id`,
        [userId, s.startAt, s.endAt, s.startZoneOffset, s.endZoneOffset, s.localDate, s.durationMin, s.timeInBedMin, s.efficiency, s.deepMin, s.lightMin, s.remMin, s.awakeMin, s.title, s.notes, connector, rec.dataOrigin, deviceId, s.externalId, rawId, rec.recordingMethod, s.qualityFlags],
      );
      groupId = res.rows[0]!.id;
      const sleepId = groupId;
      await tx.query('delete from public.sleep_stages where session_id = $1', [sleepId]);
      for (const st of s.stages) await tx.query('insert into public.sleep_stages (user_id, session_id, start_at, end_at, stage) values ($1, $2, $3, $4, $5)', [userId, sleepId, st.startAt, st.endAt, st.stage]);
      deferred.push(() => dedupInterval(ctx, 'sleep_sessions', sleepId, rec.dataOrigin, s.startAt, s.endAt, 'sleep', 36));
    }
    if (n.workout) {
      const w = n.workout;
      const res = await tx.query<{ id: string }>(
        `insert into public.workouts (user_id, start_at, end_at, local_date, duration_min, exercise_type, exercise_type_name, category, title, notes, calories_kcal, distance_m, avg_heart_rate, segments, connector, data_origin, device_id, external_id, raw_event_id, recording_method, quality_flags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         on conflict (user_id, connector, external_id) do update set start_at = excluded.start_at, end_at = excluded.end_at, local_date = excluded.local_date, duration_min = excluded.duration_min, exercise_type = excluded.exercise_type, exercise_type_name = excluded.exercise_type_name,
           category = excluded.category, title = excluded.title, notes = excluded.notes, calories_kcal = excluded.calories_kcal, distance_m = excluded.distance_m, avg_heart_rate = excluded.avg_heart_rate, segments = excluded.segments,
           data_origin = excluded.data_origin, device_id = excluded.device_id, raw_event_id = excluded.raw_event_id, quality_flags = excluded.quality_flags, deleted_at = null
         returning id`,
        [userId, w.startAt, w.endAt, w.localDate, w.durationMin, w.exerciseType, w.exerciseTypeName, w.category, w.title, w.notes, w.caloriesKcal ?? null, w.distanceM ?? null, w.avgHeartRate ?? null, w.segments ? JSON.stringify(w.segments) : null, connector, rec.dataOrigin, deviceId, w.externalId, rawId, rec.recordingMethod, w.qualityFlags],
      );
      groupId = res.rows[0]!.id;
      const workoutId = groupId;
      deferred.push(() => dedupInterval(ctx, 'workouts', workoutId, rec.dataOrigin, w.startAt, w.endAt, 'workout', 6));
      ctx.affectedDates.add(w.localDate);
    }
    if (n.meal) {
      const m = n.meal;
      const res = await tx.query<{ id: string }>(
        `insert into public.meals (user_id, eaten_at, end_at, local_date, meal_type, name, energy_kcal, protein_g, carbs_g, fat_g, saturated_fat_g, fiber_g, sodium_mg, potassium_mg, sugar_g, nutrients, connector, data_origin, external_id, raw_event_id, food_items, quality_flags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         on conflict (user_id, connector, external_id) do update set eaten_at = excluded.eaten_at, end_at = excluded.end_at, local_date = excluded.local_date, meal_type = excluded.meal_type, name = excluded.name, energy_kcal = excluded.energy_kcal, protein_g = excluded.protein_g,
           carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, saturated_fat_g = excluded.saturated_fat_g, fiber_g = excluded.fiber_g, sodium_mg = excluded.sodium_mg, potassium_mg = excluded.potassium_mg, sugar_g = excluded.sugar_g, nutrients = excluded.nutrients,
           data_origin = excluded.data_origin, raw_event_id = excluded.raw_event_id, food_items = excluded.food_items, quality_flags = excluded.quality_flags, deleted_at = null
         returning id, (xmax = 0) as inserted`,
        [userId, m.eatenAt, m.endAt, m.localDate, m.mealType, m.name, m.energyKcal, m.proteinG, m.carbsG, m.fatG, m.saturatedFatG, m.fiberG, m.sodiumMg, m.potassiumMg, m.sugarG, JSON.stringify(m.nutrients), connector, rec.dataOrigin, m.externalId, rawId, JSON.stringify(m.foodItems ?? []), m.qualityFlags ?? []],
      );
      groupId = res.rows[0]!.id;
      ctx.mealDates.add(m.localDate);
      if (prev) {
        // a re-import may move a meal to another day: that day's rollup must be recomputed too
        const moved = await tx.query<{ local_date: string }>(`select distinct local_date::text as local_date from public.nutrition_days where user_id = $1 and local_date <> $2 and local_date in (select local_date from public.meals where id = $3)`, [userId, m.localDate, groupId]);
        for (const row of moved.rows) ctx.mealDates.add(row.local_date);
      }
      await tx.query('delete from public.nutrient_observations where meal_id = $1', [groupId]);
      for (const [nutrient, value] of Object.entries(m.nutrients)) await tx.query('insert into public.nutrient_observations (user_id, meal_id, local_date, nutrient, value, unit) values ($1, $2, $3, $4, $5, $6)', [userId, groupId, m.localDate, nutrient, value, 'unknown']);
    }
    if (n.glucose) {
      const g = n.glucose;
      const res = await tx.query<{ id: string }>(
        `insert into public.glucose_samples (user_id, measured_at, local_date, mg_dl, specimen_source, meal_relation, connector, data_origin, device_id, external_id, raw_event_id, quality_flags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (user_id, connector, external_id) do update set measured_at = excluded.measured_at, local_date = excluded.local_date, mg_dl = excluded.mg_dl, specimen_source = excluded.specimen_source, meal_relation = excluded.meal_relation,
           data_origin = excluded.data_origin, device_id = excluded.device_id, raw_event_id = excluded.raw_event_id, quality_flags = excluded.quality_flags, deleted_at = null
         returning id`,
        [userId, g.measuredAt, g.localDate, g.mgDl, g.specimenSource, g.mealRelation, connector, rec.dataOrigin, deviceId, g.externalId, rawId, g.qualityFlags],
      );
      groupId = res.rows[0]!.id;
    }

    const written = await upsertObservations(ctx, rec, rawId, deviceId, groupId, n);
    for (const run of deferred) await run();
    for (const o of written) {
      if (ACTIVITY_METRICS.has(o.metricId)) ctx.affectedDates.add(o.localDate);
      if (n.bp && o.metricId === 'blood_pressure_systolic') {
        ctx.counters.crossSourceDuplicates += await dedupPoint(tx, userId, o.id, o.metricId, o.measuredAt, o.value, connector, rec.dataOrigin, { blood_pressure_diastolic: n.bp.diastolic });
      } else if (!n.bp && !n.sleep && !n.workout) {
        ctx.counters.crossSourceDuplicates += await dedupPoint(tx, userId, o.id, o.metricId, o.measuredAt, o.value, connector, rec.dataOrigin);
      }
    }
    await tx.query(`update public.raw_ingest_events set processing_status = 'NORMALIZED', processing_error = $2 where id = $1`, [rawId, n.notes.length ? n.notes.join('; ') : null]);
    await tx.query(`release savepoint ${sp}`);
    if (prev) ctx.counters.updated++;
    else ctx.counters.inserted++;
  } catch (e) {
    await tx.query(`rollback to savepoint ${sp}`);
    ctx.counters.rejected.push({ index, hcId: rec.externalId, reason: (e as Error).message.slice(0, 300) });
  }
}

export async function persistRecords(ctx: PersistContext, records: ExternalRecordInput[]): Promise<void> {
  const ids = records.map((r) => r.externalId);
  const existingRows = await ctx.tx.query<{ id: string; external_id: string; payload_hash: string; processing_status: string }>(
    `select distinct on (external_id) id, external_id, payload_hash, processing_status from public.raw_ingest_events
     where user_id = $1 and connector = $2 and external_id = any($3) and processing_status <> 'SUPERSEDED' order by external_id, ingested_at desc`,
    [ctx.userId, ctx.connector, ids],
  );
  const existing = new Map(existingRows.rows.map((r) => [r.external_id, r]));
  for (let i = 0; i < records.length; i++) await persistRecord(ctx, records[i]!, i, existing);
}

/** Soft-deletes everything linked to an external id (Health Connect only reports the id). */
export async function softDelete(ctx: PersistContext, externalId: string): Promise<boolean> {
  const { tx, userId, connector } = ctx;
  const r1 = await tx.query<{ local_date: Date; metric_id: string }>(`update public.observations set deleted_at = now() where user_id = $1 and connector = $2 and deleted_at is null and (external_id = $3 or external_id like $3 || '#%') returning local_date, metric_id`, [userId, connector, externalId]);
  for (const row of r1.rows) if (ACTIVITY_METRICS.has(row.metric_id)) ctx.affectedDates.add(new Date(row.local_date).toISOString().slice(0, 10));
  for (const table of ['blood_pressure_readings', 'sleep_sessions', 'workouts', 'meals', 'glucose_samples']) {
    const r = await tx.query<{ local_date: Date }>(`update public.${table} set deleted_at = now() where user_id = $1 and connector = $2 and external_id = $3 and deleted_at is null returning local_date`, [userId, connector, externalId]);
    if (table === 'meals') for (const row of r.rows) ctx.mealDates.add(new Date(row.local_date).toISOString().slice(0, 10));
  }
  const r2 = await tx.query(`update public.raw_ingest_events set processing_status = 'DELETED' where user_id = $1 and connector = $2 and external_id = $3 and processing_status <> 'SUPERSEDED' returning id`, [userId, connector, externalId]);
  return (r1.rowCount ?? 0) > 0 || (r2.rowCount ?? 0) > 0;
}

/** Cuffs that write pulse as a separate heart-rate record: attach it to the reading from the same origin within 90 s. */
export async function attachCuffPulse(tx: Tx, userId: string): Promise<void> {
  await tx.query(
    `update public.blood_pressure_readings b set pulse = o.value from public.observations o
     where b.user_id = $1 and b.pulse is null and o.user_id = b.user_id and o.metric_id = 'heart_rate' and o.data_origin is not distinct from b.data_origin and o.deleted_at is null
       and o.measured_at between b.measured_at - interval '90 seconds' and b.measured_at + interval '90 seconds'`,
    [userId],
  );
}

export async function recomputeDailyActivity(tx: Tx, userId: string, dates: Set<string>): Promise<void> {
  for (const localDate of dates) {
    const steps = await tx.query<{ connector: string; data_origin: string | null; steps: number }>(
      `select connector, data_origin, sum(value)::float8 as steps from public.observations where user_id = $1 and metric_id = 'steps' and local_date = $2 and deleted_at is null and not ('IMPLAUSIBLE_VALUE' = any(quality_flags)) group by connector, data_origin`,
      [userId, localDate],
    );
    const chosen = resolveDailySteps(steps.rows.map((r) => ({ connector: r.connector, dataOrigin: r.data_origin, steps: Number(r.steps) })));
    const single = async (metric: string) => {
      const r = await tx.query<{ connector: string; data_origin: string | null; total: number }>(
        `select connector, data_origin, sum(value)::float8 as total from public.observations where user_id = $1 and metric_id = $2 and local_date = $3 and deleted_at is null group by connector, data_origin`,
        [userId, metric, localDate],
      );
      if (r.rows.length === 0) return null;
      const best = resolveDailySteps(r.rows.map((x) => ({ connector: x.connector, dataOrigin: x.data_origin, steps: Number(x.total) })));
      return best?.steps ?? null;
    };
    const distance = await single('distance_m');
    const activeCal = await single('active_calories');
    const workouts = await tx.query<{ minutes: number; resistance: number }>(
      `select coalesce(sum(duration_min),0)::float8 as minutes, count(*) filter (where category = 'RESISTANCE')::int as resistance from public.workouts where user_id = $1 and local_date = $2 and canonical and deleted_at is null`,
      [userId, localDate],
    );
    const w = workouts.rows[0]!;
    const hasAnything = chosen || distance !== null || activeCal !== null || Number(w.minutes) > 0;
    if (!hasAnything) {
      await tx.query('delete from public.daily_activity where user_id = $1 and local_date = $2', [userId, localDate]);
      continue;
    }
    await tx.query(
      `insert into public.daily_activity (user_id, local_date, steps, steps_source, distance_m, active_calories, exercise_minutes, resistance_sessions, contributing_origins, algorithm_version, computed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, now())
       on conflict (user_id, local_date) do update set steps = excluded.steps, steps_source = excluded.steps_source, distance_m = excluded.distance_m, active_calories = excluded.active_calories,
         exercise_minutes = excluded.exercise_minutes, resistance_sessions = excluded.resistance_sessions, contributing_origins = excluded.contributing_origins, computed_at = now()`,
      [userId, localDate, chosen?.steps ?? null, chosen?.source ?? null, distance, activeCal, Number(w.minutes) > 0 ? Number(w.minutes) : null, w.resistance, JSON.stringify(chosen?.alternates ?? [])],
    );
  }
}

/**
 * Same-day nutrition dedup across sources. Two apps describing the same diary (Cronometer CSV and the
 * Cronometer app via Health Connect) are never summed: the highest-priority source for the local day is
 * canonical and every other source's meals are linked as duplicates. A daily-summary row from the same
 * source as itemised meals is likewise linked rather than added. Nothing is deleted.
 */
export async function dedupMealsByDay(tx: Tx, userId: string, dates: Set<string>): Promise<number> {
  let linked = 0;
  for (const date of dates) {
    const rows = await tx.query<{ id: string; connector: string; data_origin: string | null; meal_type: string | null; canonical: boolean; duplicate_of: string | null; duplicate_reason: string | null }>(
      'select id, connector, data_origin, meal_type, canonical, duplicate_of, duplicate_reason from public.meals where user_id = $1 and local_date = $2 and deleted_at is null order by eaten_at, id',
      [userId, date],
    );
    if (rows.rows.length === 0) continue;
    const ranked = rows.rows.map((r) => ({ ...r, rank: priorityRank('nutrition', r.connector, r.data_origin) }));
    const best = Math.min(...ranked.map((r) => r.rank));
    const winners = ranked.filter((r) => r.rank === best);
    const itemised = winners.find((r) => r.meal_type !== 'DAILY_SUMMARY');
    for (const r of ranked) {
      let canonical = true;
      let reason: string | null = null;
      let dupOf: string | null = null;
      if (r.rank > best) {
        canonical = false;
        dupOf = winners[0]!.id;
        reason = `SAME_DAY_NUTRITION_SOURCE:${winners[0]!.connector}${winners[0]!.data_origin ? `:${winners[0]!.data_origin}` : ''}`;
      } else if (r.meal_type === 'DAILY_SUMMARY' && itemised) {
        canonical = false;
        dupOf = itemised.id;
        reason = 'DAILY_SUMMARY_OF_ITEMISED_MEALS';
      }
      if (r.canonical === canonical && (r.duplicate_reason ?? null) === reason && (r.duplicate_of ?? null) === dupOf) continue;
      await tx.query('update public.meals set canonical = $2, duplicate_of = $3, duplicate_reason = $4 where id = $1', [r.id, canonical, dupOf, reason]);
      await tx.query('update public.observations set canonical = $2, duplicate_of = null, duplicate_reason = $3 where user_id = $4 and group_id = $1', [r.id, canonical, reason, userId]);
      if (!canonical) linked++;
    }
  }
  return linked;
}

/** nutrition_days rollup (algorithm_version 1): sums of canonical meals per local day; absent when nothing was logged. */
export async function recomputeNutritionDays(tx: Tx, userId: string, dates: Set<string>): Promise<void> {
  for (const date of dates) {
    const agg = await tx.query<{ meals_count: number; energy_kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; saturated_fat_g: number | null; fiber_g: number | null; sodium_mg: number | null; potassium_mg: number | null; source: string | null; complete: boolean | null }>(
      `select count(*)::int as meals_count, sum(energy_kcal)::float8 as energy_kcal, sum(protein_g)::float8 as protein_g, sum(carbs_g)::float8 as carbs_g, sum(fat_g)::float8 as fat_g,
              sum(saturated_fat_g)::float8 as saturated_fat_g, sum(fiber_g)::float8 as fiber_g, sum(sodium_mg)::float8 as sodium_mg, sum(potassium_mg)::float8 as potassium_mg,
              string_agg(distinct connector || coalesce(':' || data_origin, ''), ',') as source, bool_or('DAY_MARKED_COMPLETE' = any(quality_flags)) as complete
       from public.meals where user_id = $1 and local_date = $2 and canonical and deleted_at is null`,
      [userId, date],
    );
    const a = agg.rows[0]!;
    if (!a.meals_count) {
      await tx.query('delete from public.nutrition_days where user_id = $1 and local_date = $2', [userId, date]);
      continue;
    }
    await tx.query(
      `insert into public.nutrition_days (user_id, local_date, energy_kcal, protein_g, carbs_g, fat_g, saturated_fat_g, fiber_g, sodium_mg, potassium_mg, meals_count, source, complete, algorithm_version, computed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, now())
       on conflict (user_id, local_date) do update set energy_kcal = excluded.energy_kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, saturated_fat_g = excluded.saturated_fat_g,
         fiber_g = excluded.fiber_g, sodium_mg = excluded.sodium_mg, potassium_mg = excluded.potassium_mg, meals_count = excluded.meals_count, source = excluded.source, complete = excluded.complete, algorithm_version = 1, computed_at = now()`,
      [userId, date, a.energy_kcal, a.protein_g, a.carbs_g, a.fat_g, a.saturated_fat_g, a.fiber_g, a.sodium_mg, a.potassium_mg, a.meals_count, a.source, a.complete ?? false],
    );
  }
}

/** Post-persist nutrition housekeeping shared by every ingest path. */
export async function finalizeMeals(ctx: PersistContext): Promise<void> {
  if (ctx.mealDates.size === 0) return;
  ctx.counters.crossSourceDuplicates += await dedupMealsByDay(ctx.tx, ctx.userId, ctx.mealDates);
  await recomputeNutritionDays(ctx.tx, ctx.userId, ctx.mealDates);
}

export interface ConnectorIngestOptions {
  mode: string;
  /** Records to persist (already normalized by the connector). */
  records: ExternalRecordInput[];
  /** External ids reported deleted by the source. */
  deletions?: string[];
  /** Updates to source_connections after the run (e.g. cursors are stored separately). */
  cursors?: Record<string, string>;
  /** Called inside the transaction before the run finalizes. */
  afterPersist?: (tx: Tx) => Promise<void>;
  runDetails?: Record<string, unknown>;
}

/** Generic ingest for any connector (Oura, Withings, imports): one transaction, one sync run. */
export async function ingestConnectorRecords(pool: pg.Pool, userId: string, connector: string, opts: ConnectorIngestOptions, now: Date = new Date()): Promise<IngestResult> {
  const nowIso = now.toISOString();
  const counters = newCounters();
  const batchId = randomUUID();
  return withUser(pool, userId, async (tx) => {
    const conn = await tx.query<{ id: string }>(
      `insert into public.source_connections (user_id, connector, status, last_sync_attempt_at, last_sync_status)
       values ($1, $2, 'PENDING_AUTH', $3, 'RUNNING')
       on conflict (user_id, connector) do update set last_sync_attempt_at = excluded.last_sync_attempt_at, last_sync_status = 'RUNNING'
       returning id`,
      [userId, connector, nowIso],
    );
    const connectionId = conn.rows[0]!.id;
    await tx.query(`insert into public.sync_runs (id, user_id, connection_id, connector, mode, started_at, status, records_received) values ($1, $2, $3, $4, $5, $6, 'RUNNING', $7)`, [batchId, userId, connectionId, connector, opts.mode, nowIso, opts.records.length]);
    const ctx: PersistContext = { tx, userId, connector, connectionId, runId: batchId, nowIso, counters, affectedDates: new Set(), mealDates: new Set(), deviceCache: new Map() };
    await persistRecords(ctx, opts.records);
    for (const id of opts.deletions ?? []) if (await softDelete(ctx, id)) counters.deleted++;
    await attachCuffPulse(tx, userId);
    await recomputeDailyActivity(tx, userId, ctx.affectedDates);
    await finalizeMeals(ctx);
    for (const [scope, cursor] of Object.entries(opts.cursors ?? {})) {
      await tx.query(
        `insert into public.sync_cursors (user_id, connection_id, scope, cursor, cursor_time) values ($1, $2, $3, $4, now())
         on conflict (user_id, scope) do update set cursor = excluded.cursor, cursor_time = now(), updated_at = now(), connection_id = excluded.connection_id`,
        [userId, connectionId, scope, cursor],
      );
    }
    if (opts.afterPersist) await opts.afterPersist(tx);
    const counts = await tx.query<{ metric_id: string; n: number }>(`select metric_id, count(*)::int as n from public.observations where user_id = $1 and connector = $2 and deleted_at is null and canonical group by metric_id`, [userId, connector]);
    const totalObs = counts.rows.reduce((a, r) => a + Number(r.n), 0);
    const fatal = counters.rejected.length > 0 && counters.rejected.length === opts.records.length && opts.records.length > 0;
    const runStatus = fatal ? 'ERROR' : counters.rejected.length > 0 ? 'PARTIAL' : 'SUCCESS';
    await tx.query(
      `update public.sync_runs set finished_at = now(), status = $2, inserted = $3, updated = $4, unchanged_duplicates = $5, cross_source_duplicates = $6, deleted = $7, rejected = $8, details = $9 where id = $1`,
      [batchId, runStatus, counters.inserted, counters.updated, counters.unchangedDuplicates, counters.crossSourceDuplicates, counters.deleted, counters.rejected.length, JSON.stringify({ rejected: counters.rejected.slice(0, 50), ...(opts.runDetails ?? {}) })],
    );
    await tx.query(
      `update public.source_connections set status = case when $2 > 0 then 'CONNECTED' else case when status in ('CONNECTED','PARTIAL') then status else 'PARTIAL' end end, last_sync_status = $3, last_successful_sync_at = case when $3 in ('SUCCESS','PARTIAL') then $4::timestamptz else last_successful_sync_at end, last_error = $5 where id = $1`,
      [connectionId, totalObs, runStatus, nowIso, fatal ? `all ${opts.records.length} records rejected` : null],
    );
    return { batchId, serverTime: nowIso, received: opts.records.length, inserted: counters.inserted, updated: counters.updated, unchangedDuplicates: counters.unchangedDuplicates, crossSourceDuplicates: counters.crossSourceDuplicates, deleted: counters.deleted, rejected: counters.rejected, observationCounts: Object.fromEntries(counts.rows.map((r) => [r.metric_id, Number(r.n)])) };
  });
}

function hcToExternal(rec: HealthConnectRecord, timeZone: string, nowIso: string): ExternalRecordInput {
  const isInterval = rec.startTime !== undefined && rec.endTime !== undefined;
  return {
    externalId: rec.hcId,
    recordType: rec.recordType,
    dataOrigin: rec.dataOrigin,
    device: { externalId: `${rec.dataOrigin}|${rec.device?.manufacturer ?? ''}|${rec.device?.model ?? ''}`, label: hcDeviceLabel(rec.dataOrigin, rec.device), manufacturer: rec.device?.manufacturer ?? null, model: rec.device?.model ?? null, type: rec.device?.type != null ? String(rec.device.type) : null },
    recordingMethod: rec.recordingMethod,
    sourceModifiedAt: rec.lastModifiedTime,
    originalTime: isInterval ? rec.startTime! : rec.time!,
    originalEndTime: isInterval ? rec.endTime! : null,
    originalZoneOffset: isInterval ? rec.startZoneOffset ?? null : rec.zoneOffset ?? null,
    rawPayload: { recordType: rec.recordType, startTime: rec.startTime, endTime: rec.endTime, time: rec.time, startZoneOffset: rec.startZoneOffset, endZoneOffset: rec.endZoneOffset, zoneOffset: rec.zoneOffset, dataOrigin: rec.dataOrigin, device: rec.device, recordingMethod: rec.recordingMethod, clientRecordId: rec.clientRecordId, clientRecordVersion: rec.clientRecordVersion, payload: rec.payload },
    normalized: normalizeHealthConnectRecord(rec, timeZone, nowIso),
  };
}

export async function ingestHealthConnectBatch(pool: pg.Pool, userId: string, batch: HealthConnectIngestBatch, now: Date = new Date()): Promise<IngestResult> {
  const nowIso = now.toISOString();
  const counters = newCounters();
  const batchId = randomUUID();

  return withUser(pool, userId, async (tx) => {
    const prof = await tx.query<{ time_zone: string }>('select time_zone from public.profiles where id = $1', [userId]);
    const timeZone = prof.rows[0]?.time_zone ?? batch.timeZone;
    const granted = (batch.permissions ?? []).filter((p) => p.granted).map((p) => p.permission);
    const requested = (batch.permissions ?? []).map((p) => p.permission);
    const conn = await tx.query<{ id: string }>(
      `insert into public.source_connections (user_id, connector, status, last_sync_attempt_at, last_sync_status, granted_permissions, requested_permissions, metadata)
       values ($1, $2, 'PENDING_AUTH', $3, 'RUNNING', $4, $5, $6)
       on conflict (user_id, connector) do update set last_sync_attempt_at = excluded.last_sync_attempt_at, last_sync_status = 'RUNNING',
         granted_permissions = case when cardinality(excluded.granted_permissions) > 0 or cardinality(excluded.requested_permissions) > 0 then excluded.granted_permissions else public.source_connections.granted_permissions end,
         requested_permissions = case when cardinality(excluded.requested_permissions) > 0 then excluded.requested_permissions else public.source_connections.requested_permissions end,
         metadata = public.source_connections.metadata || excluded.metadata
       returning id`,
      [userId, HC, nowIso, granted, requested, JSON.stringify({ lastDeviceInstanceId: batch.deviceInstanceId, lastAppVersion: batch.appVersion, lastMode: batch.mode })],
    );
    const connectionId = conn.rows[0]!.id;
    await tx.query(`insert into public.sync_runs (id, user_id, connection_id, connector, mode, started_at, status, records_received) values ($1, $2, $3, $4, $5, $6, 'RUNNING', $7)`, [batchId, userId, connectionId, HC, batch.mode, nowIso, batch.records.length]);
    const ctx: PersistContext = { tx, userId, connector: HC, connectionId, runId: batchId, nowIso, counters, affectedDates: new Set(), mealDates: new Set(), deviceCache: new Map() };
    await upsertDevice(tx, userId, connectionId, HC, `phone:${batch.deviceInstanceId}`, batch.deviceLabel ?? 'Android phone', { type: 'PHONE', manufacturer: null, model: batch.deviceLabel ?? null }, nowIso, ctx.deviceCache);

    const records = batch.records.map((r) => hcToExternal(r, timeZone, nowIso));
    await persistRecords(ctx, records);
    for (const del of batch.deletions) if (await softDelete(ctx, del.hcId)) counters.deleted++;
    await attachCuffPulse(tx, userId);
    await recomputeDailyActivity(tx, userId, ctx.affectedDates);
    await finalizeMeals(ctx);

    if (batch.changeTokens) {
      for (const [recordType, token] of Object.entries(batch.changeTokens)) {
        await tx.query(
          `insert into public.sync_cursors (user_id, connection_id, scope, cursor, cursor_time) values ($1, $2, $3, $4, now())
           on conflict (user_id, scope) do update set cursor = excluded.cursor, cursor_time = now(), updated_at = now(), connection_id = excluded.connection_id`,
          [userId, connectionId, `health_connect:${batch.deviceInstanceId}:${recordType}`, token],
        );
      }
    }

    const counts = await tx.query<{ metric_id: string; n: number }>(`select metric_id, count(*)::int as n from public.observations where user_id = $1 and connector = $2 and deleted_at is null and canonical group by metric_id`, [userId, HC]);
    const totalObs = counts.rows.reduce((a, r) => a + Number(r.n), 0);
    const fatal = counters.rejected.length > 0 && counters.rejected.length === batch.records.length && batch.records.length > 0;
    const runStatus = fatal ? 'ERROR' : counters.rejected.length > 0 ? 'PARTIAL' : 'SUCCESS';
    await tx.query(
      `update public.sync_runs set finished_at = now(), status = $2, inserted = $3, updated = $4, unchanged_duplicates = $5, cross_source_duplicates = $6, deleted = $7, rejected = $8, details = $9 where id = $1`,
      [batchId, runStatus, counters.inserted, counters.updated, counters.unchangedDuplicates, counters.crossSourceDuplicates, counters.deleted, counters.rejected.length, JSON.stringify({ rejected: counters.rejected.slice(0, 50), deviceInstanceId: batch.deviceInstanceId })],
    );
    const connStatus = totalObs > 0 ? 'CONNECTED' : granted.length > 0 || batch.records.length > 0 ? 'PARTIAL' : 'PENDING_AUTH';
    await tx.query(
      `update public.source_connections set status = $2, last_sync_status = $3, last_successful_sync_at = case when $3 in ('SUCCESS','PARTIAL') then $4::timestamptz else last_successful_sync_at end, last_error = $5 where id = $1`,
      [connectionId, connStatus, runStatus, nowIso, fatal ? `all ${batch.records.length} records rejected` : null],
    );
    return { batchId, serverTime: nowIso, received: batch.records.length, inserted: counters.inserted, updated: counters.updated, unchangedDuplicates: counters.unchangedDuplicates, crossSourceDuplicates: counters.crossSourceDuplicates, deleted: counters.deleted, rejected: counters.rejected, observationCounts: Object.fromEntries(counts.rows.map((r) => [r.metric_id, Number(r.n)])) };
  });
}
