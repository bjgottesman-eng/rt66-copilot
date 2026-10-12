/** Medications, supplements, allergies and medication reconciliation (spec §24). No interaction checking: no verified clinical drug-interaction source is integrated, so none is simulated. */
import type pg from 'pg';
import type { AllergySchema, MedicationInput, MedicationsResponse, ReconcileRequest, SupplementInputSchema } from '@bho/contracts';
import type { z } from 'zod';
import { withUser, type Tx } from '../db/pool.js';
import { audit } from './audit.js';

type SupplementInput = z.infer<typeof SupplementInputSchema>;
type AllergyInput = Omit<z.infer<typeof AllergySchema>, 'id' | 'source' | 'sourceRecord' | 'createdAt'>;
const MED_COLS = 'id, name, dosage, route, frequency, prescribing_clinician, start_date, stop_date, indication, status, refill_date, side_effects, adherence_notes, rxnorm, source, created_at, updated_at';
const SRC_COLS = 'id, medication_id, source, source_record_id, name, status, recorded_at, raw, document_id, created_at';
const date = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

interface MedRow { id: string; name: string; dosage: string | null; route: string | null; frequency: string | null; prescribing_clinician: string | null; start_date: Date | null; stop_date: Date | null; indication: string | null; status: string; refill_date: Date | null; side_effects: string | null; adherence_notes: string | null; rxnorm: string | null; source: string; created_at: Date; updated_at: Date }
interface SrcRow { id: string; medication_id: string | null; source: string; source_record_id: string | null; name: string | null; status: string; recorded_at: Date | null; raw: Record<string, unknown>; document_id: string | null; created_at: Date }

function srcToDto(r: SrcRow): MedicationsResponse['unreconciled'][number] {
  return { id: r.id, medicationId: r.medication_id, source: r.source, sourceRecordId: r.source_record_id, name: r.name, status: r.status as 'UNRECONCILED' | 'LINKED' | 'IGNORED', recordedAt: iso(r.recorded_at), raw: r.raw ?? {}, createdAt: iso(r.created_at)! };
}
function medToDto(r: MedRow, sources: SrcRow[]): MedicationsResponse['medications'][number] {
  return { id: r.id, name: r.name, dosage: r.dosage, route: r.route, frequency: r.frequency, prescribingClinician: r.prescribing_clinician, startDate: date(r.start_date), stopDate: date(r.stop_date), indication: r.indication, status: r.status as MedicationInput['status'], refillDate: date(r.refill_date), sideEffects: r.side_effects, adherenceNotes: r.adherence_notes, rxnorm: r.rxnorm, source: r.source, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, sourceRecords: sources.filter((s) => s.medication_id === r.id).map(srcToDto) };
}

