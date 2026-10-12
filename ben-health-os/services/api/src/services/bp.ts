import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { BloodPressureReading, BloodPressureSummary, ManualBloodPressureInput } from '@bho/contracts';
import { averageBp, groupSessions, morningEveningSplit, payloadHash, plausibilityFlags, summarizeSession, localDateOf, timestampFlags } from '@bho/analytics';
import { withUser, type Tx } from '../db/pool.js';
import { dedupPoint } from './ingest.js';

interface BpRow {
  id: string;
  session_id: string | null;
  measured_at: Date;
  zone_offset: string | null;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  arm: string;
  posture: string;
  seated_rest_minutes: number | null;
  notes: string | null;
  connector: string;
  data_origin: string | null;
  device_label: string | null;
  canonical: boolean;
  duplicate_of: string | null;
}

const SELECT = `select b.id, b.session_id, b.measured_at, b.zone_offset, b.systolic::float8 as systolic, b.diastolic::float8 as diastolic, b.pulse::float8 as pulse, b.arm, b.posture, b.seated_rest_minutes, b.notes, b.connector, b.data_origin, d.label as device_label, b.canonical, b.duplicate_of
  from public.blood_pressure_readings b left join public.source_devices d on d.id = b.device_id`;

function toReading(r: BpRow): BloodPressureReading {
  return {
    id: r.id,
    sessionId: r.session_id,
    measuredAt: new Date(r.measured_at).toISOString(),
    systolic: Number(r.systolic),
    diastolic: Number(r.diastolic),
    pulse: r.pulse != null ? Number(r.pulse) : null,
    arm: r.arm as BloodPressureReading['arm'],
    posture: r.posture as BloodPressureReading['posture'],
    seatedRestMinutes: r.seated_rest_minutes,
    notes: r.notes,
    connector: r.connector as BloodPressureReading['connector'],
    dataOrigin: r.data_origin,
    deviceLabel: r.device_label,
    canonical: r.canonical,
    duplicateOf: r.duplicate_of,
  };
}

export async function createManualBloodPressure(pool: pg.Pool, userId: string, input: ManualBloodPressureInput, now: Date = new Date()): Promise<{ reading: BloodPressureReading; created: boolean }> {
  const nowIso = now.toISOString();
  return withUser(pool, userId, async (tx) => {
    const existing = await tx.query<BpRow>(`${SELECT} where b.user_id = $1 and b.connector = 'manual' and b.external_id = $2`, [userId, input.clientEntryId]);
    if (existing.rows[0]) return { reading: toReading(existing.rows[0]), created: false };
    const prof = await tx.query<{ time_zone: string }>('select time_zone from public.profiles where id = $1', [userId]);
    const tz = prof.rows[0]?.time_zone ?? 'UTC';
    const localDate = localDateOf(input.measuredAt, null, tz);
    await tx.query(
      `insert into public.source_connections (user_id, connector, status, last_sync_attempt_at, last_successful_sync_at, last_sync_status) values ($1, 'manual', 'CONNECTED', $2, $2, 'SUCCESS')
       on conflict (user_id, connector) do update set status = 'CONNECTED', last_sync_attempt_at = excluded.last_sync_attempt_at, last_successful_sync_at = excluded.last_successful_sync_at, last_sync_status = 'SUCCESS'`,
      [userId, nowIso],
    );
    const payload = { kind: 'manual_blood_pressure', ...input };
    const raw = await tx.query<{ id: string }>(
      `insert into public.raw_ingest_events (user_id, connector, external_id, record_type, original_time, payload, payload_hash, processing_status) values ($1, 'manual', $2, 'BloodPressure', $3, $4, $5, 'NORMALIZED') returning id`,
      [userId, input.clientEntryId, input.measuredAt, JSON.stringify(payload), payloadHash(payload)],
    );
    let sessionId = input.sessionId ?? null;
    if (!sessionId) {
      const near = await tx.query<{ id: string }>(
        `select id from public.blood_pressure_sessions where user_id = $1 and started_at between $2::timestamptz - interval '30 minutes' and $2::timestamptz + interval '30 minutes' and arm = $3 and posture = $4 order by started_at desc limit 1`,
        [userId, input.measuredAt, input.arm, input.posture],
      );
      sessionId = near.rows[0]?.id ?? null;
    }
    if (!sessionId) {
      sessionId = randomUUID();
      await tx.query('insert into public.blood_pressure_sessions (id, user_id, started_at, arm, posture, notes) values ($1, $2, $3, $4, $5, $6)', [sessionId, userId, input.measuredAt, input.arm, input.posture, input.notes ?? null]);
    }
    const flags = [...timestampFlags(input.measuredAt, nowIso), ...plausibilityFlags('blood_pressure_systolic', input.systolic), ...plausibilityFlags('blood_pressure_diastolic', input.diastolic)];
    const ins = await tx.query<{ id: string }>(
      `insert into public.blood_pressure_readings (user_id, session_id, measured_at, local_date, systolic, diastolic, pulse, arm, posture, seated_rest_minutes, notes, connector, data_origin, external_id, raw_event_id, recording_method, source_attrib, quality_flags)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', null, $12, $13, 'MANUAL_ENTRY', 'manual', $14) returning id`,
      [userId, sessionId, input.measuredAt, localDate, input.systolic, input.diastolic, input.pulse ?? null, input.arm, input.posture, input.seatedRestMinutes ?? null, input.notes ?? null, input.clientEntryId, raw.rows[0]!.id, [...new Set(flags)]],
    );
    const readingId = ins.rows[0]!.id;
    const obs = async (metricId: string, value: number, unit: string) => {
      const r = await tx.query<{ id: string }>(
        `insert into public.observations (user_id, metric_id, value, unit, measured_at, local_date, connector, external_id, raw_event_id, group_id, recording_method, quality_flags)
         values ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, 'MANUAL_ENTRY', $10) returning id`,
        [userId, metricId, value, unit, input.measuredAt, localDate, input.clientEntryId, raw.rows[0]!.id, readingId, plausibilityFlags(metricId, value)],
      );
      return r.rows[0]!.id;
    };
    const sysId = await obs('blood_pressure_systolic', input.systolic, 'mmHg');
    await obs('blood_pressure_diastolic', input.diastolic, 'mmHg');
    if (input.pulse != null) await obs('pulse', input.pulse, 'bpm');
    await dedupPoint(tx, userId, sysId, 'blood_pressure_systolic', input.measuredAt, input.systolic, 'manual', null, { blood_pressure_diastolic: input.diastolic });
    const row = await tx.query<BpRow>(`${SELECT} where b.id = $1`, [readingId]);
    return { reading: toReading(row.rows[0]!), created: true };
  });
}

