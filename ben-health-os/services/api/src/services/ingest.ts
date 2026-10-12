import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { HealthConnectIngestBatch, HealthConnectRecord, IngestResult } from '@bho/contracts';
import { HEALTH_CONNECT_ORIGINS, connectorById, metricById } from '@bho/shared-config';
import { findIntervalDuplicate, findPointDuplicate, payloadHash, resolveDailySteps } from '@bho/analytics';
import { withUser, type Tx } from '../db/pool.js';
import { normalizeHealthConnectRecord, type NormalizedRecord } from './normalize.js';

const CONNECTOR = 'health_connect';

interface Counters {
  inserted: number;
  updated: number;
  unchangedDuplicates: number;
  crossSourceDuplicates: number;
  deleted: number;
  rejected: Array<{ index: number; hcId?: string; reason: string }>;
}

function deviceLabel(origin: string, device: HealthConnectRecord['device']): string {
  const friendly = HEALTH_CONNECT_ORIGINS[origin]?.label ?? origin;
  const model = device?.model ? ` ${device.model}` : '';
  return `${friendly}${model}`.trim();
}

async function upsertDevice(tx: Tx, userId: string, connectionId: string, externalDeviceId: string, label: string, device: HealthConnectRecord['device'], seenAt: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(externalDeviceId);
  if (cached) return cached;
  const res = await tx.query<{ id: string }>(
    `insert into public.source_devices (user_id, connection_id, connector, external_device_id, label, manufacturer, model, device_type, first_seen_at, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     on conflict (user_id, connector, external_device_id) do update set last_seen_at = greatest(public.source_devices.last_seen_at, excluded.last_seen_at), label = excluded.label, connection_id = excluded.connection_id
     returning id`,
    [userId, connectionId, CONNECTOR, externalDeviceId, label, device?.manufacturer ?? null, device?.model ?? null, device?.type != null ? String(device.type) : null, seenAt],
  );
  cache.set(externalDeviceId, res.rows[0]!.id);
  return res.rows[0]!.id;
}

async function upsertObservations(tx: Tx, userId: string, rec: HealthConnectRecord, rawId: string, deviceId: string | null, groupId: string | null, n: NormalizedRecord): Promise<Array<{ id: string; metricId: string; measuredAt: string; value: number; inserted: boolean }>> {
  const out: Array<{ id: string; metricId: string; measuredAt: string; value: number; inserted: boolean }> = [];
  for (const o of n.observations) {
    const res = await tx.query<{ id: string; inserted: boolean }>(
      `insert into public.observations (user_id, metric_id, value, unit, measured_at, start_at, end_at, local_date, zone_offset, connector, data_origin, device_id, external_id, raw_event_id, group_id, recording_method, quality_flags, source_modified_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       on conflict (user_id, connector, external_id, metric_id) do update set
         value = excluded.value, unit = excluded.unit, measured_at = excluded.measured_at, start_at = excluded.start_at, end_at = excluded.end_at,
         local_date = excluded.local_date, zone_offset = excluded.zone_offset, data_origin = excluded.data_origin, device_id = excluded.device_id,
         raw_event_id = excluded.raw_event_id, group_id = coalesce(public.observations.group_id, excluded.group_id), recording_method = excluded.recording_method,
         quality_flags = excluded.quality_flags, source_modified_at = excluded.source_modified_at, deleted_at = null
       returning id, (xmax = 0) as inserted`,
      [userId, o.metricId, o.value, o.unit, o.measuredAt, o.startAt, o.endAt, o.localDate, o.zoneOffset, CONNECTOR, rec.dataOrigin, deviceId, o.externalId, rawId, groupId, rec.recordingMethod, o.qualityFlags, rec.lastModifiedTime],
    );
    out.push({ id: res.rows[0]!.id, metricId: o.metricId, measuredAt: o.measuredAt, value: o.value, inserted: res.rows[0]!.inserted });
  }
  return out;
}

