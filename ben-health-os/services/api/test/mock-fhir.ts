import { createServer, type Server } from 'node:http';

/** Canned Epic-style SMART + FHIR R4 endpoints: discovery, token exchange/refresh, paged Observation search, other resources, a scope-denied Procedure search. */
export interface MockFhir {
  base: string;
  fhirBase: string;
  refreshCount: number;
  accessToken: string;
  refreshToken: string;
  requests: Array<{ method: string; url: string; auth: string | undefined; body: string }>;
  close: () => Promise<void>;
}

const lab = (id: string, loinc: string, name: string, value: number, unit: string, high: number | null, interp: string | null, when: string) => ({
  resourceType: 'Observation', id, status: 'final', category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
  code: { coding: [{ system: 'http://loinc.org', code: loinc, display: name }], text: name }, valueQuantity: { value, unit, code: unit },
  ...(high !== null ? { referenceRange: [{ high: { value: high }, text: `<${high}` }] } : {}), ...(interp ? { interpretation: [{ coding: [{ code: interp }] }] } : {}),
  effectiveDateTime: when, issued: when, performer: [{ display: 'Weill Cornell Clinical Laboratory' }],
});

export async function startMockFhir(): Promise<MockFhir> {
  const state: MockFhir = { base: '', fhirBase: '', refreshCount: 0, accessToken: 'fhir-access-1', refreshToken: 'fhir-refresh-1', requests: [], close: async () => undefined };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.requests.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      const json = (code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/fhir+json' });
        res.end(JSON.stringify(obj));
      };
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/r4/.well-known/smart-configuration') return json(200, { authorization_endpoint: `${state.base}/oauth2/authorize`, token_endpoint: `${state.base}/oauth2/token`, code_challenge_methods_supported: ['S256'], capabilities: ['launch-standalone', 'client-public', 'permission-patient'] });
      if (u.pathname === '/oauth2/token') {
        const form = new URLSearchParams(body);
        if (form.get('grant_type') === 'authorization_code') return form.get('code') === 'good' && form.get('code_verifier') ? json(200, { access_token: state.accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: state.refreshToken, scope: 'patient/*.read offline_access', patient: 'pat-123' }) : json(400, { error: 'invalid_grant' });
        if (form.get('grant_type') === 'refresh_token') {
          if (form.get('refresh_token') !== state.refreshToken) return json(400, { error: 'invalid_grant' });
          state.refreshCount++;
          state.accessToken = `fhir-access-${state.refreshCount + 1}`;
          state.refreshToken = `fhir-refresh-${state.refreshCount + 1}`;
          return json(200, { access_token: state.accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: state.refreshToken, patient: 'pat-123' });
        }
      }
      if (u.pathname.startsWith('/r4/')) {
        if (req.headers.authorization !== `Bearer ${state.accessToken}`) return json(401, { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'login' }] });
        if (u.searchParams.get('patient') !== 'pat-123') return json(400, { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: 'patient required' }] });
        const type = u.pathname.replace('/r4/', '');
        if (type === 'Observation') {
          if (u.searchParams.get('page') === '2') return json(200, { resourceType: 'Bundle', entry: [{ resource: lab('ob-3', '4548-4', 'Hemoglobin A1c', 5.4, '%', 5.6, null, '2026-09-20T13:05:00Z') }, { resource: { resourceType: 'Observation', id: 'vit-1', status: 'final', category: [{ coding: [{ code: 'vital-signs' }] }], code: { text: 'Heart rate' }, valueQuantity: { value: 62, unit: '/min' } } }] });
          return json(200, { resourceType: 'Bundle', link: [{ relation: 'next', url: `${state.base}/r4/Observation?patient=pat-123&category=laboratory&page=2` }], entry: [{ resource: lab('ob-1', '1884-6', 'Apolipoprotein B', 78, 'mg/dL', 90, 'N', '2026-09-20T13:05:00Z') }, { resource: lab('ob-2', '13457-7', 'LDL Cholesterol Calc', 112, 'mg/dL', 100, 'H', '2026-09-20T13:05:00Z') }] });
        }
        if (type === 'Condition') return json(200, { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Condition', id: 'c1', code: { text: 'Essential hypertension', coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10' }] }, clinicalStatus: { coding: [{ code: 'active' }] }, verificationStatus: { coding: [{ code: 'confirmed' }] }, onsetDateTime: '2020-03-01' } }] });
        if (type === 'MedicationRequest') return json(200, { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'MedicationRequest', id: 'm1', status: 'active', medicationCodeableConcept: { text: 'Lisinopril 10 MG Oral Tablet', coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '314076' }] }, dosageInstruction: [{ text: 'Take 1 tablet daily' }], authoredOn: '2026-01-10', requester: { display: 'Dr. Synthetic' } } }] });
        if (type === 'AllergyIntolerance') return json(200, { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'AllergyIntolerance', id: 'a1', code: { text: 'Penicillin' }, reaction: [{ manifestation: [{ text: 'Hives' }], severity: 'moderate' }], recordedDate: '2015-05-05' } }] });
        if (type === 'Immunization') return json(200, { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Immunization', id: 'i1', vaccineCode: { text: 'Influenza vaccine' }, occurrenceDateTime: '2025-10-01', status: 'completed' } }] });
        if (type === 'Procedure') return json(403, { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden', diagnostics: 'scope patient/Procedure.read not granted' }] });
        if (type === 'Encounter') return json(200, { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Encounter', id: 'e1', type: [{ text: 'Office Visit' }], period: { start: '2026-02-02T15:00:00Z' }, serviceProvider: { display: 'Weill Cornell Medicine' } } }] });
        return json(200, { resourceType: 'Bundle', entry: [] });
      }
      json(404, { resourceType: 'OperationOutcome' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  state.base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  state.fhirBase = `${state.base}/r4/`;
  state.close = () => new Promise<void>((r) => server.close(() => r()));
  return state;
}
