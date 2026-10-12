import type pg from 'pg';
import { withUser } from '../db/pool.js';
import { audit } from './audit.js';

/** Every user-owned table, children before parents so deletes never hit FK errors. */
export const USER_TABLES = [
  'recommendation_evidence', 'recommendations', 'experiment_phases', 'health_experiments', 'health_goals', 'alerts', 'preventive_care_items',
  'weekly_health_reports', 'monthly_health_reports', 'physician_briefs', 'health_memories', 'symptoms', 'journal_entries',
  'medication_source_records', 'medication_reconciliations', 'medications', 'supplements', 'allergies', 'conditions', 'clinical_events',
  'lab_results', 'lab_panels', 'documents', 'derived_metrics', 'annotations', 'nutrient_observations', 'nutrition_days', 'meals',
  'glucose_samples', 'daily_activity', 'workouts', 'sleep_stages', 'sleep_sessions', 'blood_pressure_readings', 'blood_pressure_sessions',
  'observations', 'raw_ingest_events', 'sync_cursors', 'sync_runs', 'source_devices', 'oauth_states', 'source_connections',
] as const;

export async function exportAll(pool: pg.Pool, userId: string): Promise<Record<string, unknown>> {
  const data = await withUser(pool, userId, async (tx) => {
    const out: Record<string, unknown> = {};
    const prof = await tx.query('select * from public.profiles where id = $1', [userId]);
    out.profile = prof.rows[0] ?? null;
    for (const t of USER_TABLES) {
      const res = await tx.query(`select * from public.${t} where user_id = $1`, [userId]);
      // OAuth token ciphertext is never exported.
      out[t] = t === 'source_connections' ? res.rows.map((r) => ({ ...(r as Record<string, unknown>), access_token_ciphertext: undefined, refresh_token_ciphertext: undefined })) : res.rows;
    }
    const auditRows = await tx.query('select * from public.audit_log where user_id = $1 order by at', [userId]);
    out.audit_log = auditRows.rows;
    return out;
  });
  await audit(pool, { userId, actor: 'user', action: 'EXPORT_ALL', details: { tables: USER_TABLES.length } });
  return { exportedAt: new Date().toISOString(), format: 'ben-health-os/export/v1', userId, ...data };
}

export async function deleteAllData(pool: pg.Pool, userId: string, opts: { keepProfile: boolean } = { keepProfile: true }): Promise<Record<string, number>> {
  const counts = await withUser(pool, userId, async (tx) => {
    const out: Record<string, number> = {};
    for (const t of USER_TABLES) {
      const res = await tx.query(`delete from public.${t} where user_id = $1`, [userId]);
      out[t] = res.rowCount ?? 0;
    }
    if (opts.keepProfile) await tx.query('update public.profiles set demo_mode = false where id = $1', [userId]);
    else await tx.query('delete from public.profiles where id = $1', [userId]);
    return out;
  });
  await audit(pool, { userId, actor: 'user', action: 'DELETE_ALL', details: { rows: Object.values(counts).reduce((a, b) => a + b, 0) } });
  return counts;
}

export async function deleteConnectorData(pool: pg.Pool, userId: string, connector: string): Promise<Record<string, number>> {
  const counts = await withUser(pool, userId, async (tx) => {
    const out: Record<string, number> = {};
    for (const t of ['observations', 'blood_pressure_readings', 'sleep_sessions', 'workouts', 'meals', 'glucose_samples', 'raw_ingest_events', 'sync_cursors', 'sync_runs', 'source_devices'] as const) {
      const res = await tx.query(`delete from public.${t} where user_id = $1 and connector = $2`, [userId, connector]);
      out[t] = res.rowCount ?? 0;
    }
    await tx.query(`delete from public.sleep_stages s where s.user_id = $1 and not exists (select 1 from public.sleep_sessions x where x.id = s.session_id)`, [userId]);
    await tx.query(`update public.source_connections set status = 'DISCONNECTED', last_error = null where user_id = $1 and connector = $2`, [userId, connector]);
    // Re-resolve canonical flags for anything that pointed at deleted rows
    await tx.query(`update public.observations set canonical = true, duplicate_of = null, duplicate_reason = null where user_id = $1 and duplicate_of is not null and not exists (select 1 from public.observations o2 where o2.id = public.observations.duplicate_of)`, [userId]);
    await tx.query(`update public.blood_pressure_readings set canonical = true, duplicate_of = null, duplicate_reason = null where user_id = $1 and duplicate_of is not null and not exists (select 1 from public.blood_pressure_readings b2 where b2.id = public.blood_pressure_readings.duplicate_of)`, [userId]);
    return out;
  });
  await audit(pool, { userId, actor: 'user', action: 'DELETE_CONNECTOR_DATA', entity: 'source_connection', entityId: connector, details: { rows: Object.values(counts).reduce((a, b) => a + b, 0) } });
  return counts;
}
