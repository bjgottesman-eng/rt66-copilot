import { formBody, requestJson, type HttpOptions } from '../http.js';
import type { OAuthTokens } from '../oauth.js';

/** Withings Public API (verified 2026-10-12, docs/research/withings-api-verification.md). */
export interface WithingsConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Default https://wbsapi.withings.net */
  apiBase?: string;
  /** Default https://account.withings.com */
  accountBase?: string;
}

export const WITHINGS_SCOPES = ['user.info', 'user.metrics', 'user.activity'] as const;

/** Measure types we import (verified codes). */
export const WITHINGS_MEASTYPES = { weight: 1, height: 4, fatFreeMass: 5, fatRatio: 6, fatMass: 8, diastolic: 9, systolic: 10, pulse: 11, spo2: 54, bodyTemperature: 71, vo2max: 123 } as const;
export const WITHINGS_DEFAULT_MEASTYPES = [10, 9, 11, 1, 6, 5, 54, 71, 123, 4];
/** Notification categories (appli). */
export const WITHINGS_APPLI = { weight: 1, temperature: 2, bloodPressure: 4, activity: 16, sleep: 44, userProfile: 46 } as const;

export class WithingsApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Withings status ${status}: ${message}`);
    this.name = 'WithingsApiError';
  }
  get isAuthError(): boolean {
    return [100, 101, 102, 200, 401, 342, 343].includes(this.status);
  }
  get isRateLimit(): boolean {
    return this.status === 601;
  }
}

export interface WithingsMeasure {
  value: number;
  type: number;
  unit: number;
  algo?: number;
  fm?: number;
}
export interface WithingsMeasureGroup {
  grpid: number;
  attrib: number;
  date: number;
  created: number;
  modified: number;
  category: number;
  deviceid: string | null;
  hash_deviceid: string | null;
  model?: string | null;
  measures: WithingsMeasure[];
  comment?: string | null;
}
export interface WithingsGetMeasResult {
  groups: WithingsMeasureGroup[];
  timezone: string;
  updatetime: number;
}
export interface WithingsDevice {
  type: string;
  model: string;
  model_id: number;
  battery: string;
  deviceid: string;
  hash_deviceid?: string;
  timezone: string;
  first_session_date?: number;
  last_session_date?: number;
}

interface Envelope<T> {
  status: number;
  body?: T;
  error?: string;
}

export class WithingsClient {
  private readonly apiBase: string;
  private readonly accountBase: string;
  constructor(private readonly cfg: WithingsConfig, private readonly http: HttpOptions = {}) {
    this.apiBase = (cfg.apiBase ?? 'https://wbsapi.withings.net').replace(/\/$/, '');
    this.accountBase = (cfg.accountBase ?? 'https://account.withings.com').replace(/\/$/, '');
  }

  authorizeUrl(params: { state: string; scopes?: readonly string[]; demo?: boolean }): string {
    const u = new URL(`${this.accountBase}/oauth2_user/authorize2`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('scope', (params.scopes ?? WITHINGS_SCOPES).join(','));
    u.searchParams.set('redirect_uri', this.cfg.redirectUri);
    u.searchParams.set('state', params.state);
    if (params.demo) u.searchParams.set('mode', 'demo');
    return u.toString();
  }

  private async call<T>(path: string, params: Record<string, string | number | undefined | null>, accessToken?: string, retries = 3): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const env = await requestJson<Envelope<T>>(`${this.apiBase}${path}`, { method: 'POST', headers, body: formBody(params) }, { ...this.http, retries });
    if (env.status !== 0) throw new WithingsApiError(env.status, env.error ?? 'unknown error');
    return (env.body ?? ({} as T)) as T;
  }

  private async token(form: Record<string, string>): Promise<OAuthTokens> {
    const b = await this.call<{ userid: number | string; access_token: string; refresh_token: string; expires_in: number; scope?: string; token_type?: string }>(
      '/v2/oauth2',
      { action: 'requesttoken', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, ...form },
      undefined,
      1,
    );
    return {
      accessToken: b.access_token,
      refreshToken: b.refresh_token,
      expiresAt: new Date(Date.now() + (b.expires_in ?? 10_800) * 1000).toISOString(),
      scope: b.scope ?? null,
      externalUserId: String(b.userid),
      raw: { expires_in: b.expires_in, token_type: b.token_type },
    };
  }

  exchangeCode(code: string): Promise<OAuthTokens> {
    return this.token({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri });
  }

  /** Every refresh returns a NEW refresh token; always replace the stored one. */
  refresh(refreshToken: string): Promise<OAuthTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /**
   * Fetches measure groups, following `more`/`offset`. Use `lastupdate` (unix seconds) for
   * incremental sync and keep the returned `updatetime` as the next cursor.
   */
  async getMeasures(accessToken: string, params: { meastypes?: number[]; lastupdate?: number; startdate?: number; enddate?: number; category?: number }): Promise<WithingsGetMeasResult> {
    const groups: WithingsMeasureGroup[] = [];
    let offset: number | undefined;
    let timezone = 'UTC';
    let updatetime = Math.floor(Date.now() / 1000);
    do {
      const body = await this.call<{ updatetime: number; timezone: string; measuregrps: WithingsMeasureGroup[]; more?: number; offset?: number }>(
        '/measure',
        {
          action: 'getmeas',
          meastypes: (params.meastypes ?? WITHINGS_DEFAULT_MEASTYPES).join(','),
          category: params.category ?? 1,
          lastupdate: params.lastupdate,
          startdate: params.startdate,
          enddate: params.enddate,
          offset,
        },
        accessToken,
      );
      groups.push(...(body.measuregrps ?? []));
      timezone = body.timezone ?? timezone;
      updatetime = body.updatetime ?? updatetime;
      offset = body.more ? body.offset : undefined;
    } while (offset !== undefined);
    return { groups, timezone, updatetime };
  }

  async getDevices(accessToken: string): Promise<WithingsDevice[]> {
    const b = await this.call<{ devices: WithingsDevice[] }>('/v2/user', { action: 'getdevice' }, accessToken);
    return b.devices ?? [];
  }

  subscribe(accessToken: string, callbackUrl: string, appli: number, comment = 'Ben Health OS'): Promise<void> {
    return this.call<void>('/notify', { action: 'subscribe', callbackurl: callbackUrl, appli, comment }, accessToken, 1);
  }

  async listSubscriptions(accessToken: string, appli?: number): Promise<Array<{ appli: number; callbackurl: string; expires: number; comment: string }>> {
    const b = await this.call<{ profiles: Array<{ appli: number; callbackurl: string; expires: number; comment: string }> }>('/notify', { action: 'list', appli }, accessToken);
    return b.profiles ?? [];
  }

  revoke(accessToken: string, callbackUrl: string, appli: number): Promise<void> {
    return this.call<void>('/notify', { action: 'revoke', callbackurl: callbackUrl, appli }, accessToken, 1);
  }
}
