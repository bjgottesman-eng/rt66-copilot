import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, formBody, requestJson, type HttpOptions } from '../http.js';
import type { OAuthTokens } from '../oauth.js';

/** Oura API v2 (verified 2026-10-12, docs/research/oura-api-verification.md). */
export interface OuraConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Default https://api.ouraring.com */
  apiBase?: string;
  /** Default https://cloud.ouraring.com */
  authBase?: string;
}

export const OURA_SCOPES = ['email', 'personal', 'daily', 'heartrate', 'workout', 'tag', 'session', 'spo2', 'heart_health'] as const;

/** Collections we import, with their query style. */
export const OURA_DATA_TYPES = {
  sleep: 'date',
  daily_sleep: 'date',
  daily_readiness: 'date',
  daily_activity: 'date',
  daily_spo2: 'date',
  daily_stress: 'date',
  daily_resilience: 'date',
  daily_cardiovascular_age: 'date',
  vO2_max: 'date',
  workout: 'date',
  session: 'date',
  heartrate: 'datetime',
} as const;
export type OuraDataType = keyof typeof OURA_DATA_TYPES;

export interface OuraSubscription {
  id: string;
  callback_url: string;
  event_type: 'create' | 'update' | 'delete';
  data_type: string;
  expiration_time: string;
}

export interface OuraWebhookEvent {
  event_type: 'create' | 'update' | 'delete';
  data_type: string;
  object_id: string;
  event_time: string;
  user_id: string;
}

export class OuraClient {
  private readonly apiBase: string;
  private readonly authBase: string;
  constructor(private readonly cfg: OuraConfig, private readonly http: HttpOptions = {}) {
    this.apiBase = (cfg.apiBase ?? 'https://api.ouraring.com').replace(/\/$/, '');
    this.authBase = (cfg.authBase ?? 'https://cloud.ouraring.com').replace(/\/$/, '');
  }

  authorizeUrl(params: { state: string; codeChallenge: string; scopes?: readonly string[] }): string {
    const u = new URL(`${this.authBase}/oauth/authorize`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('redirect_uri', this.cfg.redirectUri);
    u.searchParams.set('state', params.state);
    u.searchParams.set('scope', (params.scopes ?? OURA_SCOPES).join(' '));
    u.searchParams.set('code_challenge', params.codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  private tokenRequest(form: Record<string, string>): Promise<OAuthTokens> {
    return requestJson<{ token_type: string; access_token: string; expires_in: number; refresh_token?: string; scope?: string }>(
      `${this.apiBase}/oauth/token`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: formBody({ ...form, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }) },
      { ...this.http, retries: 1 },
    ).then((t) => ({
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: new Date(Date.now() + (t.expires_in ?? 86_400) * 1000).toISOString(),
      scope: t.scope ?? null,
      raw: { token_type: t.token_type, expires_in: t.expires_in, scope: t.scope },
    }));
  }

  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri, code_verifier: codeVerifier });
  }

  /** Refresh tokens are single-use: the caller must persist the returned pair immediately. */
  refresh(refreshToken: string): Promise<OAuthTokens> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revoke(accessToken: string): Promise<void> {
    await requestJson(`${this.apiBase}/oauth/revoke?access_token=${encodeURIComponent(accessToken)}`, { method: 'POST' }, { ...this.http, retries: 0 }).catch(() => undefined);
  }

  personalInfo(accessToken: string): Promise<{ id: string; email?: string; age?: number; weight?: number; height?: number; biological_sex?: string }> {
    return requestJson(`${this.apiBase}/v2/usercollection/personal_info`, { headers: { authorization: `Bearer ${accessToken}` } }, this.http);
  }

  /** Lists every document of a type in the range, following next_token. Dates are YYYY-MM-DD; datetimes ISO. */
  async listDocuments(accessToken: string, dataType: OuraDataType, range: { start: string; end: string }): Promise<Array<Record<string, unknown>>> {
    const style = OURA_DATA_TYPES[dataType];
    const out: Array<Record<string, unknown>> = [];
    let nextToken: string | null = null;
    do {
      const u = new URL(`${this.apiBase}/v2/usercollection/${dataType}`);
      if (style === 'date') {
        u.searchParams.set('start_date', range.start);
        u.searchParams.set('end_date', range.end);
      } else {
        u.searchParams.set('start_datetime', range.start);
        u.searchParams.set('end_datetime', range.end);
      }
      if (nextToken) u.searchParams.set('next_token', nextToken);
      const page: { data: Array<Record<string, unknown>>; next_token: string | null } = await requestJson(u.toString(), { headers: { authorization: `Bearer ${accessToken}` } }, this.http);
      out.push(...(page.data ?? []));
      nextToken = page.next_token ?? null;
    } while (nextToken);
    return out;
  }

  getDocument(accessToken: string, dataType: string, id: string): Promise<Record<string, unknown>> {
    return requestJson(`${this.apiBase}/v2/usercollection/${dataType}/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${accessToken}` } }, this.http);
  }

  private appHeaders(): Record<string, string> {
    return { 'x-client-id': this.cfg.clientId, 'x-client-secret': this.cfg.clientSecret, 'content-type': 'application/json' };
  }

  listSubscriptions(): Promise<OuraSubscription[]> {
    return requestJson(`${this.apiBase}/v2/webhook/subscription`, { headers: this.appHeaders() }, this.http);
  }

  createSubscription(body: { callbackUrl: string; verificationToken: string; eventType: 'create' | 'update' | 'delete'; dataType: string }): Promise<OuraSubscription> {
    return requestJson(`${this.apiBase}/v2/webhook/subscription`, { method: 'POST', headers: this.appHeaders(), body: JSON.stringify({ callback_url: body.callbackUrl, verification_token: body.verificationToken, event_type: body.eventType, data_type: body.dataType }) }, { ...this.http, retries: 0 });
  }

  renewSubscription(id: string): Promise<OuraSubscription> {
    return requestJson(`${this.apiBase}/v2/webhook/subscription/renew/${encodeURIComponent(id)}`, { method: 'PUT', headers: this.appHeaders() }, this.http);
  }

  async deleteSubscription(id: string): Promise<void> {
    await requestJson(`${this.apiBase}/v2/webhook/subscription/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.appHeaders() }, { ...this.http, retries: 0 });
  }

  /** x-oura-signature = HMAC-SHA256(clientSecret, timestamp + rawBody), uppercase hex. */
  static verifySignature(clientSecret: string, timestamp: string, rawBody: string, signature: string | undefined): boolean {
    if (!signature || !timestamp) return false;
    const expected = createHmac('sha256', clientSecret).update(timestamp + rawBody).digest('hex').toUpperCase();
    const a = Buffer.from(expected);
    const b = Buffer.from(signature.toUpperCase());
    return a.length === b.length && timingSafeEqual(a, b);
  }

  static isAuthError(e: unknown): boolean {
    return e instanceof HttpError && (e.status === 401 || e.status === 403);
  }
}
