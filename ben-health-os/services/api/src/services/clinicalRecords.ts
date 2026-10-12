import type pg from 'pg';
import type { ClinicalRecordsResponse, ConditionInputSchema } from '@bho/contracts';
import type { z } from 'zod';
import { withUser } from '../db/pool.js';

type ConditionInput = z.infer<typeof ConditionInputSchema>;
const date = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export async function listClinicalRecords(pool: pg.Pool, userId: string): Promise<ClinicalRecordsResponse> {
  return withUser(pool, userId, async (tx) => {
    const conds = await tx.query<{ id: string; name: string; code_system: string | null; code: string | null; status: string; onset_date: Date | null; resolved_date: Date | null; source: string; source_record: string | null; notes: string | null; verification_status: string; created_at: Date }>('select id, name, code_system, code, status, onset_date, resolved_date, source, source_record, notes, verification_status, created_at from public.conditions where user_id = $1 order by status, name', [userId]);
    const events = await tx.query<{ id: string; kind: string; occurred_at: Date; provider: string | null; title: string; details: Record<string, unknown>; source: string; created_at: Date }>('select id, kind, occurred_at, provider, title, details, source, created_at from public.clinical_events where user_id = $1 order by occurred_at desc limit 200', [userId]);
    const allergies = await tx.query<{ id: string; substance: string; reaction: string | null; severity: string; source: string; source_record: string | null; recorded_at: Date | null; notes: string | null; created_at: Date }>('select id, substance, reaction, severity, source, source_record, recorded_at, notes, created_at from public.allergies where user_id = $1 order by substance', [userId]);
    return {
      conditions: conds.rows.map((c) => ({ id: c.id, name: c.name, codeSystem: c.code_system, code: c.code, status: c.status as 'ACTIVE', onsetDate: date(c.onset_date), resolvedDate: date(c.resolved_date), notes: c.notes, source: c.source, sourceRecord: c.source_record, verificationStatus: c.verification_status as 'CONFIRMED', createdAt: new Date(c.created_at).toISOString() })),
      events: events.rows.map((e) => ({ id: e.id, kind: e.kind, occurredAt: new Date(e.occurred_at).toISOString(), provider: e.provider, title: e.title, details: e.details ?? {}, source: e.source, createdAt: new Date(e.created_at).toISOString() })),
      allergies: allergies.rows.map((a) => ({ id: a.id, substance: a.substance, reaction: a.reaction, severity: a.severity as 'UNKNOWN', recordedAt: date(a.recorded_at), notes: a.notes, source: a.source, sourceRecord: a.source_record, createdAt: new Date(a.created_at).toISOString() })),
      notes: ['Conditions from clinical records keep the clinician’s verification status; user-entered conditions are marked USER. Nothing here is a diagnosis made by the app.'],
    };
  });
}

export async function createCondition(pool: pg.Pool, userId: string, c: ConditionInput): Promise<string> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string }>(`insert into public.conditions (user_id, name, code_system, code, status, onset_date, resolved_date, source, notes, verification_status) values ($1, $2, $3, $4, $5, $6, $7, 'USER', $8, 'CONFIRMED') returning id`, [userId, c.name, c.codeSystem ?? null, c.code ?? null, c.status, c.onsetDate ?? null, c.resolvedDate ?? null, c.notes ?? null]);
    return r.rows[0]!.id;
  });
}

export async function updateCondition(pool: pg.Pool, userId: string, id: string, c: Partial<ConditionInput>): Promise<boolean> {
  const map: Record<string, string> = { name: 'name', codeSystem: 'code_system', code: 'code', status: 'status', onsetDate: 'onset_date', resolvedDate: 'resolved_date', notes: 'notes' };
  const sets: string[] = [];
  const vals: unknown[] = [userId, id];
  for (const [k, col] of Object.entries(map)) {
    const v = (c as Record<string, unknown>)[k];
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) return true;
  return withUser(pool, userId, async (tx) => (await tx.query(`update public.conditions set ${sets.join(', ')}, updated_at = now() where user_id = $1 and id = $2`, vals)).rowCount! > 0);
}

export async function deleteCondition(pool: pg.Pool, userId: string, id: string): Promise<boolean> {
  return withUser(pool, userId, async (tx) => (await tx.query('delete from public.conditions where user_id = $1 and id = $2', [userId, id])).rowCount! > 0);
}
