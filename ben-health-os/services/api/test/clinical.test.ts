import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { LabImportResultSchema, LabReviewQueueResponseSchema, LabsOverviewResponseSchema, MedicationsResponseSchema, PreventiveResponseSchema, ClinicalRecordsResponseSchema, FhirImportResultSchema } from '@bho/contracts';
import { buildApp } from '../src/app.js';
import { withService } from '../src/db/pool.js';
import { login, testApp, uniqueEmail, TEST_DATABASE_URL } from './helpers.js';
import { startMockFhir, type MockFhir } from './mock-fhir.js';

let app: FastifyInstance;
const storage = mkdtempSync(join(tmpdir(), 'bho-docs-'));
beforeAll(async () => {
  app = await buildApp({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_MODE: 'local', LOG_LEVEL: 'silent', ALLOW_DEMO_SEED: 'true', LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret', DOCUMENT_STORAGE_DIR: storage });
});
afterAll(async () => {
  await app.close();
});

/** Minimal single-page PDF with a Helvetica text layer (one Tj per line), enough for pdf.js text extraction. */
function makePdf(lines: string[]): Buffer {
  const esc = (l: string) => l.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = ['BT', '/F1 10 Tf', '12 TL', '50 750 Td', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const CSV = `Biomarker,Result,Units,Reference Range,Flag,Date Collected,Lab,Category
Apolipoprotein B,78,mg/dL,< 90,,2026-09-20,Quest Diagnostics,Heart
LDL Cholesterol,2.8,mmol/L,< 2.6,H,2026-09-20,Quest Diagnostics,Heart
Hemoglobin A1c,5.4,%,4.0-5.6,,2026-09-20,Quest Diagnostics,Metabolic
Lp(a),45,mg/dL,< 30,H,2026-09-20,Quest Diagnostics,Heart
Glucose,91,mg/dL,65-99,,2026-09-20,Quest Diagnostics,Metabolic
hs-CRP,< 0.3,mg/L,0.0-3.0,,09/20/2026,Quest Diagnostics,Inflammation`;

describe('Phase 5: laboratory imports, review and explorer', () => {
  it('stages a CSV after a dry run, confirms with corrections, dedups a manual duplicate, re-import is a no-op, and the clinical domain reflects it', async () => {
    const { auth } = await login(app, uniqueEmail('labs'));
    const dry = LabImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/labs', headers: auth, payload: { csv: CSV, fileName: 'function-export.csv', source: 'function_health', dryRun: true } })).json());
    expect(dry).toMatchObject({ dryRun: true, format: 'CSV', rows: 6, staged: 0, documentId: null, collectedAt: '2026-09-20', laboratory: 'Quest Diagnostics' });
    expect(dry.preview.find((p) => p.analyteRawName === 'LDL Cholesterol')).toMatchObject({ analyteId: 'ldl_c', canonicalValue: 108.276, abnormalFlag: 'H' });
    expect(LabsOverviewResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/labs', headers: auth })).json()).analytes).toEqual([]);

    const imp = LabImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/labs', headers: auth, payload: { csv: CSV, fileName: 'function-export.csv', source: 'function_health' } })).json());
    expect(imp).toMatchObject({ staged: 6, unchanged: 0 });
    expect(imp.documentId).toBeTruthy();
    const queue = LabReviewQueueResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/labs/review', headers: auth })).json());
    expect(queue.total).toBe(6);
    expect(queue.pending.every((p) => p.verificationStatus === 'REVIEW' && p.source === 'function_health')).toBe(true);
    const glucose = queue.pending.find((p) => p.analyteRawName === 'Glucose')!;
    const lpa = queue.pending.find((p) => p.analyteRawName === 'Lp(a)')!;
    const decisions = queue.pending.map((p) => (p.id === lpa.id ? { id: p.id, action: 'REJECT', corrections: { note: 'unit not convertible; re-request in nmol/L' } } : p.id === glucose.id ? { id: p.id, action: 'CONFIRM', corrections: { analyteId: 'fasting_glucose', note: 'drawn fasting' } } : { id: p.id, action: 'CONFIRM' }));
    const decided = (await app.inject({ method: 'POST', url: '/v1/labs/review', headers: auth, payload: { decisions } })).json();
    expect(decided).toMatchObject({ confirmed: 5, rejected: 1, remaining: 0 });

    const overview = LabsOverviewResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/labs', headers: auth })).json());
    expect(overview.pendingReview).toBe(0);
    expect(overview.sources).toEqual(['function_health']);
    expect(overview.analytes.map((a) => a.analyteKey)).toEqual(['apob', 'ldl_c', 'hba1c', 'fasting_glucose', 'hs_crp']);
    const ldl = overview.analytes.find((a) => a.analyteKey === 'ldl_c')!;
    expect(ldl.latest).toMatchObject({ value: 2.8, unit: 'mmol/L', canonicalValue: 108.276, canonicalUnit: 'mg/dL', abnormalFlag: 'H', source: 'function_health' });
    expect(ldl.flaggedLatest).toBe(true);
    expect(overview.analytes.find((a) => a.analyteKey === 'fasting_glucose')!.latest!.qualityFlags).toContain('CORRECTED_AT_REVIEW');
    expect(overview.documents[0]).toMatchObject({ kind: 'LAB_CSV', resultsStaged: 0, resultsConfirmed: 5, extractionStatus: 'CONFIRMED' });
    const file = await app.inject({ method: 'GET', url: `/v1/documents/${overview.documents[0]!.id}/file`, headers: auth });
    expect(file.statusCode).toBe(200);
    expect(file.body).toContain('Apolipoprotein B');

    // Manual entry of the same ApoB value becomes a linked duplicate (file import outranks manual); idempotent on clientEntryId
    const manual = await app.inject({ method: 'POST', url: '/v1/labs/results', headers: auth, payload: { analyteRawName: 'Apolipoprotein B', value: 78.4, unit: 'mg/dL', collectedAt: '2026-09-20', laboratory: 'Quest Diagnostics', clientEntryId: 'manual-lab-0001' } });
    expect(manual.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/v1/labs/results', headers: auth, payload: { analyteRawName: 'Apolipoprotein B', value: 78.4, unit: 'mg/dL', collectedAt: '2026-09-20', clientEntryId: 'manual-lab-0001' } })).statusCode).toBe(200);
    const apob = LabsOverviewResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/labs', headers: auth })).json()).analytes.find((a) => a.analyteKey === 'apob')!;
    expect(apob.count).toBe(1);
    expect(apob.history).toHaveLength(2);
    expect(apob.history.find((h) => h.source === 'manual')!.canonical).toBe(false);

    // Same file again: decided rows are untouched
    const again = LabImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/labs', headers: auth, payload: { csv: CSV, fileName: 'function-export.csv', source: 'function_health' } })).json());
    expect(again).toMatchObject({ staged: 0, unchanged: 6 });

    const today = (await app.inject({ method: 'GET', url: '/v1/dashboard/today', headers: auth })).json() as { domains: Array<{ domain: string; status: string; evidence: string[]; metrics: Array<{ metricId: string; freshness: { status: string; reason: string } }> }>; doToday: string[] };
    const clin = today.domains.find((d) => d.domain === 'clinical_preventive')!;
    expect(clin.status).toBe('WATCH'); // the lab flagged LDL as H; the app reports, never interprets
    expect(clin.evidence[0]).toMatch(/5 confirmed lab results; latest panel collected 2026-09-20 with 1 lab-flagged value/);
    expect(clin.metrics.find((m) => m.metricId === 'lab_result')!.freshness.status).toBe('CURRENT');
    // Unknown layouts and bad payloads
    expect(LabImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/labs', headers: auth, payload: { csv: 'a,b\n1,2' } })).json()).rows).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/v1/imports/labs', headers: auth, payload: { csv: 'x', pdfBase64: 'eA==' } })).statusCode).toBe(400);
  });

  it('extracts a PDF text layer into staged rows with confidence; non-PDF bytes are refused', async () => {
    const { auth } = await login(app, uniqueEmail('labpdf'));
    const pdf = makePdf(['Quest Diagnostics', 'Patient: SYNTHETIC PERSON', 'Collected: 09/20/2026', 'Reported: 09/22/2026', 'Lipid Panel', 'Apolipoprotein B 78 mg/dL <90', 'LDL Cholesterol Calc (NIH) 112 mg/dL <100 H', 'Triglycerides 95 mg/dL <150', 'Vitamin D, 25-Hydroxy 31 ng/mL 30-100', 'Page 1 of 1']);
    const res = LabImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/labs', headers: auth, payload: { pdfBase64: pdf.toString('base64'), fileName: 'results.pdf', source: 'function_health' } })).json());
    expect(res).toMatchObject({ format: 'PDF_TEXT', rows: 4, staged: 4, pageCount: 1, collectedAt: '2026-09-20', laboratory: 'Quest Diagnostics' });
    expect(res.preview.map((p) => p.analyteId)).toEqual(['apob', 'ldl_c', 'triglycerides', 'vitamin_d_25oh']);
    expect(res.preview[1]).toMatchObject({ value: 112, abnormalFlag: 'H', referenceHigh: 100 });
    expect(res.preview.every((p) => p.extractionConfidence >= 0.8 && p.flags.includes('EXTRACTED_FROM_PDF_TEXT'))).toBe(true);
    const queue = LabReviewQueueResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/labs/review', headers: auth })).json());
    expect(queue.total).toBe(4);
    expect(queue.pending[0]!.documentId).toBe(res.documentId);
    const notPdf = LabImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/labs', headers: auth, payload: { pdfBase64: Buffer.from('hello').toString('base64') } })).json());
    expect(notPdf.warnings).toEqual(['Not a PDF file']);
    expect(notPdf.staged).toBe(0);
  });
});

describe('Phase 5: Epic clinical records (mock SMART on FHIR)', () => {
  let mock: MockFhir;
  let epicApp: FastifyInstance;
  beforeAll(async () => {
    mock = await startMockFhir();
    epicApp = await buildApp({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_MODE: 'local', LOG_LEVEL: 'silent', ALLOW_DEMO_SEED: 'true', LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret', DOCUMENT_STORAGE_DIR: storage, EPIC_CLIENT_ID: 'epic-test-client', FHIR_BASE_OVERRIDE: mock.fhirBase, PUBLIC_BASE_URL: 'http://api.test', WEB_BASE_URL: 'http://web.test' });
  });
  afterAll(async () => {
    await epicApp.close();
    await mock.close();
  });

  it('is BLOCKED BY CREDENTIALS without EPIC_CLIENT_ID', async () => {
    const { auth } = await login(app, uniqueEmail('fhir-blocked'));
    const start = await app.inject({ method: 'GET', url: '/v1/oauth/clinical_fhir/start?org=weill_cornell', headers: auth });
    expect(start.statusCode).toBe(503);
    expect(start.json().message).toMatch(/BLOCKED BY CREDENTIALS/);
    const sources = (await app.inject({ method: 'GET', url: '/v1/sources', headers: auth })).json() as { sources: Array<{ connectorId: string; implementationStatus: string; actions: string[] }> };
    const fhir = sources.sources.find((s) => s.connectorId === 'clinical_fhir')!;
    expect(fhir.implementationStatus).toBe('BLOCKED_BY_CREDENTIALS');
    expect(fhir.actions).not.toContain('connect');
  });

  it('connects an organization (PKCE + aud), imports labs as confirmed, conditions, medication source records, allergies and events, refreshes tokens and reconciles idempotently', async () => {
    const { auth, userId } = await login(epicApp, uniqueEmail('fhir'));
    expect((await epicApp.inject({ method: 'GET', url: '/v1/oauth/clinical_fhir/start', headers: auth })).statusCode).toBe(400);
    const start = await epicApp.inject({ method: 'GET', url: '/v1/oauth/clinical_fhir/start?org=weill_cornell', headers: auth });
    expect(start.statusCode).toBe(200);
    const url = new URL(start.json().url);
    expect(url.origin + url.pathname).toBe(`${mock.base}/oauth2/authorize`);
    expect(url.searchParams.get('aud')).toBe(mock.fhirBase.replace(/\/$/, ''));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe('epic-test-client');
    const state = url.searchParams.get('state')!;
    const cb = await epicApp.inject({ method: 'GET', url: `/v1/oauth/clinical_fhir/callback?code=good&state=${state}` });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('http://web.test/sources?connected=clinical_fhir');
    expect((await epicApp.inject({ method: 'GET', url: `/v1/oauth/clinical_fhir/callback?code=good&state=${state}` })).statusCode).toBe(302); // state is single-use → redirected with error
    expect(mock.requests.find((r) => r.url === '/oauth2/token')!.body).toContain('code_verifier=');

    const labs = LabsOverviewResponseSchema.parse((await epicApp.inject({ method: 'GET', url: '/v1/labs', headers: auth })).json());
    expect(labs.sources).toEqual(['clinical_fhir']);
    expect(labs.pendingReview).toBe(0);
    expect(labs.analytes.map((a) => a.analyteKey)).toEqual(['apob', 'ldl_c', 'hba1c']);
    expect(labs.analytes[1]!.latest).toMatchObject({ value: 112, abnormalFlag: 'H', laboratory: 'Weill Cornell Clinical Laboratory', verificationStatus: 'CONFIRMED' });
    expect(labs.analytes[0]!.latest!.qualityFlags).toContain('CLINICAL_RECORD');
    const records = ClinicalRecordsResponseSchema.parse((await epicApp.inject({ method: 'GET', url: '/v1/clinical/records', headers: auth })).json());
    expect(records.conditions).toHaveLength(1);
    expect(records.conditions[0]).toMatchObject({ name: 'Essential hypertension', code: 'I10', status: 'ACTIVE', source: 'CLINICIAN', verificationStatus: 'CONFIRMED' });
    expect(records.allergies[0]).toMatchObject({ substance: 'Penicillin', severity: 'MODERATE', source: 'CLINICAL_FHIR' });
    expect(records.events.map((e) => e.kind).sort()).toEqual(['VACCINATION', 'VISIT']);
    const meds = MedicationsResponseSchema.parse((await epicApp.inject({ method: 'GET', url: '/v1/medications', headers: auth })).json());
    expect(meds.unreconciled).toHaveLength(1);
    expect(meds.unreconciled[0]).toMatchObject({ source: 'clinical_fhir', name: 'Lisinopril 10 MG Oral Tablet', status: 'UNRECONCILED' });
    const sources = (await epicApp.inject({ method: 'GET', url: '/v1/sources', headers: auth })).json() as { sources: Array<{ connectorId: string; connectionStatus: string; implementationStatus: string; lastError: string | null; actions: string[] }> };
    const fhirSrc = sources.sources.find((s) => s.connectorId === 'clinical_fhir')!;
    expect(fhirSrc.connectionStatus).toBe('CONNECTED');
    expect(fhirSrc.lastError).toMatch(/Procedure/); // scope-denied resource is reported, not hidden
    expect(fhirSrc.actions).toEqual(expect.arrayContaining(['reconnect', 'refresh', 'disconnect']));

    // Reconcile the medication record into a confirmed medication
    const rec = (await epicApp.inject({ method: 'POST', url: '/v1/medications/reconcile', headers: auth, payload: { performedBy: 'USER', decisions: [{ sourceRecordId: meds.unreconciled[0]!.id, action: 'CREATE', medication: { name: 'Lisinopril', dosage: '10 mg', frequency: 'daily', status: 'CURRENT', indication: 'hypertension' } }] } })).json();
    expect(rec).toMatchObject({ created: 1, linked: 0, ignored: 0 });
    const meds2 = MedicationsResponseSchema.parse((await epicApp.inject({ method: 'GET', url: '/v1/medications', headers: auth })).json());
    expect(meds2.unreconciled).toHaveLength(0);
    expect(meds2.medications[0]).toMatchObject({ name: 'Lisinopril', status: 'CURRENT', source: 'clinical_fhir', prescribingClinician: 'Dr. Synthetic', rxnorm: '314076' });
    expect(meds2.medications[0]!.sourceRecords).toHaveLength(1);
    expect(meds2.reconciliations).toHaveLength(1);

    // Token expiring → refresh rotates; reconcile re-pulls idempotently
    await withService(epicApp.ctx.pool, (tx) => tx.query(`update public.source_connections set token_expires_at = now() where user_id = $1 and connector = 'clinical_fhir'`, [userId]));
    const refresh = await epicApp.inject({ method: 'POST', url: '/v1/sources/clinical_fhir/refresh', headers: auth });
    expect(refresh.statusCode).toBe(200);
    const result = FhirImportResultSchema.parse(refresh.json());
    expect(result).toMatchObject({ organization: 'weill_cornell', patientId: 'pat-123', labsStaged: 0, labsUnchanged: 3, conditions: 1, medicationSourceRecords: 1, allergies: 1, events: 2 });
    expect(result.warnings[0]).toMatch(/Procedure/);
    expect(mock.refreshCount).toBe(1);
    expect(MedicationsResponseSchema.parse((await epicApp.inject({ method: 'GET', url: '/v1/medications', headers: auth })).json()).unreconciled).toHaveLength(0); // linked record stays linked
    expect(LabsOverviewResponseSchema.parse((await epicApp.inject({ method: 'GET', url: '/v1/labs', headers: auth })).json()).analytes[0]!.count).toBe(1);

    // Disconnect clears tokens
    expect((await epicApp.inject({ method: 'POST', url: '/v1/sources/clinical_fhir/disconnect', headers: auth })).statusCode).toBe(204);
    expect((await epicApp.inject({ method: 'POST', url: '/v1/sources/clinical_fhir/refresh', headers: auth })).statusCode).toBe(409);
  });
});

describe('Phase 5: medications, preventive care and the physician brief', () => {
  it('manages medications, supplements and allergies; computes preventive statuses and exports a calendar; generates a brief with a PDF', async () => {
    const { auth } = await login(app, uniqueEmail('clinical'));
    const med = await app.inject({ method: 'POST', url: '/v1/medications', headers: auth, payload: { name: 'Atorvastatin', dosage: '20 mg', frequency: 'nightly', status: 'CURRENT', prescribingClinician: 'Dr. Synthetic' } });
    expect(med.statusCode).toBe(201);
    const supp = await app.inject({ method: 'POST', url: '/v1/supplements', headers: auth, payload: { name: 'Vitamin D3', dose: '2000 IU', frequency: 'daily', purpose: 'low 25-OH D', monthlyCostCents: 800 } });
    expect(supp.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/v1/allergies', headers: auth, payload: { substance: 'Sulfa drugs', reaction: 'rash', severity: 'MILD' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/v1/medications', headers: auth, payload: { dosage: 'no name' } })).statusCode).toBe(400);
    let meds = MedicationsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/medications', headers: auth })).json());
    expect(meds.medications[0]!.name).toBe('Atorvastatin');
    expect(meds.supplements[0]!.monthlyCostCents).toBe(800);
    expect(meds.allergies[0]!.substance).toBe('Sulfa drugs');
    expect(meds.interactionsCheck.status).toBe('NOT_IMPLEMENTED');
    expect((await app.inject({ method: 'PATCH', url: `/v1/medications/${med.json().id}`, headers: auth, payload: { status: 'AS_NEEDED', refillDate: '2026-11-01' } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/v1/supplements/${supp.json().id}`, headers: auth })).statusCode).toBe(204);
    meds = MedicationsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/medications', headers: auth })).json());
    expect(meds.medications[0]).toMatchObject({ status: 'AS_NEEDED', refillDate: '2026-11-01' });
    expect(meds.supplements).toHaveLength(0);

    // Preventive care: guideline source is mandatory; statuses derive from completion + interval
    expect((await app.inject({ method: 'POST', url: '/v1/preventive', headers: auth, payload: { title: 'No source', category: 'LAB_RETEST' } })).statusCode).toBe(400);
    const item = await app.inject({ method: 'POST', url: '/v1/preventive', headers: auth, payload: { title: 'Lipid panel retest', category: 'LAB_RETEST', guidelineSource: 'Clinician-set interval', guidelineReviewedAt: '2026-03-01', intervalMonths: 6, lastCompletedAt: '2026-03-01', status: 'COMPLETED' } });
    expect(item.statusCode).toBe(201);
    await app.inject({ method: 'POST', url: '/v1/preventive', headers: auth, payload: { title: 'Colorectal cancer screening', category: 'CANCER_SCREENING', guidelineSource: 'USPSTF (verify eligibility)', status: 'DISCUSS_WITH_CLINICIAN' } });
    let prev = PreventiveResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/preventive', headers: auth })).json());
    expect(prev.items.find((i) => i.title === 'Lipid panel retest')).toMatchObject({ computedStatus: 'DUE', computedDueAt: '2026-09-01' });
    expect(prev.items.find((i) => i.title === 'Colorectal cancer screening')!.computedStatus).toBe('DISCUSS_WITH_CLINICIAN');
    expect(prev.counts).toMatchObject({ due: 1, discuss: 1 });
    expect(prev.templates.length).toBeGreaterThan(5);
    expect((await app.inject({ method: 'POST', url: `/v1/preventive/${item.json().id}/complete`, headers: auth, payload: { completedAt: '2026-10-10', note: 'done at Quest' } })).statusCode).toBe(204);
    prev = PreventiveResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/preventive', headers: auth })).json());
    const lipid = prev.items.find((i) => i.title === 'Lipid panel retest')!;
    expect(lipid).toMatchObject({ computedStatus: 'COMPLETED', computedDueAt: '2027-04-10', lastCompletedAt: '2026-10-10' });
    expect(lipid.completionHistory).toHaveLength(1);
    const ics = await app.inject({ method: 'GET', url: '/v1/preventive/calendar.ics', headers: auth });
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('SUMMARY:Lipid panel retest');
    expect(ics.body).toContain('DTSTART;VALUE=DATE:20270410');
    // Today reflects a DUE item for a user who has one
    const { auth: dueAuth } = await login(app, uniqueEmail('due'));
    await app.inject({ method: 'POST', url: '/v1/preventive', headers: dueAuth, payload: { title: 'Dental cleaning', category: 'DENTAL', guidelineSource: 'Dentist', intervalMonths: 6, lastCompletedAt: '2025-01-01', status: 'COMPLETED' } });
    const today = (await app.inject({ method: 'GET', url: '/v1/dashboard/today', headers: dueAuth })).json() as { whatMatters: string[]; domains: Array<{ domain: string; status: string }> };
    expect(today.whatMatters.some((w) => w.includes('preventive-care item'))).toBe(true);
    expect(today.domains.find((d) => d.domain === 'clinical_preventive')!.status).toBe('WATCH');

    // Physician brief
    await app.inject({ method: 'POST', url: '/v1/clinical/conditions', headers: auth, payload: { name: 'Hyperlipidemia', status: 'ACTIVE', onsetDate: '2024-01-01' } });
    await app.inject({ method: 'POST', url: '/v1/labs/results', headers: auth, payload: { analyteRawName: 'LDL Cholesterol', value: 118, unit: 'mg/dL', referenceHigh: 100, abnormalFlag: 'H', collectedAt: '2026-09-20', clientEntryId: 'manual-lab-brief-1' } });
    const brief = await app.inject({ method: 'POST', url: '/v1/physician-brief', headers: auth, payload: { reasonForVisit: 'Annual visit', concerns: ['LDL still above target'], questions: ['Is the statin dose adequate?'], clinicianName: 'Dr. Synthetic' } });
    expect(brief.statusCode).toBe(201);
    const content = brief.json().content as Record<string, unknown>;
    expect(content.algorithm).toBe('physician_brief');
    expect((content.medications as unknown[]).length).toBe(1);
    expect((content.conditions as Array<{ name: string }>)[0]!.name).toBe('Hyperlipidemia');
    expect((content.labs as Array<{ analyte: string; flaggedLatest: boolean }>)[0]).toMatchObject({ analyte: 'LDL-C', flaggedLatest: true });
    expect((content.preventive as unknown[]).length).toBe(1); // the DISCUSS item
    expect(content.disclaimer).toMatch(/no AI-generated recommendations/);
    const list = (await app.inject({ method: 'GET', url: '/v1/physician-brief', headers: auth })).json() as { briefs: Array<{ id: string }> };
    expect(list.briefs[0]!.id).toBe(brief.json().id);
    const pdf = await app.inject({ method: 'GET', url: `/v1/physician-brief/${brief.json().id}/pdf`, headers: auth });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    // Another user cannot read it
    const other = await login(app, uniqueEmail('clinical-other'));
    expect((await app.inject({ method: 'GET', url: `/v1/physician-brief/${brief.json().id}`, headers: other.auth })).statusCode).toBe(404);
  });
});
