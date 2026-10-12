/**
 * Clinical records via Epic patient-access FHIR (SMART standalone launch). Pull-only: Observations in the
 * laboratory category become confirmed lab results (clinician record), Conditions keep their verification
 * status, MedicationRequests become reconciliation source records, AllergyIntolerances allergies, and
 * Immunizations/Procedures/Encounters clinical events. Everything is idempotent by resource id.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { finishLabRow, normalizeLabUnit } from '@bho/analytics';
import type { FhirImportResult } from '@bho/contracts';
import { FhirClient, fhirOrganizationById, mapAllergyIntolerance, mapCondition, mapEncounter, mapImmunization, mapMedicationRequest, mapObservationToLab, mapProcedure, type FhirOrganization, type FhirResource, type SmartConfiguration } from '@bho/integrations';
import { withUser } from '../db/pool.js';
import { linkLabDuplicates, stageLabRow } from './labs.js';
import { upsertMedicationSourceRecord } from './medications.js';

export interface FhirConnectionMeta {
  org: string;
  fhirBase: string;
  smart: Pick<SmartConfiguration, 'authorization_endpoint' | 'token_endpoint'>;
  patientId: string | null;
}

export class FhirConfigError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export function resolveOrganization(orgId: string | undefined, fhirBaseOverride: string | null): { org: FhirOrganization; fhirBase: string } {
  if (!orgId) throw new FhirConfigError(400, 'org is required (weill_cornell or nyu_langone)');
  const org = fhirOrganizationById(orgId);
  if (!org) throw new FhirConfigError(400, `unknown organization ${orgId}`);
  return { org, fhirBase: fhirBaseOverride ?? org.fhirBase };
}

export async function importFhir(pool: pg.Pool, userId: string, accessToken: string, meta: FhirConnectionMeta, mode: string, now: Date = new Date()): Promise<FhirImportResult> {
  const nowIso = now.toISOString();
  if (!meta.patientId) throw new FhirConfigError(409, 'the authorization did not return a patient id; reconnect and grant access');
  const fhir = new FhirClient(meta.fhirBase, accessToken);
  const warnings: string[] = [];
  const pull = async (type: string, params: Record<string, string>): Promise<FhirResource[]> => {
    try {
      return await fhir.searchAll(type, { patient: meta.patientId!, ...params });
    } catch (e) {
      warnings.push(`${type}: ${(e as Error).message.slice(0, 160)}`);
      return [];
    }
  };
  const observations = await pull('Observation', { category: 'laboratory' });
  const conditions = await pull('Condition', {});
  const medications = await pull('MedicationRequest', {});
  const allergies = await pull('AllergyIntolerance', {});
  const immunizations = await pull('Immunization', {});
  const procedures = await pull('Procedure', {});
  const encounters = await pull('Encounter', {});

  return withUser(pool, userId, async (tx) => {
    const runId = randomUUID();
    const conn = await tx.query<{ id: string }>(
      `insert into public.source_connections (user_id, connector, status, last_sync_attempt_at, last_sync_status) values ($1, 'clinical_fhir', 'PENDING_AUTH', $2, 'RUNNING')
       on conflict (user_id, connector) do update set last_sync_attempt_at = excluded.last_sync_attempt_at, last_sync_status = 'RUNNING' returning id`,
      [userId, nowIso],
    );
    await tx.query(`insert into public.sync_runs (id, user_id, connection_id, connector, mode, started_at, status, records_received) values ($1, $2, $3, 'clinical_fhir', $4, $5, 'RUNNING', $6)`, [runId, userId, conn.rows[0]!.id, mode, nowIso, observations.length + conditions.length + medications.length + allergies.length + immunizations.length + procedures.length + encounters.length]);

    let labsStaged = 0;
    let labsUnchanged = 0;
    const labExternalIds: string[] = [];
    for (const obs of observations) {
      const m = mapObservationToLab(obs);
      if (!m) continue;
      const row = finishLabRow({ index: 0, analyteRawName: m.analyteRawName, loinc: m.loinc, value: m.value, valueText: m.valueText, unit: normalizeLabUnit(m.unit), referenceLow: m.referenceLow, referenceHigh: m.referenceHigh, referenceText: m.referenceText, abnormalFlag: m.abnormalFlag, collectedAt: m.collectedAt, resultedAt: m.resultedAt, laboratory: m.laboratory, provider: m.provider, panel: null, method: m.method, extractionConfidence: 1, flags: ['CLINICAL_RECORD', ...(m.status && m.status !== 'final' ? [`OBSERVATION_STATUS:${m.status}`] : [])] });
      const outcome = await stageLabRow(tx, userId, { ...row, externalId: m.externalId, raw: obs }, { source: 'clinical_fhir', documentId: null, panelId: null, panelName: null, verificationStatus: 'CONFIRMED', externalIdPrefix: 'fhir', recordType: 'FhirObservation' }, nowIso);
      if (outcome === 'unchanged') labsUnchanged++;
      else labsStaged++;
      labExternalIds.push(m.externalId);
    }
    if (labExternalIds.length) {
      const ids = await tx.query<{ id: string }>(`select id from public.lab_results where user_id = $1 and source_connector = 'clinical_fhir' and external_id = any($2::text[]) and canonical`, [userId, labExternalIds]);
      await linkLabDuplicates(tx, userId, ids.rows.map((r) => r.id));
    }
    let condCount = 0;
    for (const res of conditions) {
      const c = mapCondition(res);
      if (!c) continue;
      await tx.query(
        `insert into public.conditions (user_id, name, code_system, code, status, onset_date, resolved_date, source, source_record, external_id, verification_status, raw)
         values ($1, $2, $3, $4, $5, $6, $7, 'CLINICIAN', $8, $8, $9, $10)
         on conflict (user_id, source, external_id) where external_id is not null do update set name = excluded.name, code_system = excluded.code_system, code = excluded.code, status = excluded.status, onset_date = excluded.onset_date, resolved_date = excluded.resolved_date, verification_status = excluded.verification_status, raw = excluded.raw, updated_at = now()`,
        [userId, c.name, c.codeSystem, c.code, c.status, c.onsetDate, c.resolvedDate, c.externalId, c.verificationStatus, JSON.stringify(res)],
      );
      condCount++;
    }
    let medCount = 0;
    for (const res of medications) {
      const m = mapMedicationRequest(res);
      if (!m) continue;
      await upsertMedicationSourceRecord(tx, userId, { source: 'clinical_fhir', sourceRecordId: m.externalId, name: m.name, recordedAt: m.authoredOn, raw: { rxnorm: m.rxnorm, status: m.status, dosageText: m.dosageText, requester: m.requester, resource: res } });
      medCount++;
    }
    let allergyCount = 0;
    for (const res of allergies) {
      const a = mapAllergyIntolerance(res);
      if (!a) continue;
      await tx.query(
        `insert into public.allergies (user_id, substance, reaction, severity, source, source_record, recorded_at) values ($1, $2, $3, $4, 'CLINICAL_FHIR', $5, $6)
         on conflict (user_id, source, source_record) do update set substance = excluded.substance, reaction = excluded.reaction, severity = excluded.severity, recorded_at = excluded.recorded_at, updated_at = now()`,
        [userId, a.substance, a.reaction, a.severity, a.externalId, a.recordedAt],
      );
      allergyCount++;
    }
    let eventCount = 0;
    for (const ev of [...immunizations.map(mapImmunization), ...procedures.map(mapProcedure), ...encounters.map(mapEncounter)]) {
      if (!ev) continue;
      await tx.query(
        `insert into public.clinical_events (user_id, kind, occurred_at, provider, title, details, source, external_id) values ($1, $2, $3, $4, $5, $6, 'clinical_fhir', $7)
         on conflict (user_id, source, external_id) where external_id is not null do update set kind = excluded.kind, occurred_at = excluded.occurred_at, provider = excluded.provider, title = excluded.title, details = excluded.details`,
        [userId, ev.kind, ev.occurredAt, ev.provider, ev.title, JSON.stringify(ev.details), ev.externalId],
      );
      eventCount++;
    }
    const total = labsStaged + labsUnchanged + condCount + medCount + allergyCount + eventCount;
    await tx.query(`update public.sync_runs set finished_at = now(), status = $2, inserted = $3, unchanged_duplicates = $4, details = $5 where id = $1`, [runId, warnings.length && total === 0 ? 'ERROR' : warnings.length ? 'PARTIAL' : 'SUCCESS', labsStaged + condCount + medCount + allergyCount + eventCount, labsUnchanged, JSON.stringify({ org: meta.org, warnings })]);
    await tx.query(
      `update public.source_connections set status = $2, last_sync_status = $3, last_successful_sync_at = $4, last_error = $5, metadata = metadata || $6::jsonb where user_id = $1 and connector = 'clinical_fhir'`,
      [userId, total > 0 ? 'CONNECTED' : 'PARTIAL', warnings.length && total === 0 ? 'ERROR' : 'SUCCESS', nowIso, warnings.length ? warnings.join('; ').slice(0, 300) : null, JSON.stringify({ org: meta.org, patientId: meta.patientId, lastImportAt: nowIso })],
    );
    return { organization: meta.org, patientId: meta.patientId, labsStaged, labsUnchanged, conditions: condCount, medicationSourceRecords: medCount, allergies: allergyCount, events: eventCount, warnings };
  });
}