/** Cross-source dedup for a single point observation; returns 1 when a duplicate link was made. */
export async function dedupPoint(tx: Tx, userId: string, obsId: string, metricId: string, measuredAt: string, value: number, connector: string, dataOrigin: string | null, companions?: Record<string, number>): Promise<number> {
  const metric = metricById(metricId);
  if (!metric) return 0;
  const windowSeconds = (await import('@bho/shared-config')).DEDUP_WINDOWS[metric.metricClass]?.windowSeconds ?? 0;
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
  // Mark the whole group (e.g. systolic + diastolic + pulse of one reading), not just the matched metric.
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
  // Mirror onto linked typed rows (blood pressure readings share external ids with their observations)
  await tx.query(
    `update public.blood_pressure_readings b set canonical = o.canonical, duplicate_of = (select b2.id from public.blood_pressure_readings b2 join public.observations o2 on o2.group_id = b2.id where o2.id = o.duplicate_of limit 1), duplicate_reason = o.duplicate_reason
     from public.observations o where o.group_id = b.id and o.id in ($1, $2) and b.user_id = $3`,
    [decision.duplicate.id, decision.canonical.id, userId],
  );
  return 1;
}

async function recomputeDailyActivity(tx: Tx, userId: string, dates: Set<string>): Promise<void> {
  for (const localDate of dates) {
    const steps = await tx.query<{ connector: string; data_origin: string | null; steps: number }>(
      `select connector, data_origin, sum(value)::float8 as steps from public.observations where user_id = $1 and metric_id = 'steps' and local_date = $2 and deleted_at is null group by connector, data_origin`,
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

export async function ingestHealthConnectBatch(pool: pg.Pool, userId: string, batch: HealthConnectIngestBatch, now: Date = new Date()): Promise<IngestResult> {
  const nowIso = now.toISOString();
  const counters: Counters = { inserted: 0, updated: 0, unchangedDuplicates: 0, crossSourceDuplicates: 0, deleted: 0, rejected: [] };
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
      [userId, CONNECTOR, nowIso, granted, requested, JSON.stringify({ lastDeviceInstanceId: batch.deviceInstanceId, lastAppVersion: batch.appVersion, lastMode: batch.mode })],
    );
    const connectionId = conn.rows[0]!.id;
    const run = await tx.query<{ id: string }>(
      `insert into public.sync_runs (id, user_id, connection_id, connector, mode, started_at, status, records_received) values ($1, $2, $3, $4, $5, $6, 'RUNNING', $7) returning id`,
      [batchId, userId, connectionId, CONNECTOR, batch.mode, nowIso, batch.records.length],
    );
    const runId = run.rows[0]!.id;
    const deviceCache = new Map<string, string>();
    await upsertDevice(tx, userId, connectionId, `phone:${batch.deviceInstanceId}`, batch.deviceLabel ?? 'Android phone', { type: 'PHONE', manufacturer: null, model: batch.deviceLabel ?? null }, nowIso, deviceCache);

    // Existing raw events for all ids in this batch (one query)
    const ids = batch.records.map((r) => r.hcId);
    const existingRows = await tx.query<{ id: string; external_id: string; payload_hash: string; processing_status: string }>(
      `select distinct on (external_id) id, external_id, payload_hash, processing_status from public.raw_ingest_events
       where user_id = $1 and connector = $2 and external_id = any($3) and processing_status <> 'SUPERSEDED' order by external_id, ingested_at desc`,
      [userId, CONNECTOR, ids],
    );
    const existing = new Map(existingRows.rows.map((r) => [r.external_id, r]));
    const affectedDates = new Set<string>();

    for (let index = 0; index < batch.records.length; index++) {
      const rec = batch.records[index]!;
      const hash = payloadHash({ t: rec.recordType, s: rec.startTime, e: rec.endTime, i: rec.time, zs: rec.startZoneOffset, ze: rec.endZoneOffset, z: rec.zoneOffset, p: rec.payload, o: rec.dataOrigin, d: rec.device, m: rec.recordingMethod });
      const prev = existing.get(rec.hcId);
      if (prev && prev.payload_hash === hash && prev.processing_status !== 'DELETED') {
        counters.unchangedDuplicates++;
        continue;
      }
      const sp = `rec_${index}`;
      await tx.query(`savepoint ${sp}`);
      try {
        const isInterval = rec.startTime !== undefined && rec.endTime !== undefined;
        const raw = await tx.query<{ id: string }>(
          `insert into public.raw_ingest_events (user_id, connector, external_id, source_user_id, device_id, record_type, original_time, original_end_time, original_zone_offset, source_modified_at, payload, payload_hash, parser_version, processing_status, sync_run_id)
           values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, $11, 1, 'RECEIVED', $12) returning id`,
          [userId, CONNECTOR, rec.hcId, null, rec.recordType, isInterval ? rec.startTime : rec.time, isInterval ? rec.endTime : null, isInterval ? rec.startZoneOffset ?? null : rec.zoneOffset ?? null, rec.lastModifiedTime, JSON.stringify({ recordType: rec.recordType, startTime: rec.startTime, endTime: rec.endTime, time: rec.time, startZoneOffset: rec.startZoneOffset, endZoneOffset: rec.endZoneOffset, zoneOffset: rec.zoneOffset, dataOrigin: rec.dataOrigin, device: rec.device, recordingMethod: rec.recordingMethod, clientRecordId: rec.clientRecordId, clientRecordVersion: rec.clientRecordVersion, payload: rec.payload }), hash, runId],
        );
        const rawId = raw.rows[0]!.id;
        if (prev) await tx.query(`update public.raw_ingest_events set processing_status = 'SUPERSEDED', superseded_by = $2 where id = $1`, [prev.id, rawId]);

        const deviceExternalId = `${rec.dataOrigin}|${rec.device?.manufacturer ?? ''}|${rec.device?.model ?? ''}`;
        const deviceId = await upsertDevice(tx, userId, connectionId, deviceExternalId, deviceLabel(rec.dataOrigin, rec.device), rec.device ?? null, rec.lastModifiedTime, deviceCache);

        const n = normalizeHealthConnectRecord(rec, timeZone, nowIso);
        let groupId: string | null = null;
        const deferred: Array<() => Promise<void>> = [];

        if (n.bp) {
          const bp = n.bp;
          const res = await tx.query<{ id: string }>(
            `insert into public.blood_pressure_readings (user_id, measured_at, local_date, zone_offset, systolic, diastolic, connector, data_origin, device_id, external_id, raw_event_id, recording_method, source_attrib, quality_flags)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             on conflict (user_id, connector, external_id) do update set measured_at = excluded.measured_at, local_date = excluded.local_date, zone_offset = excluded.zone_offset, systolic = excluded.systolic, diastolic = excluded.diastolic,
               data_origin = excluded.data_origin, device_id = excluded.device_id, raw_event_id = excluded.raw_event_id, quality_flags = excluded.quality_flags, deleted_at = null
             returning id`,
            [userId, bp.measuredAt, bp.localDate, bp.zoneOffset, bp.systolic, bp.diastolic, CONNECTOR, rec.dataOrigin, deviceId, bp.externalId, rawId, rec.recordingMethod, `hc:${rec.recordingMethod}${bp.bodyPosition != null ? `;pos=${bp.bodyPosition}` : ''}`, bp.qualityFlags],
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
            [userId, s.startAt, s.endAt, s.startZoneOffset, s.endZoneOffset, s.localDate, s.durationMin, s.timeInBedMin, s.efficiency, s.deepMin, s.lightMin, s.remMin, s.awakeMin, s.title, s.notes, CONNECTOR, rec.dataOrigin, deviceId, s.externalId, rawId, rec.recordingMethod, s.qualityFlags],
          );
          groupId = res.rows[0]!.id;
          await tx.query('delete from public.sleep_stages where session_id = $1', [groupId]);
          for (const st of s.stages) await tx.query('insert into public.sleep_stages (user_id, session_id, start_at, end_at, stage) values ($1, $2, $3, $4, $5)', [userId, groupId, st.startAt, st.endAt, st.stage]);
          // interval dedup against other-source sessions within ±36h (runs after observations exist)
          const sleepGroupId = groupId;
          deferred.push(async () => {
            const cands = await tx.query<{ id: string; connector: string; data_origin: string | null; start_at: Date; end_at: Date }>(
              `select id, connector, data_origin, start_at, end_at from public.sleep_sessions where user_id = $1 and canonical and deleted_at is null and id <> $2 and start_at between $3::timestamptz - interval '36 hours' and $3::timestamptz + interval '36 hours'`,
              [userId, sleepGroupId, s.startAt],
            );
            const d = findIntervalDuplicate({ id: sleepGroupId, connector: CONNECTOR, dataOrigin: rec.dataOrigin, startAt: s.startAt, endAt: s.endAt }, cands.rows.map((c) => ({ id: c.id, connector: c.connector, dataOrigin: c.data_origin, startAt: new Date(c.start_at).toISOString(), endAt: new Date(c.end_at).toISOString() })), 'sleep');
            if (d) {
              await tx.query('update public.sleep_sessions set canonical = false, duplicate_of = $2, duplicate_reason = $3 where id = $1', [d.duplicate.id, d.canonical.id, d.reason]);
              await tx.query('update public.sleep_sessions set canonical = true, duplicate_of = null, duplicate_reason = null where id = $1', [d.canonical.id]);
              await tx.query(`update public.observations o set canonical = s.canonical, duplicate_of = null, duplicate_reason = s.duplicate_reason from public.sleep_sessions s where o.group_id = s.id and s.id in ($1, $2)`, [d.duplicate.id, d.canonical.id]);
              counters.crossSourceDuplicates++;
            }
          });
        }
        if (n.workout) {
          const w = n.workout;
          const res = await tx.query<{ id: string }>(
            `insert into public.workouts (user_id, start_at, end_at, local_date, duration_min, exercise_type, exercise_type_name, category, title, notes, segments, connector, data_origin, device_id, external_id, raw_event_id, recording_method, quality_flags)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
             on conflict (user_id, connector, external_id) do update set start_at = excluded.start_at, end_at = excluded.end_at, local_date = excluded.local_date, duration_min = excluded.duration_min, exercise_type = excluded.exercise_type, exercise_type_name = excluded.exercise_type_name,
               category = excluded.category, title = excluded.title, notes = excluded.notes, segments = excluded.segments, data_origin = excluded.data_origin, device_id = excluded.device_id, raw_event_id = excluded.raw_event_id, quality_flags = excluded.quality_flags, deleted_at = null
             returning id`,
            [userId, w.startAt, w.endAt, w.localDate, w.durationMin, w.exerciseType, w.exerciseTypeName, w.category, w.title, w.notes, w.segments ? JSON.stringify(w.segments) : null, CONNECTOR, rec.dataOrigin, deviceId, w.externalId, rawId, rec.recordingMethod, w.qualityFlags],
          );
          groupId = res.rows[0]!.id;
          const workoutGroupId = groupId;
          deferred.push(async () => {
            const cands = await tx.query<{ id: string; connector: string; data_origin: string | null; start_at: Date; end_at: Date }>(
              `select id, connector, data_origin, start_at, end_at from public.workouts where user_id = $1 and canonical and deleted_at is null and id <> $2 and start_at between $3::timestamptz - interval '6 hours' and $3::timestamptz + interval '6 hours'`,
              [userId, workoutGroupId, w.startAt],
            );
            const d = findIntervalDuplicate({ id: workoutGroupId, connector: CONNECTOR, dataOrigin: rec.dataOrigin, startAt: w.startAt, endAt: w.endAt }, cands.rows.map((c) => ({ id: c.id, connector: c.connector, dataOrigin: c.data_origin, startAt: new Date(c.start_at).toISOString(), endAt: new Date(c.end_at).toISOString() })), 'workout');
            if (d) {
              await tx.query('update public.workouts set canonical = false, duplicate_of = $2, duplicate_reason = $3 where id = $1', [d.duplicate.id, d.canonical.id, d.reason]);
              await tx.query('update public.workouts set canonical = true, duplicate_of = null, duplicate_reason = null where id = $1', [d.canonical.id]);
              await tx.query(`update public.observations o set canonical = w.canonical, duplicate_of = null, duplicate_reason = w.duplicate_reason from public.workouts w where o.group_id = w.id and w.id in ($1, $2)`, [d.duplicate.id, d.canonical.id]);
              counters.crossSourceDuplicates++;
            }
          });
          affectedDates.add(w.localDate);
        }
        if (n.meal) {
          const m = n.meal;
          const res = await tx.query<{ id: string }>(
            `insert into public.meals (user_id, eaten_at, end_at, local_date, meal_type, name, energy_kcal, protein_g, carbs_g, fat_g, saturated_fat_g, fiber_g, sodium_mg, potassium_mg, sugar_g, nutrients, connector, data_origin, external_id, raw_event_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
             on conflict (user_id, connector, external_id) do update set eaten_at = excluded.eaten_at, end_at = excluded.end_at, local_date = excluded.local_date, meal_type = excluded.meal_type, name = excluded.name, energy_kcal = excluded.energy_kcal, protein_g = excluded.protein_g,
               carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, saturated_fat_g = excluded.saturated_fat_g, fiber_g = excluded.fiber_g, sodium_mg = excluded.sodium_mg, potassium_mg = excluded.potassium_mg, sugar_g = excluded.sugar_g, nutrients = excluded.nutrients,
               data_origin = excluded.data_origin, raw_event_id = excluded.raw_event_id, deleted_at = null
             returning id`,
            [userId, m.eatenAt, m.endAt, m.localDate, m.mealType, m.name, m.energyKcal, m.proteinG, m.carbsG, m.fatG, m.saturatedFatG, m.fiberG, m.sodiumMg, m.potassiumMg, m.sugarG, JSON.stringify(m.nutrients), CONNECTOR, rec.dataOrigin, m.externalId, rawId],
          );
          groupId = res.rows[0]!.id;
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
            [userId, g.measuredAt, g.localDate, g.mgDl, g.specimenSource, g.mealRelation, CONNECTOR, rec.dataOrigin, deviceId, g.externalId, rawId, g.qualityFlags],
          );
          groupId = res.rows[0]!.id;
        }

        const written = await upsertObservations(tx, userId, rec, rawId, deviceId, groupId, n);
        for (const run of deferred) await run();
        for (const o of written) {
          if (['steps', 'distance_m', 'active_calories', 'exercise_minutes', 'resistance_sessions'].includes(o.metricId)) affectedDates.add(n.observations.find((x) => x.metricId === o.metricId)!.localDate);
          if (n.bp && o.metricId === 'blood_pressure_systolic') {
            counters.crossSourceDuplicates += await dedupPoint(tx, userId, o.id, o.metricId, o.measuredAt, o.value, CONNECTOR, rec.dataOrigin, { blood_pressure_diastolic: n.bp.diastolic });
          } else if (!n.bp && !n.sleep && !n.workout) {
            counters.crossSourceDuplicates += await dedupPoint(tx, userId, o.id, o.metricId, o.measuredAt, o.value, CONNECTOR, rec.dataOrigin);
          }
        }
        await tx.query(`update public.raw_ingest_events set processing_status = 'NORMALIZED', processing_error = $2 where id = $1`, [rawId, n.notes.length ? n.notes.join('; ') : null]);
        await tx.query(`release savepoint ${sp}`);
        if (prev) counters.updated++;
        else counters.inserted++;
      } catch (e) {
        await tx.query(`rollback to savepoint ${sp}`);
        counters.rejected.push({ index, hcId: rec.hcId, reason: (e as Error).message.slice(0, 300) });
      }
    }

    // Deletions: Health Connect only reports the deleted record id. Soft-delete everything linked to it.
    for (const del of batch.deletions) {
      const r1 = await tx.query(`update public.observations set deleted_at = now() where user_id = $1 and connector = $2 and deleted_at is null and (external_id = $3 or external_id like $3 || '#%') returning local_date, metric_id`, [userId, CONNECTOR, del.hcId]);
      for (const row of r1.rows as Array<{ local_date: Date; metric_id: string }>) if (['steps', 'distance_m', 'active_calories', 'exercise_minutes', 'resistance_sessions'].includes(row.metric_id)) affectedDates.add(new Date(row.local_date).toISOString().slice(0, 10));
      for (const table of ['blood_pressure_readings', 'sleep_sessions', 'workouts', 'meals', 'glucose_samples']) {
        await tx.query(`update public.${table} set deleted_at = now() where user_id = $1 and connector = $2 and external_id = $3 and deleted_at is null`, [userId, CONNECTOR, del.hcId]);
      }
      const r2 = await tx.query(`update public.raw_ingest_events set processing_status = 'DELETED' where user_id = $1 and connector = $2 and external_id = $3 and processing_status <> 'SUPERSEDED' returning id`, [userId, CONNECTOR, del.hcId]);
      if ((r1.rowCount ?? 0) > 0 || (r2.rowCount ?? 0) > 0) counters.deleted++;
    }

    // Cuffs (Withings) write pulse as a HeartRate record at the same instant: attach it to the reading.
    await tx.query(
      `update public.blood_pressure_readings b set pulse = o.value from public.observations o
       where b.user_id = $1 and b.pulse is null and o.user_id = b.user_id and o.metric_id = 'heart_rate' and o.data_origin is not distinct from b.data_origin and o.deleted_at is null
         and o.measured_at between b.measured_at - interval '90 seconds' and b.measured_at + interval '90 seconds'`,
      [userId],
    );

    await recomputeDailyActivity(tx, userId, affectedDates);

    if (batch.changeTokens) {
      for (const [recordType, token] of Object.entries(batch.changeTokens)) {
        await tx.query(
          `insert into public.sync_cursors (user_id, connection_id, scope, cursor, cursor_time) values ($1, $2, $3, $4, now())
           on conflict (user_id, scope) do update set cursor = excluded.cursor, cursor_time = now(), updated_at = now(), connection_id = excluded.connection_id`,
          [userId, connectionId, `health_connect:${batch.deviceInstanceId}:${recordType}`, token],
        );
      }
    }

    const counts = await tx.query<{ metric_id: string; n: number }>(`select metric_id, count(*)::int as n from public.observations where user_id = $1 and connector = $2 and deleted_at is null and canonical group by metric_id`, [userId, CONNECTOR]);
    const totalObs = counts.rows.reduce((a, r) => a + Number(r.n), 0);
    const fatal = counters.rejected.length > 0 && counters.rejected.length === batch.records.length && batch.records.length > 0;
    const runStatus = fatal ? 'ERROR' : counters.rejected.length > 0 ? 'PARTIAL' : 'SUCCESS';
    await tx.query(
      `update public.sync_runs set finished_at = now(), status = $2, inserted = $3, updated = $4, unchanged_duplicates = $5, cross_source_duplicates = $6, deleted = $7, rejected = $8, details = $9 where id = $1`,
      [runId, runStatus, counters.inserted, counters.updated, counters.unchangedDuplicates, counters.crossSourceDuplicates, counters.deleted, counters.rejected.length, JSON.stringify({ rejected: counters.rejected.slice(0, 50), deviceInstanceId: batch.deviceInstanceId })],
    );
    const connStatus = totalObs > 0 ? 'CONNECTED' : granted.length > 0 || batch.records.length > 0 ? 'PARTIAL' : 'PENDING_AUTH';
    await tx.query(
      `update public.source_connections set status = $2, last_sync_status = $3, last_successful_sync_at = case when $3 in ('SUCCESS','PARTIAL') then $4::timestamptz else last_successful_sync_at end, last_error = $5 where id = $1`,
      [connectionId, connStatus, runStatus, nowIso, fatal ? `all ${batch.records.length} records rejected` : null],
    );
    const def = connectorById(CONNECTOR);
    void def;
    return {
      batchId,
      serverTime: nowIso,
      received: batch.records.length,
      inserted: counters.inserted,
      updated: counters.updated,
      unchangedDuplicates: counters.unchangedDuplicates,
      crossSourceDuplicates: counters.crossSourceDuplicates,
      deleted: counters.deleted,
      rejected: counters.rejected,
      observationCounts: Object.fromEntries(counts.rows.map((r) => [r.metric_id, Number(r.n)])),
    };
  });
}
