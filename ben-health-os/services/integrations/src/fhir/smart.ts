/**
 * SMART App Launch (standalone launch, patient-facing, public client with PKCE S256) as documented by
 * Epic (fhir.epic.com/Documentation?docId=oauth2) and HL7 SMART App Launch 2.x.
 */
import { requestJson, formBody, type HttpOptions } from '../http.js';
import type { OAuthTokens } from '../oauth.js';

export interface SmartConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  capabilities?: string[];
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
  issuer?: string;
}

/** Default patient-facing scopes; the patient can decline any of them in MyChart. */
export const PATIENT_SCOPES = ['openid', 'fhirUser', 'offline_access', 'patient/Patient.read', 'patient/Observation.read', 'patient/Condition.read', 'patient/MedicationRequest.read', 'patient/AllergyIntolerance.read', 'patient/Immunization.read', 'patient/Procedure.read', 'patient/Encounter.read'];

export async function discoverSmart(fhirBase: string, http: HttpOptions = {}): Promise<SmartConfiguration> {
  const base = fhirBase.replace(/\/$/, '');
  const cfg = await requestJson<SmartConfiguration>(`${base}/.well-known/smart-configuration`, { headers: { accept: 'application/json' } }, http);
  if (!cfg.authorization_endpoint || !cfg.token_endpoint) throw new Error('smart-configuration is missing authorization_endpoint or token_endpoint');
  if (cfg.code_challenge_methods_supported && !cfg.code_challenge_methods_supported.includes('S256')) throw new Error('server does not advertise PKCE S256');
  return cfg;
}

export interface SmartClientConfig {
  clientId: string;
  /** Confidential clients only; patient-facing Epic apps are usually public clients (PKCE, no secret). */
  clientSecret?: string | null;
  redirectUri: string;
  fhirBase: string;
  smart: SmartConfiguration;
}

export interface SmartTokens extends OAuthTokens {
  patientId: string | null;
  idToken: string | null;
}

export class SmartClient {
  constructor(private readonly cfg: SmartClientConfig, private readonly http: HttpOptions = {}) {}

  authorizeUrl(params: { state: string; codeChallenge: string; scopes?: readonly string[] }): string {
    const u = new URL(this.cfg.smart.authorization_endpoint);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('redirect_uri', this.cfg.redirectUri);
    u.searchParams.set('scope', (params.scopes ?? PATIENT_SCOPES).join(' '));
    u.searchParams.set('state', params.state);
    u.searchParams.set('aud', this.cfg.fhirBase.replace(/\/$/, ''));
    u.searchParams.set('code_challenge', params.codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  private async tokenRequest(form: Record<string, string>): Promise<SmartTokens> {
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    const body: Record<string, string> = { ...form, client_id: this.cfg.clientId };
    if (this.cfg.clientSecret) headers.authorization = `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`;
    const t = await requestJson<{ access_token: string; token_type: string; expires_in?: number; refresh_token?: string; scope?: string; patient?: string; id_token?: string }>(this.cfg.smart.token_endpoint, { method: 'POST', headers, body: formBody(body) }, { ...this.http, retries: 1 });
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      scope: t.scope ?? null,
      patientId: t.patient ?? null,
      idToken: t.id_token ?? null,
      externalUserId: t.patient ?? null,
      raw: { token_type: t.token_type, expires_in: t.expires_in, scope: t.scope },
    };
  }

  exchangeCode(code: string, codeVerifier: string): Promise<SmartTokens> {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri, code_verifier: codeVerifier });
  }

  refresh(refreshToken: string): Promise<SmartTokens> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }
}
