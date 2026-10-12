/**
 * FHIR R4 → Ben Health OS staging rows. Nothing is marked canonical here: labs are staged for review,
 * conditions keep the clinician's verification status, medications become source records for
 * reconciliation. Codes and display text are kept verbatim from the record.
 */
import type { FhirResource } from './client.js';

type Coding = { system?: string; code?: string; display?: string };
type CodeableConcept = { text?: string; coding?: Coding[] };
const LOINC = 'http://loinc.org';
const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';

function conceptText(c: CodeableConcept | undefined): string | null {
  return c?.text ?? c?.coding?.find((x) => x.display)?.display ?? c?.coding?.[0]?.code ?? null;
}
function codingFor(c: CodeableConcept | undefined, system: string): Coding | undefined {
  return c?.coding?.find((x) => x.system === system);
}
function datePart(v: unknown): string | null {
  return typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null;
}
function instant(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface FhirLabRow {
  externalId: string;
  analyteRawName: string;
  loinc: string | null;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  referenceText: string | null;
  abnormalFlag: string | null;
  collectedAt: string | null;
  resultedAt: string | null;
  laboratory: string | null;
  provider: string | null;
  method: string | null;
  status: string | null;
  raw: FhirResource;
}

const INTERPRETATION: Record<string, string> = { H: 'H', L: 'L', HH: 'HH', LL: 'LL', A: 'A', AA: 'A', N: 'N', HU: 'H', LU: 'L', '>': 'H', '<': 'L' };

/** Laboratory Observation → lab row; non-laboratory observations (vitals, surveys) return null. */
export function mapObservationToLab(obs: FhirResource): FhirLabRow | null {
  const o = obs as FhirResource & { category?: CodeableConcept[]; code?: CodeableConcept; valueQuantity?: { value?: number; unit?: string; code?: string; comparator?: string }; valueString?: string; valueCodeableConcept?: CodeableConcept; referenceRange?: Array<{ low?: { value?: number }; high?: { value?: number }; text?: string }>; interpretation?: CodeableConcept[]; effectiveDateTime?: string; effectivePeriod?: { start?: string }; issued?: string; performer?: Array<{ display?: string }>; method?: CodeableConcept; status?: string; hasMember?: unknown[] };
  if (!o.id) return null;
  const isLab = (o.category ?? []).some((c) => (c.coding ?? []).some((x) => x.code === 'laboratory'));
  if (!isLab) return null;
  if (!o.valueQuantity && !o.valueString && !o.valueCodeableConcept) return null; // panel headers (hasMember) carry no value
  const loinc = codingFor(o.code, LOINC)?.code ?? null;
  const name = conceptText(o.code) ?? loinc ?? 'Unnamed observation';
  const q = o.valueQuantity;
  const ref = o.referenceRange?.[0];
  const interp = o.interpretation?.[0]?.coding?.[0]?.code ?? null;
  return {
    externalId: `Observation/${o.id}`,
    analyteRawName: name,
    loinc,
    value: typeof q?.value === 'number' ? q.value : null,
    valueText: q?.comparator && typeof q.value === 'number' ? `${q.comparator}${q.value}` : (o.valueString ?? conceptText(o.valueCodeableConcept) ?? null),
    unit: q?.unit ?? q?.code ?? null,
    referenceLow: typeof ref?.low?.value === 'number' ? ref.low.value : null,
    referenceHigh: typeof ref?.high?.value === 'number' ? ref.high.value : null,
    referenceText: ref?.text ?? (ref ? `${ref.low?.value ?? ''}-${ref.high?.value ?? ''}` : null),
    abnormalFlag: interp ? (INTERPRETATION[interp] ?? interp) : null,
    collectedAt: datePart(o.effectiveDateTime ?? o.effectivePeriod?.start),
    resultedAt: datePart(o.issued),
    laboratory: o.performer?.[0]?.display ?? null,
    provider: null,
    method: conceptText(o.method),
    status: o.status ?? null,
    raw: obs,
  };
}

export interface FhirCondition {
  externalId: string;
  name: string;
  codeSystem: string | null;
  code: string | null;
  status: 'ACTIVE' | 'RESOLVED' | 'HISTORICAL' | 'UNCERTAIN';
  verificationStatus: 'UNVERIFIED' | 'REVIEW' | 'CONFIRMED' | 'REJECTED';
  onsetDate: string | null;
  resolvedDate: string | null;
  raw: FhirResource;
}

export function mapCondition(res: FhirResource): FhirCondition | null {
  const c = res as FhirResource & { code?: CodeableConcept; clinicalStatus?: CodeableConcept; verificationStatus?: CodeableConcept; onsetDateTime?: string; abatementDateTime?: string; recordedDate?: string };
  if (!c.id) return null;
  const name = conceptText(c.code);
  if (!name) return null;
  const coding = c.code?.coding?.find((x) => x.code) ?? null;
  const clinical = c.clinicalStatus?.coding?.[0]?.code ?? 'unknown';
  const verification = c.verificationStatus?.coding?.[0]?.code ?? 'unconfirmed';
  const status: FhirCondition['status'] = clinical === 'active' || clinical === 'recurrence' || clinical === 'relapse' ? 'ACTIVE' : clinical === 'resolved' || clinical === 'remission' ? 'RESOLVED' : clinical === 'inactive' ? 'HISTORICAL' : 'UNCERTAIN';
  const verificationStatus: FhirCondition['verificationStatus'] = verification === 'confirmed' ? 'CONFIRMED' : verification === 'refuted' || verification === 'entered-in-error' ? 'REJECTED' : 'UNVERIFIED';
  return { externalId: `Condition/${c.id}`, name, codeSystem: coding?.system ?? null, code: coding?.code ?? null, status, verificationStatus, onsetDate: datePart(c.onsetDateTime ?? c.recordedDate), resolvedDate: datePart(c.abatementDateTime), raw: res };
}

export interface FhirMedicationRecord {
  externalId: string;
  name: string;
  rxnorm: string | null;
  status: string | null;
  dosageText: string | null;
  authoredOn: string | null;
  requester: string | null;
  raw: FhirResource;
}

export function mapMedicationRequest(res: FhirResource): FhirMedicationRecord | null {
  const m = res as FhirResource & { medicationCodeableConcept?: CodeableConcept; medicationReference?: { display?: string }; status?: string; dosageInstruction?: Array<{ text?: string }>; authoredOn?: string; requester?: { display?: string } };
  if (!m.id) return null;
  const name = conceptText(m.medicationCodeableConcept) ?? m.medicationReference?.display ?? null;
  if (!name) return null;
  return { externalId: `MedicationRequest/${m.id}`, name, rxnorm: codingFor(m.medicationCodeableConcept, RXNORM)?.code ?? null, status: m.status ?? null, dosageText: m.dosageInstruction?.[0]?.text ?? null, authoredOn: instant(m.authoredOn), requester: m.requester?.display ?? null, raw: res };
}

export interface FhirAllergy {
  externalId: string;
  substance: string;
  reaction: string | null;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'UNKNOWN';
  recordedAt: string | null;
  raw: FhirResource;
}

export function mapAllergyIntolerance(res: FhirResource): FhirAllergy | null {
  const a = res as FhirResource & { code?: CodeableConcept; reaction?: Array<{ manifestation?: CodeableConcept[]; severity?: string; description?: string }>; recordedDate?: string; onsetDateTime?: string };
  if (!a.id) return null;
  const substance = conceptText(a.code);
  if (!substance) return null;
  const r = a.reaction?.[0];
  const sev = r?.severity;
  return { externalId: `AllergyIntolerance/${a.id}`, substance, reaction: r?.description ?? conceptText(r?.manifestation?.[0]) ?? null, severity: sev === 'mild' ? 'MILD' : sev === 'moderate' ? 'MODERATE' : sev === 'severe' ? 'SEVERE' : 'UNKNOWN', recordedAt: datePart(a.recordedDate ?? a.onsetDateTime), raw: res };
}

export interface FhirClinicalEvent {
  externalId: string;
  kind: 'VISIT' | 'PROCEDURE' | 'VACCINATION';
  occurredAt: string;
  title: string;
  provider: string | null;
  details: Record<string, unknown>;
  raw: FhirResource;
}

export function mapImmunization(res: FhirResource): FhirClinicalEvent | null {
  const i = res as FhirResource & { vaccineCode?: CodeableConcept; occurrenceDateTime?: string; occurrenceString?: string; performer?: Array<{ actor?: { display?: string } }>; status?: string; lotNumber?: string };
  const when = instant(i.occurrenceDateTime);
  if (!i.id || !when) return null;
  return { externalId: `Immunization/${i.id}`, kind: 'VACCINATION', occurredAt: when, title: conceptText(i.vaccineCode) ?? 'Immunization', provider: i.performer?.[0]?.actor?.display ?? null, details: { status: i.status ?? null, lotNumber: i.lotNumber ?? null }, raw: res };
}

export function mapProcedure(res: FhirResource): FhirClinicalEvent | null {
  const p = res as FhirResource & { code?: CodeableConcept; performedDateTime?: string; performedPeriod?: { start?: string }; performer?: Array<{ actor?: { display?: string } }>; status?: string };
  const when = instant(p.performedDateTime ?? p.performedPeriod?.start);
  if (!p.id || !when) return null;
  return { externalId: `Procedure/${p.id}`, kind: 'PROCEDURE', occurredAt: when, title: conceptText(p.code) ?? 'Procedure', provider: p.performer?.[0]?.actor?.display ?? null, details: { status: p.status ?? null }, raw: res };
}

export function mapEncounter(res: FhirResource): FhirClinicalEvent | null {
  const e = res as FhirResource & { type?: CodeableConcept[]; class?: Coding; period?: { start?: string; end?: string }; serviceProvider?: { display?: string }; participant?: Array<{ individual?: { display?: string } }>; reasonCode?: CodeableConcept[]; status?: string };
  const when = instant(e.period?.start);
  if (!e.id || !when) return null;
  return { externalId: `Encounter/${e.id}`, kind: 'VISIT', occurredAt: when, title: conceptText(e.type?.[0]) ?? e.class?.display ?? 'Visit', provider: e.serviceProvider?.display ?? e.participant?.[0]?.individual?.display ?? null, details: { status: e.status ?? null, reason: conceptText(e.reasonCode?.[0]), end: instant(e.period?.end) }, raw: res };
}
