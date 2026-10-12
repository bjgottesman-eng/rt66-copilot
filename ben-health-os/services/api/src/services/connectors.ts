import type pg from 'pg';
import { randomBytes } from 'node:crypto';
import type { IngestResult, ExternalRecordInput } from '@bho/contracts';
import { addDays, localDateOf } from '@bho/analytics';
import { OuraClient, WithingsClient, WithingsApiError, WITHINGS_APPLI, dateWindows, generatePkce, mapOuraDocument, mapWithingsGroup, randomState, type OAuthTokens, type OuraDataType } from '@bho/integrations';
import type { AppConfig } from '../config.js';
import { withService, withUser, type Tx } from '../db/pool.js';
import { TokenCipher } from './crypto.js';
import { audit } from './audit.js';
import { ingestConnectorRecords } from './ingest.js';

export type OAuthConnector = 'oura' | 'withings';
export const OAUTH_CONNECTORS: OAuthConnector[] = ['oura', 'withings'];

export interface ConnectorRuntime {
  oura: OuraClient | null;
  withings: WithingsClient | null;
  cipher: TokenCipher;
  ouraClientSecret: string | null;
  ouraVerificationToken: string;
  publicBaseUrl: string;
  webBaseUrl: string;
  ouraHistoryDays: number;
  withingsHistoryDays: number;
  configured: Set<OAuthConnector>;
}

export function createConnectorRuntime(cfg: AppConfig, log: { warn: (msg: string) => void }): ConnectorRuntime {
  const configured = new Set<OAuthConnector>();
  const publicBaseUrl = cfg.PUBLIC_BASE_URL.replace(/\/$/, '');
  let keyB64 = cfg.TOKEN_ENCRYPTION_KEY;
  const anyConnector = Boolean((cfg.OURA_CLIENT_ID && cfg.OURA_CLIENT_SECRET) || (cfg.WITHINGS_CLIENT_ID && cfg.WITHINGS_CLIENT_SECRET));
  if (!keyB64) {
    if (cfg.NODE_ENV === 'production' && anyConnector) throw new Error('TOKEN_ENCRYPTION_KEY is required in production when an OAuth connector is configured');
    keyB64 = randomBytes(32).toString('base64');
    if (anyConnector) log.warn('TOKEN_ENCRYPTION_KEY not set: using an ephemeral key; stored OAuth tokens will not survive a restart');
  }
  const oura = cfg.OURA_CLIENT_ID && cfg.OURA_CLIENT_SECRET
    ? new OuraClient({ clientId: cfg.OURA_CLIENT_ID, clientSecret: cfg.OURA_CLIENT_SECRET, redirectUri: `${publicBaseUrl}/v1/oauth/oura/callback`, apiBase: cfg.OURA_API_BASE, authBase: cfg.OURA_AUTH_BASE })
    : null;
  if (oura) configured.add('oura');
  const withings = cfg.WITHINGS_CLIENT_ID && cfg.WITHINGS_CLIENT_SECRET
    ? new WithingsClient({ clientId: cfg.WITHINGS_CLIENT_ID, clientSecret: cfg.WITHINGS_CLIENT_SECRET, redirectUri: `${publicBaseUrl}/v1/oauth/withings/callback`, apiBase: cfg.WITHINGS_API_BASE, accountBase: cfg.WITHINGS_ACCOUNT_BASE })
    : null;
  if (withings) configured.add('withings');
  return {
    oura,
    withings,
    cipher: new TokenCipher(keyB64),
    ouraClientSecret: cfg.OURA_CLIENT_SECRET ?? null,
    ouraVerificationToken: cfg.OURA_WEBHOOK_VERIFICATION_TOKEN ?? randomBytes(16).toString('hex'),
    publicBaseUrl,
    webBaseUrl: cfg.WEB_BASE_URL.replace(/\/$/, ''),
    ouraHistoryDays: cfg.OURA_HISTORY_DAYS,
    withingsHistoryDays: cfg.WITHINGS_HISTORY_DAYS,
    configured,
  };
}

