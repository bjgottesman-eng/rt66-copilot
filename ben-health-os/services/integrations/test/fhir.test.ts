import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { FhirClient, SmartClient, discoverSmart, generatePkce, mapAllergyIntolerance, mapCondition, mapEncounter, mapImmunization, mapMedicationRequest, mapObservationToLab, FHIR_ORGANIZATIONS } from '../src/index.js';

let server: Server;
let base: string;
const seen: Array<{ url: string; auth: string | undefined; body: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url!, auth: req.headers.authorization, body });
      const json = (code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/fhir+json' });
        res.end(JSON.stringify(obj));
      };
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/r4/.well-known/smart-configuration') return json(200, { authorization_endpoint: `${base}/oauth2/authorize`, token_endpoint: `${base}/oauth2/token`, code_challenge_methods_supported: ['S256'], capabilities: ['launch-standalone', 'client-public'] });
      if (u.pathname === '/oauth2/token') {
        const form = new URLSearchParams(body);
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good' && form.get('code_verifier')) return json(200, { access_token: 'fhir-access-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'fhir-refresh-1', scope: 'patient/Observation.read offline_access', patient: 'pat-123' });
        if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'fhir-refresh-1') return json(200, { access_token: 'fhir-access-2', token_type: 'Bearer', expires_in: 3600, refresh_token: 'fhir-refresh-2', patient: 'pat-123' });
        return json(400, { error: 'invalid_grant' });
      }
      if (u.pathname === '/r4/Observation') {
        if (req.headers.authorization !== 'Bearer fhir-access-1') return json(401, { resourceType: 'OperationOutcome' });
        if (u.searchParams.get('page') === '2') return json(200, { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Observation', id: 'o2' } }] });
        return json(200, { resourceType: 'Bundle', link: [{ relation: 'next', url: `${base}/r4/Observation?patient=pat-123&page=2` }], entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }, { resource: { resourceType: 'OperationOutcome' } }] });
      }
      json(404, { resourceType: 'OperationOutcome' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('SMART on FHIR client', () => {
  it('discovers endpoints, builds a PKCE authorize URL with aud, exchanges and refreshes tokens', async () => {
    const smart = await discoverSmart(`${base}/r4/`);
    expect(smart.token_endpoint).toBe(`${base}/oauth2/token`);
    const client = new SmartClient({ clientId: 'cid', redirectUri: 'https://app.example/cb', fhirBase: `${base}/r4/`, smart });
    const pkce = generatePkce();
    const url = new URL(client.authorizeUrl({ state: 'st', codeChallenge: pkce.challenge }));
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('aud')).toBe(`${base}/r4`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('patient/Observation.read');
    const tokens = await client.exchangeCode('good', pkce.verifier);
    expect(tokens).toMatchObject({ accessToken: 'fhir-access-1', refreshToken: 'fhir-refresh-1', patientId: 'pat-123', externalUserId: 'pat-123' });
    expect(seen.find((s) => s.url === '/oauth2/token')!.body).toContain('code_verifier=');
    const refreshed = await client.refresh('fhir-refresh-1');
    expect(refreshed.accessToken).toBe('fhir-access-2');
    await expect(client.exchangeCode('bad', 'v')).rejects.toThrow();
  });
  it('follows bundle paging and keeps only resources of the requested type', async () => {
    const fhir = new FhirClient(`${base}/r4/`, 'fhir-access-1');
    const all = await fhir.searchAll('Observation', { patient: 'pat-123', category: 'laboratory' });
    expect(all.map((r) => r.id)).toEqual(['o1', 'o2']);
    expect(seen.filter((s) => s.url.startsWith('/r4/Observation')).every((s) => s.auth === 'Bearer fhir-access-1')).toBe(true);
    await expect(new FhirClient(`${base}/r4/`, 'wrong').searchAll('Observation', {})).rejects.toThrow();
  });
  it('pins the two Epic organizations with R4 bases', () => {
    expect(FHIR_ORGANIZATIONS.map((o) => o.id)).toEqual(['weill_cornell', 'nyu_langone']);
    expect(FHIR_ORGANIZATIONS.every((o) => o.fhirBase.includes('/R4'))).toBe(true);
  });
});

describe('FHIR R4 mappers', () => {
  it('maps a laboratory Observation with LOINC, reference range, interpretation and dates; skips vitals and panel headers', () => {
    const obs = { resourceType: 'Observation', id: 'ob-1', status: 'final', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }], code: { coding: [{ system: 'http://loinc.org', code: '1884-6', display: 'Apolipoprotein B [Mass/volume] in Serum or Plasma' }], text: 'Apolipoprotein B' }, valueQuantity: { value: 78, unit: 'mg/dL', code: 'mg/dL' }, referenceRange: [{ high: { value: 90 }, text: '<90' }], interpretation: [{ coding: [{ code: 'N' }] }], effectiveDateTime: '2026-09-20T13:05:00Z', issued: '2026-09-22T10:00:00Z', performer: [{ display: 'Quest Diagnostics' }] };
    expect(mapObservationToLab(obs)).toMatchObject({ externalId: 'Observation/ob-1', analyteRawName: 'Apolipoprotein B', loinc: '1884-6', value: 78, unit: 'mg/dL', referenceHigh: 90, referenceText: '<90', abnormalFlag: 'N', collectedAt: '2026-09-20', resultedAt: '2026-09-22', laboratory: 'Quest Diagnostics' });
    const vital = { ...obs, id: 'v', category: [{ coding: [{ code: 'vital-signs' }] }] };
    expect(mapObservationToLab(vital)).toBeNull();
    const panel = { ...obs, id: 'p', valueQuantity: undefined, hasMember: [{ reference: 'Observation/ob-1' }] };
    expect(mapObservationToLab(panel)).toBeNull();
    const comparator = { ...obs, id: 'c', valueQuantity: { value: 0.3, unit: 'mg/L', comparator: '<' } };
    expect(mapObservationToLab(comparator)).toMatchObject({ value: 0.3, valueText: '<0.3' });
  });
  it('maps Condition, MedicationRequest, AllergyIntolerance, Immunization and Encounter with statuses preserved', () => {
    expect(mapCondition({ resourceType: 'Condition', id: 'c1', code: { text: 'Essential hypertension', coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10' }] }, clinicalStatus: { coding: [{ code: 'active' }] }, verificationStatus: { coding: [{ code: 'confirmed' }] }, onsetDateTime: '2020-03-01' })).toMatchObject({ externalId: 'Condition/c1', name: 'Essential hypertension', code: 'I10', status: 'ACTIVE', verificationStatus: 'CONFIRMED', onsetDate: '2020-03-01' });
    expect(mapCondition({ resourceType: 'Condition', id: 'c2', code: { text: 'x' }, clinicalStatus: { coding: [{ code: 'resolved' }] }, verificationStatus: { coding: [{ code: 'provisional' }] } })).toMatchObject({ status: 'RESOLVED', verificationStatus: 'UNVERIFIED' });
    expect(mapMedicationRequest({ resourceType: 'MedicationRequest', id: 'm1', status: 'active', medicationCodeableConcept: { text: 'Lisinopril 10 MG Oral Tablet', coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '314076' }] }, dosageInstruction: [{ text: 'Take 1 tablet daily' }], authoredOn: '2026-01-10', requester: { display: 'Dr. Example' } })).toMatchObject({ externalId: 'MedicationRequest/m1', name: 'Lisinopril 10 MG Oral Tablet', rxnorm: '314076', status: 'active', dosageText: 'Take 1 tablet daily', requester: 'Dr. Example' });
    expect(mapAllergyIntolerance({ resourceType: 'AllergyIntolerance', id: 'a1', code: { text: 'Penicillin' }, reaction: [{ manifestation: [{ text: 'Hives' }], severity: 'moderate' }], recordedDate: '2015-05-05' })).toMatchObject({ substance: 'Penicillin', reaction: 'Hives', severity: 'MODERATE', recordedAt: '2015-05-05' });
    expect(mapImmunization({ resourceType: 'Immunization', id: 'i1', vaccineCode: { text: 'Influenza vaccine' }, occurrenceDateTime: '2025-10-01', status: 'completed' })).toMatchObject({ kind: 'VACCINATION', title: 'Influenza vaccine', occurredAt: '2025-10-01T00:00:00.000Z' });
    expect(mapEncounter({ resourceType: 'Encounter', id: 'e1', type: [{ text: 'Office Visit' }], period: { start: '2026-02-02T15:00:00Z' }, serviceProvider: { display: 'Weill Cornell Medicine' } })).toMatchObject({ kind: 'VISIT', title: 'Office Visit', provider: 'Weill Cornell Medicine' });
    expect(mapImmunization({ resourceType: 'Immunization', id: 'i2' })).toBeNull();
  });
});
