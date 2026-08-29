/**
 * BP session grouping (contracts §4): consecutive CANONICAL, non-deleted
 * readings with gaps ≤ 15 min form one bp_session. Recomputed idempotently
 * after each ingest batch.
 *
 * Averaging: `mean_excluding_first` is used when the session has ≥ 3 readings
 * (clinical practice discards the first, typically elevated, reading), else
 * `mean_all`. Both are computed; the active method's values are stored in
 * avg_* with the method recorded in averaging_method / first_reading_excluded.
 *
 * Phase 1 recomputes the user's full grouping on every call (a single-user
 * product with hundreds of readings): it is idempotent by construction and
 * immune to session chains crossing incremental-window boundaries. Session
 * rows are matched by started_at so ids stay stable across recomputes.
 */

import type { AveragingMethod } from '@benhealth/shared';
import type { TxClient } from './db.js';

export const SESSION_GAP_SECONDS = 15 * 60;

export interface SessionReading {
  id: string;
  measuredAt: Date;
  systolic: number;
  diastolic: number;
  pulse: number | null;
}

export interface SessionStats {
  startedAt: Date;
  endedAt: Date;
  readingCount: number;
  avgSystolic: number;
  avgDiastolic: number;
  avgPulse: number | null;
  averagingMethod: AveragingMethod;
  firstReadingExcluded: boolean;
}

/** Chain readings (sorted by time) into sessions with gaps ≤ 15 min. */
export function groupIntoSessions(readings: SessionReading[]): SessionReading[][] {
  const sorted = [...readings].sort(
    (a, b) => a.measuredAt.getTime() - b.measuredAt.getTime() || a.id.localeCompare(b.id),
  );
  const sessions: SessionReading[][] = [];
  let current: SessionReading[] = [];
  for (const reading of sorted) {
    const last = current[current.length - 1];
    if (
      last !== undefined &&
      (reading.measuredAt.getTime() - last.measuredAt.getTime()) / 1000 > SESSION_GAP_SECONDS
    ) {
      sessions.push(current);
      current = [];
    }
    current.push(reading);
  }
  if (current.length > 0) sessions.push(current);
  return sessions;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function means(readings: SessionReading[]): {
  systolic: number;
  diastolic: number;
  pulse: number | null;
} {
  const sys = readings.reduce((s, r) => s + r.systolic, 0) / readings.length;
  const dia = readings.reduce((s, r) => s + r.diastolic, 0) / readings.length;
  // Missing pulse is never coerced to zero: average over present values only.
  const pulses = readings.map((r) => r.pulse).filter((p): p is number => p !== null);
  const pulse = pulses.length === 0 ? null : pulses.reduce((s, p) => s + p, 0) / pulses.length;
  return { systolic: round1(sys), diastolic: round1(dia), pulse: pulse === null ? null : round1(pulse) };
}

/** Compute a session's stored statistics per the ≥3-readings rule. */
export function sessionStats(readings: SessionReading[]): SessionStats {
  if (readings.length === 0) throw new Error('session must have at least one reading');
  const excludeFirst = readings.length >= 3;
  const active = means(excludeFirst ? readings.slice(1) : readings);
  return {
    startedAt: readings[0]!.measuredAt,
    endedAt: readings[readings.length - 1]!.measuredAt,
    readingCount: readings.length,
    avgSystolic: active.systolic,
    avgDiastolic: active.diastolic,
    avgPulse: active.pulse,
    averagingMethod: excludeFirst ? 'mean_excluding_first' : 'mean_all',
    firstReadingExcluded: excludeFirst,
  };
}

/**
 * Idempotently recompute all bp_session rows for the current user (RLS scope)
 * and (re)assign session_id + reading_number_in_session on readings.
 */
export async function recomputeSessions(client: TxClient, userId: string): Promise<void> {
  const res = await client.query<{
    id: string;
    measured_at: Date;
    systolic_mmhg: string;
    diastolic_mmhg: string;
    pulse_bpm: string | null;
  }>(
    `select id, measured_at, systolic_mmhg, diastolic_mmhg, pulse_bpm
       from blood_pressure_reading
      where canonical and deleted_at is null
      order by measured_at asc, id asc`,
  );
  const readings: SessionReading[] = res.rows.map((r) => ({
    id: r.id,
    measuredAt: r.measured_at,
    systolic: Number(r.systolic_mmhg),
    diastolic: Number(r.diastolic_mmhg),
    pulse: r.pulse_bpm === null ? null : Number(r.pulse_bpm),
  }));

  const groups = groupIntoSessions(readings);

  const existing = await client.query<{ id: string; started_at: Date }>(
    'select id, started_at from bp_session',
  );
  const byStartedAt = new Map<number, string>();
  for (const row of existing.rows) byStartedAt.set(row.started_at.getTime(), row.id);

  const keptSessionIds = new Set<string>();
  for (const group of groups) {
    const stats = sessionStats(group);
    const existingId = byStartedAt.get(stats.startedAt.getTime());
    let sessionId: string;
    if (existingId !== undefined) {
      sessionId = existingId;
      await client.query(
        `update bp_session
            set ended_at = $2, reading_count = $3, avg_systolic = $4, avg_diastolic = $5,
                avg_pulse = $6, averaging_method = $7, first_reading_excluded = $8
          where id = $1`,
        [
          sessionId,
          stats.endedAt,
          stats.readingCount,
          stats.avgSystolic,
          stats.avgDiastolic,
          stats.avgPulse,
          stats.averagingMethod,
          stats.firstReadingExcluded,
        ],
      );
    } else {
      const inserted = await client.query<{ id: string }>(
        `insert into bp_session
           (user_id, started_at, ended_at, reading_count, avg_systolic, avg_diastolic,
            avg_pulse, averaging_method, first_reading_excluded)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id`,
        [
          userId,
          stats.startedAt,
          stats.endedAt,
          stats.readingCount,
          stats.avgSystolic,
          stats.avgDiastolic,
          stats.avgPulse,
          stats.averagingMethod,
          stats.firstReadingExcluded,
        ],
      );
      sessionId = inserted.rows[0]!.id;
    }
    keptSessionIds.add(sessionId);

    for (const [idx, reading] of group.entries()) {
      await client.query(
        `update blood_pressure_reading
            set session_id = $2, reading_number_in_session = $3
          where id = $1
            and (session_id is distinct from $2 or reading_number_in_session is distinct from $3)`,
        [reading.id, sessionId, idx + 1],
      );
    }
  }

  // Non-canonical / soft-deleted readings leave their sessions.
  await client.query(
    `update blood_pressure_reading
        set session_id = null, reading_number_in_session = null
      where (not canonical or deleted_at is not null) and session_id is not null`,
  );

  // Drop sessions that no longer exist (FK session_id has ON DELETE SET NULL,
  // and readings were already re-pointed above).
  const staleIds = existing.rows.map((r) => r.id).filter((id) => !keptSessionIds.has(id));
  if (staleIds.length > 0) {
    await client.query('delete from bp_session where id = any($1::uuid[])', [staleIds]);
  }
}