export class ConnectorError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ConnectorError';
  }
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  externalUserId: string | null;
  status: string;
}

async function saveTokens(tx: Tx, rt: ConnectorRuntime, userId: string, connector: OAuthConnector, tokens: OAuthTokens, externalUserId: string | null, status: string): Promise<void> {
  await tx.query(
    `insert into public.source_connections (user_id, connector, status, external_user_id, scopes, access_token_ciphertext, refresh_token_ciphertext, token_expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id, connector) do update set status = excluded.status, external_user_id = coalesce(excluded.external_user_id, public.source_connections.external_user_id), scopes = excluded.scopes,
       access_token_ciphertext = excluded.access_token_ciphertext, refresh_token_ciphertext = excluded.refresh_token_ciphertext, token_expires_at = excluded.token_expires_at, last_error = null`,
    [userId, connector, status, externalUserId, tokens.scope ? tokens.scope.split(/[\s,]+/).filter(Boolean) : [], rt.cipher.encrypt(tokens.accessToken), tokens.refreshToken ? rt.cipher.encrypt(tokens.refreshToken) : null, tokens.expiresAt],
  );
}

async function loadTokens(tx: Tx, rt: ConnectorRuntime, userId: string, connector: OAuthConnector): Promise<StoredTokens | null> {
  const r = await tx.query<{ status: string; external_user_id: string | null; access_token_ciphertext: Buffer | null; refresh_token_ciphertext: Buffer | null; token_expires_at: Date | null }>(
    'select status, external_user_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at from public.source_connections where user_id = $1 and connector = $2',
    [userId, connector],
  );
  const row = r.rows[0];
  if (!row || !row.access_token_ciphertext) return null;
  return {
    accessToken: rt.cipher.decrypt(row.access_token_ciphertext),
    refreshToken: row.refresh_token_ciphertext ? rt.cipher.decrypt(row.refresh_token_ciphertext) : null,
    expiresAt: row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null,
    externalUserId: row.external_user_id,
    status: row.status,
  };
}

/** Returns a valid access token, refreshing (and persisting the rotated pair) when it expires within 5 minutes. */
export async function freshAccessToken(pool: pg.Pool, rt: ConnectorRuntime, userId: string, connector: OAuthConnector): Promise<{ accessToken: string; externalUserId: string | null }> {
  const stored = await withUser(pool, userId, (tx) => loadTokens(tx, rt, userId, connector));
  if (!stored) throw new ConnectorError(409, `${connector} is not connected`);
  if (stored.status === 'DISCONNECTED' || stored.status === 'REVOKED') throw new ConnectorError(409, `${connector} connection is ${stored.status.toLowerCase()}`);
  const expiresSoon = !stored.expiresAt || new Date(stored.expiresAt).getTime() - Date.now() < 5 * 60_000;
  if (!expiresSoon) return { accessToken: stored.accessToken, externalUserId: stored.externalUserId };
  if (!stored.refreshToken) throw new ConnectorError(409, `${connector} token expired and no refresh token is stored; reconnect`);
  try {
    const refreshed = connector === 'oura' ? await rt.oura!.refresh(stored.refreshToken) : await rt.withings!.refresh(stored.refreshToken);
    await withUser(pool, userId, (tx) => saveTokens(tx, rt, userId, connector, refreshed, refreshed.externalUserId ?? stored.externalUserId, 'CONNECTED'));
    await audit(pool, { userId, actor: 'system', action: 'TOKEN_REFRESH', entity: 'source_connection', entityId: connector });
    return { accessToken: refreshed.accessToken, externalUserId: refreshed.externalUserId ?? stored.externalUserId };
  } catch (e) {
    await withUser(pool, userId, (tx) => tx.query(`update public.source_connections set status = 'EXPIRED', last_error = $3, last_sync_status = 'ERROR' where user_id = $1 and connector = $2`, [userId, connector, `token refresh failed: ${(e as Error).message}`.slice(0, 300)]));
    throw new ConnectorError(409, `${connector} token refresh failed; reconnect the source`);
  }
}

