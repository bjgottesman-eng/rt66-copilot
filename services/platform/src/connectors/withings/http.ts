/**
 * WithingsHttp — the real Withings Web API (verified against official docs
 * 2026-08-29; see docs/integrations.md for URLs + access dates).
 *
 * Facts encoded here:
 * - Authorize: GET https://account.withings.com/oauth2_user/authorize2
 *   ?response_type=code&client_id=...&scope=user.metrics&redirect_uri=...&state=<nonce>
 *   (scope comma-separated if several; mode=demo optional for the sandbox).
 *   The authorization code lives 30 seconds.
 * - Token: POST https://wbsapi.withings.net/v2/oauth2, form-encoded, with
 *   action=requesttoken plus grant_type=authorization_code|refresh_token,
 *   client_id, client_secret, code/redirect_uri or refresh_token.
 *   Response is HTTP 200 with envelope {"status": int, "body": {...}};
 *   status 0 = success (343 invalid token -> refresh; 601 rate limited).
 *   body: userid, access_token, refresh_token, scope, expires_in (10800 = 3 h),
 *   token_type. REFRESH TOKENS ROTATE EVERY CALL — callers must persist the
 *   new pair atomically before using the new access token.
 * - Measures: POST https://wbsapi.withings.net/measure, form-encoded,
 *   Authorization: Bearer <token>, action=getmeas, meastypes=9,10,11,
 *   category=1. Response body: updatetime, timezone,
 *   measuregrps[{grpid,attrib,date,created,modified,category,deviceid,measures[]}],
 *   more, offset — callers loop while more==1 passing offset.
 * - Notifications: POST https://wbsapi.withings.net/notify,
 *   action=subscribe&callbackurl=...&appli=4 (blood pressure & heart rate).
 *   Withings validates the callback with a HEAD request expecting 2xx.
 */

import {
  WITHINGS_STATUS_INVALID_TOKEN,
  WITHINGS_STATUS_OK,
  WITHINGS_STATUS_RATE_LIMITED,
  WithingsApiError,
  type WithingsApi,
  type WithingsGetMeasuresOpts,
  type WithingsGetMeasuresPage,
  type WithingsMeasureGroup,
  type WithingsTokens,
} from './api.js';

const AUTHORIZE_URL = 'https://account.withings.com/oauth2_user/authorize2';
const TOKEN_URL = 'https://wbsapi.withings.net/v2/oauth2';
const MEASURE_URL = 'https://wbsapi.withings.net/measure';
const NOTIFY_URL = 'https://wbsapi.withings.net/notify';

/** Phase 1 needs body measurements only. */
const SCOPE = 'user.metrics';
/** 9=diastolic, 10=systolic, 11=pulse (verified type codes). */
const MEASTYPES = '9,10,11';
/** category=1: real measurements (2 would be user objectives). */
const CATEGORY = '1';

interface WithingsEnvelope {
  status: number;
  body?: unknown;
  error?: string;
}

function errorFromEnvelope(envelope: WithingsEnvelope, context: string): WithingsApiError {
  const message = `Withings ${context} failed (status ${envelope.status})`;
  if (envelope.status === WITHINGS_STATUS_INVALID_TOKEN) {
    return new WithingsApiError(envelope.status, message, 'invalid_token');
  }
  if (envelope.status === WITHINGS_STATUS_RATE_LIMITED) {
    return new WithingsApiError(envelope.status, message, 'rate_limited');
  }
  // Withings reports refresh-token failures with an 'invalid_grant'-style error
  // string in the envelope; surface it so the connection can be marked 'error'.
  if ((envelope.error ?? '').toLowerCase().includes('invalid_grant')) {
    return new WithingsApiError(envelope.status, message, 'invalid_grant');
  }
  return new WithingsApiError(envelope.status, message);
}

export interface WithingsHttpConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Append mode=demo to the authorize URL (Withings sandbox). */
  demoMode?: boolean;
}

export class WithingsHttp implements WithingsApi {
  constructor(
    private readonly config: WithingsHttpConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  authorizeUrl(state: string): string {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', state);
    if (this.config.demoMode === true) url.searchParams.set('mode', 'demo');
    return url.toString();
  }

  private async post(
    url: string,
    form: Record<string, string>,
    context: string,
    accessToken?: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (accessToken !== undefined) headers.authorization = `Bearer ${accessToken}`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: new URLSearchParams(form).toString(),
    });
    // The envelope rides HTTP 200; a non-200 is a transport-level failure.
    if (!res.ok) {
      throw new WithingsApiError(-1, `Withings ${context} HTTP ${res.status}`, 'http_error');
    }
    const envelope = (await res.json()) as WithingsEnvelope;
    if (envelope.status !== WITHINGS_STATUS_OK) throw errorFromEnvelope(envelope, context);
    return envelope.body ?? {};
  }

  private async requestToken(
    grant: Record<string, string>,
    context: string,
  ): Promise<WithingsTokens> {
    const body = (await this.post(
      TOKEN_URL,
      {
        action: 'requesttoken',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...grant,
      },
      context,
    )) as {
      userid: number | string;
      access_token: string;
      refresh_token: string;
      scope: string;
      expires_in: number;
      token_type: string;
    };
    return {
      userid: String(body.userid),
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      scope: body.scope,
      expiresIn: body.expires_in,
      tokenType: body.token_type,
    };
  }

  exchangeCode(code: string): Promise<WithingsTokens> {
    return this.requestToken(
      { grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri },
      'token exchange',
    );
  }

  refresh(refreshToken: string): Promise<WithingsTokens> {
    return this.requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken }, 'refresh');
  }

  async getMeasures(
    accessToken: string,
    opts: WithingsGetMeasuresOpts,
  ): Promise<WithingsGetMeasuresPage> {
    const form: Record<string, string> = {
      action: 'getmeas',
      meastypes: MEASTYPES,
      category: CATEGORY,
    };
    if (opts.lastupdate !== undefined) form.lastupdate = String(opts.lastupdate);
    if (opts.startdate !== undefined) form.startdate = String(opts.startdate);
    if (opts.enddate !== undefined) form.enddate = String(opts.enddate);
    if (opts.offset !== undefined) form.offset = String(opts.offset);
    const body = (await this.post(MEASURE_URL, form, 'getmeas', accessToken)) as {
      updatetime: number;
      timezone?: string;
      measuregrps?: WithingsMeasureGroup[];
      more?: number | boolean;
      offset?: number;
    };
    return {
      updatetime: body.updatetime,
      timezone: body.timezone ?? null,
      measuregrps: body.measuregrps ?? [],
      more: body.more === 1 || body.more === true,
      offset: body.offset ?? 0,
    };
  }

  async subscribe(accessToken: string, callbackUrl: string, appli: number): Promise<void> {
    await this.post(
      NOTIFY_URL,
      { action: 'subscribe', callbackurl: callbackUrl, appli: String(appli) },
      'notify subscribe',
      accessToken,
    );
  }

  /** action=list — reconciliation of existing subscriptions. */
  async listSubscriptions(accessToken: string, appli: number): Promise<unknown> {
    return this.post(
      NOTIFY_URL,
      { action: 'list', appli: String(appli) },
      'notify list',
      accessToken,
    );
  }
}