async function insertMedication(tx: Tx, userId: string, m: MedicationInput, source: string): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `insert into public.medications (user_id, name, dosage, route, frequency, prescribing_clinician, start_date, stop_date, indication, status, refill_date, side_effects, adherence_notes, rxnorm, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [userId, m.name, m.dosage ?? null, m.route ?? null, m.frequency ?? null, m.prescribingClinician ?? null, m.startDate ?? null, m.stopDate ?? null, m.indication ?? null, m.status, m.refillDate ?? null, m.sideEffects ?? null, m.adherenceNotes ?? null, m.rxnorm ?? null, source],
  );
  return r.rows[0]!.id;
}

export async function createMedication(pool: pg.Pool, userId: string, m: MedicationInput): Promise<string> {
  return withUser(pool, userId, (tx) => insertMedication(tx, userId, m, 'USER'));
}

export async function updateMedication(pool: pg.Pool, userId: string, id: string, m: Partial<MedicationInput>): Promise<boolean> {
  const map: Record<string, string> = { name: 'name', dosage: 'dosage', route: 'route', frequency: 'frequency', prescribingClinician: 'prescribing_clinician', startDate: 'start_date', stopDate: 'stop_date', indication: 'indication', status: 'status', refillDate: 'refill_date', sideEffects: 'side_effects', adherenceNotes: 'adherence_notes', rxnorm: 'rxnorm' };
  const sets: string[] = [];
  const vals: unknown[] = [userId, id];
  for (const [k, col] of Object.entries(map)) {
    if ((m as Record<string, unknown>)[k] === undefined) continue;
    vals.push((m as Record<string, unknown>)[k]);
    sets.push(`${col} = $${vals.length}`);
  }
  if (sets.length === 0) return true;
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query(`update public.medications set ${sets.join(', ')}, updated_at = now() where user_id = $1 and id = $2`, vals);
    return (r.rowCount ?? 0) > 0;
  });
}

export async function deleteMedication(pool: pg.Pool, userId: string, id: string): Promise<boolean> {
  return withUser(pool, userId, async (tx) => {
    await tx.query(`update public.medication_source_records set medication_id = null, status = 'UNRECONCILED' where user_id = $1 and medication_id = $2`, [userId, id]);
    const r = await tx.query('delete from public.medications where user_id = $1 and id = $2', [userId, id]);
    return (r.rowCount ?? 0) > 0;
  });
}

export async function createSupplement(pool: pg.Pool, userId: string, s: SupplementInput): Promise<string> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into public.supplements (user_id, name, brand, ingredients, dose, frequency, purpose, start_date, stop_date, monthly_cost_cents, perceived_benefit, possible_adverse_effects, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [userId, s.name, s.brand ?? null, JSON.stringify(s.ingredients ?? []), s.dose ?? null, s.frequency ?? null, s.purpose ?? null, s.startDate ?? null, s.stopDate ?? null, s.monthlyCostCents ?? null, s.perceivedBenefit ?? null, s.possibleAdverseEffects ?? null, s.status],
    );
    return r.rows[0]!.id;
  });
}

export async function updateSupplement(pool: pg.Pool, userId: string, id: string, s: Partial<SupplementInput>): Promise<boolean> {
  const map: Record<string, string> = { name: 'name', brand: 'brand', ingredients: 'ingredients', dose: 'dose', frequency: 'frequency', purpose: 'purpose', startDate: 'start_date', stopDate: 'stop_date', monthlyCostCents: 'monthly_cost_cents', perceivedBenefit: 'perceived_benefit', possibleAdverseEffects: 'possible_adverse_effects', status: 'status' };
  const sets: string[] = [];
  const vals: unknown[] = [userId, id];
  for (const [k, col] of Object.entries(map)) {
    const v = (s as Record<string, unknown>)[k];
    if (v === undefined) continue;
    vals.push(k === 'ingredients' ? JSON.stringify(v) : v);
    sets.push(`${col} = $${vals.length}`);
  }
  if (sets.length === 0) return true;
  return withUser(pool, userId, async (tx) => (await tx.query(`update public.supplements set ${sets.join(', ')}, updated_at = now() where user_id = $1 and id = $2`, vals)).rowCount! > 0);
}

export async function deleteSupplement(pool: pg.Pool, userId: string, id: string): Promise<boolean> {
  return withUser(pool, userId, async (tx) => (await tx.query('delete from public.supplements where user_id = $1 and id = $2', [userId, id])).rowCount! > 0);
}

export async function createAllergy(pool: pg.Pool, userId: string, a: AllergyInput): Promise<string> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string }>(`insert into public.allergies (user_id, substance, reaction, severity, source, recorded_at, notes) values ($1, $2, $3, $4, 'USER', $5, $6) returning id`, [userId, a.substance, a.reaction ?? null, a.severity, a.recordedAt ?? null, a.notes ?? null]);
    return r.rows[0]!.id;
  });
}

export async function deleteAllergy(pool: pg.Pool, userId: string, id: string): Promise<boolean> {
  return withUser(pool, userId, async (tx) => (await tx.query('delete from public.allergies where user_id = $1 and id = $2', [userId, id])).rowCount! > 0);
}

/** Records a medication seen in an external source (FHIR MedicationRequest, document) for reconciliation. Idempotent per source record id. */
export async function upsertMedicationSourceRecord(tx: Tx, userId: string, rec: { source: string; sourceRecordId: string; name: string; recordedAt: string | null; raw: Record<string, unknown>; documentId?: string | null }): Promise<'inserted' | 'unchanged'> {
  const r = await tx.query<{ inserted: boolean }>(
    `insert into public.medication_source_records (user_id, source, source_record_id, name, recorded_at, raw, document_id) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id, source, source_record_id) where source_record_id is not null do update set name = excluded.name, recorded_at = excluded.recorded_at, raw = excluded.raw
     returning (xmax = 0) as inserted`,
    [userId, rec.source, rec.sourceRecordId, rec.name, rec.recordedAt, JSON.stringify(rec.raw), rec.documentId ?? null],
  );
  return r.rows[0]!.inserted ? 'inserted' : 'unchanged';
}

export async function reconcileMedications(pool: pg.Pool, userId: string, req: ReconcileRequest): Promise<{ linked: number; created: number; ignored: number; reconciliationId: string }> {
  const out = await withUser(pool, userId, async (tx) => {
    let linked = 0;
    let created = 0;
    let ignored = 0;
    const applied: unknown[] = [];
    for (const d of req.decisions) {
      const src = await tx.query<SrcRow>(`select ${SRC_COLS} from public.medication_source_records where user_id = $1 and id = $2`, [userId, d.sourceRecordId]);
      const rec = src.rows[0];
      if (!rec) continue;
      if (d.action === 'IGNORE') {
        await tx.query(`update public.medication_source_records set status = 'IGNORED', medication_id = null where user_id = $1 and id = $2`, [userId, d.sourceRecordId]);
        ignored++;
      } else if (d.action === 'LINK' && d.medicationId) {
        const med = await tx.query('select id from public.medications where user_id = $1 and id = $2', [userId, d.medicationId]);
        if (!med.rows[0]) continue;
        await tx.query(`update public.medication_source_records set status = 'LINKED', medication_id = $3 where user_id = $1 and id = $2`, [userId, d.sourceRecordId, d.medicationId]);
        linked++;
      } else if (d.action === 'CREATE') {
        const input: MedicationInput = d.medication ?? { name: rec.name ?? 'Unnamed medication', status: 'UNCERTAIN' };
        const raw = rec.raw as { dosageText?: string; requester?: string; rxnorm?: string; status?: string };
        const id = await insertMedication(tx, userId, { ...input, dosage: input.dosage ?? raw.dosageText ?? null, prescribingClinician: input.prescribingClinician ?? raw.requester ?? null, rxnorm: input.rxnorm ?? raw.rxnorm ?? null }, rec.source);
        await tx.query(`update public.medication_source_records set status = 'LINKED', medication_id = $3 where user_id = $1 and id = $2`, [userId, d.sourceRecordId, id]);
        created++;
      } else continue;
      applied.push({ sourceRecordId: d.sourceRecordId, action: d.action, medicationId: d.medicationId ?? null });
    }
    const rec = await tx.query<{ id: string }>(`insert into public.medication_reconciliations (user_id, performed_by, summary, decisions) values ($1, $2, $3, $4) returning id`, [userId, req.performedBy, req.summary ?? null, JSON.stringify(applied)]);
    return { linked, created, ignored, reconciliationId: rec.rows[0]!.id };
  });
  await audit(pool, { userId, actor: 'user', action: 'MEDICATION_RECONCILE', entity: 'medication_reconciliations', entityId: out.reconciliationId, details: { linked: out.linked, created: out.created, ignored: out.ignored } });
  return out;
}

export async function medicationsOverviewTx(tx: Tx, userId: string): Promise<MedicationsResponse> {
  const meds = await tx.query<MedRow>(`select ${MED_COLS} from public.medications where user_id = $1 order by case status when 'CURRENT' then 0 when 'AS_NEEDED' then 1 when 'UNCERTAIN' then 2 when 'HISTORICAL' then 3 else 4 end, name`, [userId]);
  const sources = await tx.query<SrcRow>(`select ${SRC_COLS} from public.medication_source_records where user_id = $1 order by recorded_at desc nulls last`, [userId]);
  const supps = await tx.query<{ id: string; name: string; brand: string | null; ingredients: Array<{ name: string; amount?: string | null }>; dose: string | null; frequency: string | null; purpose: string | null; start_date: Date | null; stop_date: Date | null; monthly_cost_cents: number | null; perceived_benefit: string | null; possible_adverse_effects: string | null; status: string; created_at: Date; updated_at: Date }>(`select * from public.supplements where user_id = $1 order by status, name`, [userId]);
  const allergies = await tx.query<{ id: string; substance: string; reaction: string | null; severity: string; source: string; source_record: string | null; recorded_at: Date | null; notes: string | null; created_at: Date }>(`select * from public.allergies where user_id = $1 order by substance`, [userId]);
  const recs = await tx.query<{ id: string; performed_at: Date; performed_by: string; summary: string | null; decisions: unknown[] }>(`select id, performed_at, performed_by, summary, decisions from public.medication_reconciliations where user_id = $1 order by performed_at desc limit 20`, [userId]);
  return {
    medications: meds.rows.map((m) => medToDto(m, sources.rows)),
    supplements: supps.rows.map((s) => ({ id: s.id, name: s.name, brand: s.brand, ingredients: s.ingredients ?? [], dose: s.dose, frequency: s.frequency, purpose: s.purpose, startDate: date(s.start_date), stopDate: date(s.stop_date), monthlyCostCents: s.monthly_cost_cents, perceivedBenefit: s.perceived_benefit, possibleAdverseEffects: s.possible_adverse_effects, status: s.status as 'CURRENT', createdAt: iso(s.created_at)!, updatedAt: iso(s.updated_at)! })),
    allergies: allergies.rows.map((a) => ({ id: a.id, substance: a.substance, reaction: a.reaction, severity: a.severity as 'UNKNOWN', recordedAt: date(a.recorded_at), notes: a.notes, source: a.source, sourceRecord: a.source_record, createdAt: iso(a.created_at)! })),
    unreconciled: sources.rows.filter((s) => s.status === 'UNRECONCILED').map(srcToDto),
    reconciliations: recs.rows.map((r) => ({ id: r.id, performedAt: iso(r.performed_at)!, performedBy: r.performed_by, summary: r.summary, decisions: r.decisions ?? [] })),
    interactionsCheck: { status: 'NOT_IMPLEMENTED', note: 'Interaction flags require a verified clinical drug-interaction source; none is integrated, so none are shown. Review medications and supplements with your pharmacist or clinician.' },
    notes: ['Statuses are yours (or your clinician’s). Nothing here changes a medication; the app only records and reconciles what each source says.', 'Source records from clinical systems stay listed until you link, create or ignore them.'],
  };
}

export async function medicationsOverview(pool: pg.Pool, userId: string): Promise<MedicationsResponse> {
  return withUser(pool, userId, (tx) => medicationsOverviewTx(tx, userId));
}