function requireClient(rt: ConnectorRuntime, connector: OAuthConnector): OuraClient | WithingsClient {
  const c = connector === 'oura' ? rt.oura : rt.withings;
  if (!c) throw new ConnectorError(503, `${connector} is not configured on this server (BLOCKED BY CREDENTIALS: set ${connector.toUpperCase()}_CLIENT_ID and ${connector.toUpperCase()}_CLIENT_SECRET)`);
  return c;
}

// ---------------------------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------------------------
export async function startOAuth(pool: pg.Pool, rt: ConnectorRuntime, userId: string, connector: OAuthConnector, client: 'web' | 'android', returnTo: string | null): Promise<{ url: string; state: string }> {
  const c = requireClient(rt, connector);
  const state = randomState();
  const pkce = connector === 'oura' ? generatePkce() : null;
  const redirectUri = `${rt.publicBaseUrl}/v1/oauth/${connector}/callback`;
  await withUser(pool, userId, (tx) =>
    tx.query(`insert into public.oauth_states (state, user_id, connector, code_verifier, redirect_uri, client, return_to, expires_at) values ($1, $2, $3, $4, $5, $6, $7, now() + interval '10 minutes')`, [state, userId, connector, pkce?.verifier ?? null, redirectUri, client, returnTo]),
  );
  const url = connector === 'oura' ? (c as OuraClient).authorizeUrl({ state, codeChallenge: pkce!.challenge }) : (c as WithingsClient).authorizeUrl({ state });
  return { url, state };
}

export interface OAuthCompletion {
  userId: string;
  connector: OAuthConnector;
  client: 'web' | 'android';
  returnTo: string | null;
  importResult: IngestResult | null;
  importError: string | null;
  webhook: string;
}

export async function completeOAuth(pool: pg.Pool, rt: ConnectorRuntime, connector: OAuthConnector, code: string, state: string): Promise<OAuthCompletion> {
  const c = requireClient(rt, connector);
  const st = await withService(pool, async (tx) => {
    const r = await tx.query<{ user_id: string; code_verifier: string | null; client: string; return_to: string | null }>(`delete from public.oauth_states where state = $1 and connector = $2 and expires_at > now() returning user_id, code_verifier, client, return_to`, [state, connector]);
    await tx.query('delete from public.oauth_states where expires_at < now()');
    return r.rows[0] ?? null;
  });
  if (!st) throw new ConnectorError(400, 'invalid or expired OAuth state');
  const userId = st.user_id;
  let tokens: OAuthTokens;
  let externalUserId: string | null = null;
  if (connector === 'oura') {
    tokens = await (c as OuraClient).exchangeCode(code, st.code_verifier ?? '');
    const info = await (c as OuraClient).personalInfo(tokens.accessToken).catch(() => null);
    externalUserId = info?.id ?? null;
  } else {
    tokens = await (c as WithingsClient).exchangeCode(code);
    externalUserId = tokens.externalUserId ?? null;
  }
  await withUser(pool, userId, (tx) => saveTokens(tx, rt, userId, connector, tokens, externalUserId, 'PENDING_AUTH'));
  await audit(pool, { userId, actor: 'user', action: 'SOURCE_CONNECT', entity: 'source_connection', entityId: connector, details: { client: st.client } });

  let importResult: IngestResult | null = null;
  let importError: string | null = null;
  try {
    importResult = connector === 'oura' ? await importOura(pool, rt, userId, { days: rt.ouraHistoryDays, mode: 'INITIAL_BACKFILL' }) : await importWithings(pool, rt, userId, { mode: 'INITIAL_BACKFILL' });
  } catch (e) {
    importError = (e as Error).message;
    await withUser(pool, userId, (tx) => tx.query(`update public.source_connections set last_error = $3, last_sync_status = 'ERROR' where user_id = $1 and connector = $2`, [userId, connector, importError!.slice(0, 300)]));
  }
  const webhook = await ensureWebhooks(pool, rt, userId, connector).catch((e: Error) => `webhook setup failed: ${e.message}`);
  return { userId, connector, client: st.client === 'android' ? 'android' : 'web', returnTo: st.return_to, importResult, importError, webhook };
}