export const DEFAULT_BP_TARGET = { systolicMax: 130, diastolicMax: 80, source: 'Population guideline placeholder (2017 ACC/AHA stage 1 threshold). Replace with the targets your clinician sets.', clinicianConfigured: false };

export async function bloodPressureSummary(pool: pg.Pool, userId: string, now: Date = new Date(), days = 30): Promise<BloodPressureSummary> {
  return withUser(pool, userId, async (tx) => {
    const prof = await tx.query<{ time_zone: string }>('select time_zone from public.profiles where id = $1', [userId]);
    const tz = prof.rows[0]?.time_zone ?? 'UTC';
    const rows = await tx.query<BpRow>(`${SELECT} where b.user_id = $1 and b.deleted_at is null and b.measured_at > $2::timestamptz - make_interval(days => $3) order by b.measured_at desc`, [userId, now.toISOString(), days]);
    const readings = rows.rows.map(toReading);
    const canonical = readings.filter((r) => r.canonical);
    const last7 = canonical.filter((r) => Date.parse(r.measuredAt) > now.getTime() - 7 * 86_400_000);
    const sessions = groupSessions(canonical.map((r) => ({ id: r.id, measuredAt: r.measuredAt, systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse, sessionId: r.sessionId })))
      .map((g) => summarizeSession(g))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 60);
    const split = morningEveningSplit(canonical.map((r) => ({ id: r.id, measuredAt: r.measuredAt, systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse })), tz);
    const conn = await tx.query<{ last_successful_sync_at: Date | null }>(`select max(last_successful_sync_at) as last_successful_sync_at from public.source_connections where user_id = $1 and connector in ('withings','health_connect','manual')`, [userId]);
    const avg = (xs: typeof canonical) => {
      const a = averageBp(xs);
      return a ? { systolic: Number(a.systolic.toFixed(1)), diastolic: Number(a.diastolic.toFixed(1)), pulse: a.pulse != null ? Number(a.pulse.toFixed(1)) : null, n: a.n } : null;
    };
    const me = (xs: typeof split.morning) => {
      const a = averageBp(xs);
      return a ? { systolic: Number(a.systolic.toFixed(1)), diastolic: Number(a.diastolic.toFixed(1)), n: a.n } : null;
    };
    const notes = ['Averages use canonical readings only; cross-source duplicates are linked and counted once.', 'Single readings are never interpreted as a diagnosis. Sessions average readings taken within 30 minutes.'];
    if (readings.length - canonical.length > 0) notes.push(`${readings.length - canonical.length} duplicate reading(s) linked in this window.`);
    return {
      latest: canonical[0] ?? null,
      lastSyncAt: conn.rows[0]?.last_successful_sync_at ? new Date(conn.rows[0].last_successful_sync_at).toISOString() : null,
      avg7d: avg(last7),
      avg30d: avg(canonical),
      morning: me(split.morning),
      evening: me(split.evening),
      sessions: sessions.map((s) => ({ sessionId: s.sessionId, startedAt: s.startedAt, n: s.n, systolic: Number(s.systolic.toFixed(1)), diastolic: Number(s.diastolic.toFixed(1)), pulse: s.pulse != null ? Number(s.pulse.toFixed(1)) : null, rule: s.rule })),
      readings: readings.slice(0, 200),
      targets: DEFAULT_BP_TARGET,
      notes,
    };
  });
}

export type { Tx };