export async function disconnect(pool: pg.Pool, rt: ConnectorRuntime, userId: string, connector: OAuthConnector): Promise<void> {
  const stored = await withUser(pool, userId, (tx) => loadTokens(tx, rt, userId, connector));
  if (stored && connector === 'oura' && rt.oura) await rt.oura.revoke(stored.accessToken).catch(() => undefined);
  if (stored && connector === 'withings' && rt.withings) {
    const cb = `${rt.publicBaseUrl}/v1/webhooks/withings`;
    for (const appli of [WITHINGS_APPLI.bloodPressure, WITHINGS_APPLI.weight]) await rt.withings.revoke(stored.accessToken, cb, appli).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Imports and reconciliation
// ---------------------------------------------------------------------------------------------
const OURA_IMPORT_TYPES: OuraDataType[] = ['sleep', 'daily_sleep', 'daily_readiness', 'daily_activity', 'daily_spo2', 'daily_stress', 'vO2_max', 'workout'];

async function userTimeZone(pool: pg.Pool, userId: string): Promise<string> {
  const r = await withUser(pool, userId, (tx) => tx.query<{ time_zone: string }>('select time_zone from public.profiles where id = $1', [userId]));
  return r.rows[0]?.time_zone ?? 'UTC';
}

export async function importOura(pool: pg.Pool, rt: ConnectorRuntime, userId: string, opts: { days: number; mode: string; heartRateDays?: number }, now: Date = new Date()): Promise<IngestResult> {
  const client = requireClient(rt, 'oura') as OuraClient;
  const { accessToken, externalUserId } = await freshAccessToken(pool, rt, userId, 'oura');
  const tz = await userTimeZone(pool, userId);
  const nowIso = now.toISOString();
  const today = localDateOf(nowIso, null, tz);
  const ctx = { timeZone: tz, sourceUserId: externalUserId, nowIso };
  const records: ExternalRecordInput[] = [];
  const windows = dateWindows(today, opts.days, 30);
  const fetched: Record<string, number> = {};
  for (const type of OURA_IMPORT_TYPES) {
    for (const w of windows) {
      const docs = await client.listDocuments(accessToken, type, w);
      fetched[type] = (fetched[type] ?? 0) + docs.length;
      for (const d of docs) records.push(...mapOuraDocument(type, d, ctx));
    }
  }
  const hrDays = opts.heartRateDays ?? 2;
  if (hrDays > 0) {
    const end = nowIso;
    const start = new Date(now.getTime() - hrDays * 86_400_000).toISOString();
    const docs = await client.listDocuments(accessToken, 'heartrate', { start, end });
    fetched.heartrate = docs.length;
    for (const d of docs) records.push(...mapOuraDocument('heartrate', d, ctx));
  }
  return ingestConnectorRecords(pool, userId, 'oura', { mode: opts.mode, records, cursors: { 'oura:last_import_end': today }, runDetails: { fetched, windows: windows.length } }, now);
}

export async function importWithings(pool: pg.Pool, rt: ConnectorRuntime, userId: string, opts: { mode: string; startdate?: number; enddate?: number }, now: Date = new Date()): Promise<IngestResult> {
  const client = requireClient(rt, 'withings') as WithingsClient;
  const { accessToken, externalUserId } = await freshAccessToken(pool, rt, userId, 'withings');
  const tz = await userTimeZone(pool, userId);
  const cursorRow = await withUser(pool, userId, (tx) => tx.query<{ cursor: string | null }>(`select cursor from public.sync_cursors where user_id = $1 and scope = 'withings:getmeas:lastupdate'`, [userId]));
  const lastupdate = cursorRow.rows[0]?.cursor ? Number(cursorRow.rows[0].cursor) : null;
  const params =
    opts.startdate !== undefined || opts.enddate !== undefined
      ? { startdate: opts.startdate, enddate: opts.enddate }
      : opts.mode === 'INITIAL_BACKFILL' || lastupdate === null
        ? { startdate: Math.floor(now.getTime() / 1000) - rt.withingsHistoryDays * 86_400, enddate: Math.floor(now.getTime() / 1000) + 60 }
        : { lastupdate };
  let res;
  try {
    res = await client.getMeasures(accessToken, params);
  } catch (e) {
    if (e instanceof WithingsApiError && e.isAuthError) {
      await withUser(pool, userId, (tx) => tx.query(`update public.source_connections set status = 'EXPIRED', last_error = $3, last_sync_status = 'ERROR' where user_id = $1 and connector = $2`, [userId, 'withings', e.message.slice(0, 300)]));
    }
    throw e;
  }
  const records = res.groups.map((g) => mapWithingsGroup(g, { timezone: res.timezone, userTimeZone: tz, sourceUserId: externalUserId })).filter((r): r is ExternalRecordInput => r !== null);
  const devices = await client.getDevices(accessToken).catch(() => []);
  return ingestConnectorRecords(
    pool,
    userId,
    'withings',
    {
      mode: opts.mode,
      records,
      cursors: params.lastupdate !== undefined || opts.mode === 'INITIAL_BACKFILL' ? { 'withings:getmeas:lastupdate': String(res.updatetime) } : {},
      runDetails: { groups: res.groups.length, timezone: res.timezone, params },
      afterPersist: async (tx) => {
        for (const d of devices) {
          await tx.query(
            `update public.source_devices set metadata = metadata || $3::jsonb, label = $4, manufacturer = 'Withings', model = $5, last_seen_at = greatest(last_seen_at, to_timestamp($6)) where user_id = $1 and connector = 'withings' and external_device_id in ($2, $7)`,
            [userId, d.hash_deviceid ?? d.deviceid, JSON.stringify({ battery: d.battery, type: d.type, timezone: d.timezone, modelId: d.model_id }), `Withings ${d.model}`, d.model, d.last_session_date ?? 0, d.deviceid],
          );
        }
      },
    },
    now,
  );
}

export async function reconcile(pool: pg.Pool, rt: ConnectorRuntime, userId: string, connector: OAuthConnector, now: Date = new Date()): Promise<IngestResult> {
  return connector === 'oura' ? importOura(pool, rt, userId, { days: 3, mode: 'RECONCILE', heartRateDays: 2 }, now) : importWithings(pool, rt, userId, { mode: 'RECONCILE' }, now);
}

export async function reconcileAll(pool: pg.Pool, rt: ConnectorRuntime, now: Date = new Date()): Promise<{ processed: number; failed: number; results: Array<{ userId: string; connector: string; status: string; error?: string }> }> {
  const rows = await withService(pool, (tx) => tx.query<{ user_id: string; connector: OAuthConnector }>(`select user_id, connector from public.source_connections where connector in ('oura','withings') and status in ('CONNECTED','PARTIAL','PENDING_AUTH') and access_token_ciphertext is not null`));
  const results: Array<{ userId: string; connector: string; status: string; error?: string }> = [];
  let failed = 0;
  for (const r of rows.rows) {
    if (!rt.configured.has(r.connector)) continue;
    try {
      const res = await reconcile(pool, rt, r.user_id, r.connector, now);
      results.push({ userId: r.user_id, connector: r.connector, status: `+${res.inserted}/~${res.updated}` });
    } catch (e) {
      failed++;
      results.push({ userId: r.user_id, connector: r.connector, status: 'ERROR', error: (e as Error).message.slice(0, 200) });
    }
  }
  if (rt.oura) await renewOuraSubscriptions(rt).catch(() => undefined);
  return { processed: results.length, failed, results };
}

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------
const OURA_WEBHOOK_TYPES = ['sleep', 'daily_sleep', 'daily_readiness', 'daily_activity', 'daily_spo2', 'daily_stress', 'workout', 'vo2_max'];

async function ensureWebhooks(pool: pg.Pool, rt: ConnectorRuntime, userId: string, connector: OAuthConnector): Promise<string> {
  if (!rt.publicBaseUrl.startsWith('https://')) return 'skipped: PUBLIC_BASE_URL is not https (webhooks need a public HTTPS callback); periodic reconciliation covers updates';
  if (connector === 'withings') {
    const { accessToken } = await freshAccessToken(pool, rt, userId, 'withings');
    const cb = `${rt.publicBaseUrl}/v1/webhooks/withings`;
    const done: string[] = [];
    for (const appli of [WITHINGS_APPLI.bloodPressure, WITHINGS_APPLI.weight]) {
      await rt.withings!.subscribe(accessToken, cb, appli);
      done.push(String(appli));
    }
    return `subscribed appli ${done.join(',')}`;
  }
  // Oura subscriptions are per application (not per user); create missing ones once.
  const existing = await rt.oura!.listSubscriptions();
  const cb = `${rt.publicBaseUrl}/v1/webhooks/oura`;
  const created: string[] = [];
  for (const dataType of OURA_WEBHOOK_TYPES) {
    for (const eventType of ['create', 'update', 'delete'] as const) {
      if (existing.some((s) => s.data_type === dataType && s.event_type === eventType && s.callback_url === cb)) continue;
      await rt.oura!.createSubscription({ callbackUrl: cb, verificationToken: rt.ouraVerificationToken, eventType, dataType });
      created.push(`${eventType}:${dataType}`);
    }
  }
  return created.length ? `created ${created.length} subscriptions` : 'subscriptions already present';
}

async function renewOuraSubscriptions(rt: ConnectorRuntime): Promise<void> {
  const subs = await rt.oura!.listSubscriptions();
  const soon = Date.now() + 7 * 86_400_000;
  for (const s of subs) if (new Date(s.expiration_time).getTime() < soon) await rt.oura!.renewSubscription(s.id).catch(() => undefined);
}

async function recordWebhook(pool: pg.Pool, connector: string, dedupeKey: string, headers: Record<string, unknown>, payload: unknown, signatureValid: boolean | null): Promise<string | null> {
  return withService(pool, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `insert into public.webhook_events (connector, dedupe_key, headers, payload, signature_valid) values ($1, $2, $3, $4, $5) on conflict (connector, dedupe_key) do nothing returning id`,
      [connector, dedupeKey, JSON.stringify(headers), JSON.stringify(payload), signatureValid],
    );
    return r.rows[0]?.id ?? null;
  });
}

async function finishWebhook(pool: pg.Pool, id: string, userId: string | null, status: 'PROCESSED' | 'IGNORED' | 'ERROR', error?: string): Promise<void> {
  await withService(pool, (tx) => tx.query(`update public.webhook_events set processing_status = $2, processed_at = now(), attempts = attempts + 1, user_id = $3, error = $4 where id = $1`, [id, status, userId, error ?? null]));
}

async function userForExternalId(pool: pg.Pool, connector: OAuthConnector, externalUserId: string): Promise<string | null> {
  const r = await withService(pool, (tx) => tx.query<{ user_id: string }>(`select user_id from public.source_connections where connector = $1 and external_user_id = $2 and status not in ('DISCONNECTED','REVOKED') limit 1`, [connector, externalUserId]));
  return r.rows[0]?.user_id ?? null;
}

export async function handleOuraWebhook(pool: pg.Pool, rt: ConnectorRuntime, headers: Record<string, string | undefined>, rawBody: string): Promise<{ status: number; body: unknown }> {
  if (!rt.oura) return { status: 503, body: { error: 'oura not configured' } };
  const valid = OuraClient.verifySignature(rt.ouraClientSecret ?? '', headers['x-oura-timestamp'] ?? '', rawBody, headers['x-oura-signature']);
  if (!valid) return { status: 401, body: { error: 'invalid signature' } };
  let event: { event_type: string; data_type: string; object_id: string; event_time: string; user_id: string };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'invalid json' } };
  }
  const dedupeKey = `${event.event_type}:${event.data_type}:${event.object_id}:${event.event_time}`;
  const id = await recordWebhook(pool, 'oura', dedupeKey, { 'x-oura-timestamp': headers['x-oura-timestamp'] }, event, true);
  if (!id) return { status: 200, body: { status: 'duplicate' } };
  const userId = await userForExternalId(pool, 'oura', event.user_id);
  if (!userId) {
    await finishWebhook(pool, id, null, 'IGNORED', 'no connection for user');
    return { status: 200, body: { status: 'ignored' } };
  }
  try {
    const dataType = event.data_type === 'vo2_max' ? 'vO2_max' : event.data_type;
    const extId = `${dataType}:${event.object_id}`;
    if (event.event_type === 'delete') {
      await ingestConnectorRecords(pool, userId, 'oura', { mode: 'WEBHOOK', records: [], deletions: [extId], runDetails: { event } });
    } else {
      const { accessToken, externalUserId } = await freshAccessToken(pool, rt, userId, 'oura');
      const tz = await userTimeZone(pool, userId);
      const doc = await rt.oura.getDocument(accessToken, dataType, event.object_id);
      const records = mapOuraDocument(dataType, doc, { timeZone: tz, sourceUserId: externalUserId, nowIso: new Date().toISOString() });
      await ingestConnectorRecords(pool, userId, 'oura', { mode: 'WEBHOOK', records, runDetails: { event } });
    }
    await finishWebhook(pool, id, userId, 'PROCESSED');
    return { status: 200, body: { status: 'processed' } };
  } catch (e) {
    await finishWebhook(pool, id, userId, 'ERROR', (e as Error).message.slice(0, 300));
    // Let Oura retry: remove the dedupe row so the redelivery is processed.
    await withService(pool, (tx) => tx.query('delete from public.webhook_events where id = $1', [id]));
    return { status: 500, body: { error: 'processing failed' } };
  }
}

export async function handleWithingsNotification(pool: pg.Pool, rt: ConnectorRuntime, form: Record<string, string | undefined>): Promise<{ status: number; body: unknown }> {
  if (!rt.withings) return { status: 503, body: { error: 'withings not configured' } };
  const userid = form.userid ?? '';
  const appli = form.appli ?? '';
  const startdate = Number(form.startdate ?? '');
  const enddate = Number(form.enddate ?? '');
  if (!userid || !appli) return { status: 400, body: { error: 'missing fields' } };
  const dedupeKey = `${userid}:${appli}:${form.startdate ?? ''}:${form.enddate ?? ''}`;
  const id = await recordWebhook(pool, 'withings', dedupeKey, {}, form, null);
  if (!id) return { status: 200, body: { status: 'duplicate' } };
  const userId = await userForExternalId(pool, 'withings', userid);
  if (!userId) {
    await finishWebhook(pool, id, null, 'IGNORED', 'no connection for user');
    return { status: 200, body: { status: 'ignored' } };
  }
  try {
    // Notifications carry no values: fetch the window (padded) and ingest.
    const pad = 60;
    await importWithings(pool, rt, userId, { mode: 'WEBHOOK', startdate: Number.isFinite(startdate) && startdate > 0 ? startdate - pad : undefined, enddate: Number.isFinite(enddate) && enddate > 0 ? enddate + pad : undefined });
    await finishWebhook(pool, id, userId, 'PROCESSED');
    return { status: 200, body: { status: 'processed' } };
  } catch (e) {
    await finishWebhook(pool, id, userId, 'ERROR', (e as Error).message.slice(0, 300));
    await withService(pool, (tx) => tx.query('delete from public.webhook_events where id = $1', [id]));
    return { status: 500, body: { error: 'processing failed' } };
  }
}
