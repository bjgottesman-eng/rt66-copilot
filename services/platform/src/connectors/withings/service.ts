/**
 * Withings connector orchestration: OAuth connect flow, token storage with
 * rotation, the durable-lastupdate sync (contracts §6), and historical
 * backfill.
 *
 * Token rotation (verified 2026-08-29): Withings rotates the refresh token on
 * EVERY token call; the old refresh token dies 8 h after rotation or on first
 * use of the new access token. {@link WithingsService.rotateTokens} therefore
 * persists the new access+refresh pair (single UPDATE, committed) BEFORE the
 * new access token is used anywhere.
 *
 * Sync algorithm (contracts §6, idempotent + durable):
 * 1. webhook → journal (webhook_delivery unique) → 200 fast → async sync;
 * 2. read sync_cursor['withings_lastupdate'] (0 if absent);
 * 3. getmeas(lastupdate=cursor) → raw insert (dup-safe) → normalize → dedup;
 * 4. cursor := max(server updatetime, group modified times), only after the
 *    batch commits — missed webhooks are healed by any later webhook or
 *    manual refresh;
 * 5. historical backfill uses startdate/enddate windows (cursor untouched).
 */

import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { PlatformConfig } from '../../config.js';
import { decryptToken, encryptToken } from '../../crypto.js';
import type { Db, TxClient } from '../../db.js';
import type { UserDirectory } from '../../directory.js';
import { ApiError, forbidden, notFound } from '../../errors.js';
import {
  canonicalJson,
  ingestWithingsGroups,
  sha256Hex,
  type WithingsIngestCounts,
} from '../../ingest/normalize.js';
import { recomputeSessions } from '../../sessions.js';
import {
  WITHINGS_APPLI_BP,
  isInvalidGrantError,
  isInvalidTokenError,
  type WithingsApi,
  type WithingsGetMeasuresOpts,
  type WithingsTokens,
} from './api.js';

export const WITHINGS_CURSOR_TYPE = 'withings_lastupdate';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // single-use, 10-minute expiry
/** Refresh proactively this long before access-token expiry. */
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
/** Connect-time historical import window. */
const CONNECT_BACKFILL_DAYS = 365;
const MAX_SYNC_PAGES = 200;

interface ConnectionRow {
  id: string;
  status: string;
  external_user_id: string | null;
  expected_latency_seconds: number;
}

export interface SyncResult {
  imported: number;
  counts: WithingsIngestCounts;
}

export interface WithingsServiceDeps {
  db: Db;
  api: WithingsApi;
  config: PlatformConfig;
  directory: UserDirectory;
  logger: Logger;
}

export class WithingsService {
  constructor(private readonly deps: WithingsServiceDeps) {}

  // ------------------------------------------------------------------ connect

  /** Persist a single-use state nonce and return the authorize URL. */
  async startConnect(userId: string): Promise<{ authorizeUrl: string }> {
    const state = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
    await this.deps.db.withUserTx(userId, async (client) => {
      await client.query(
        `insert into source_connection (user_id, provider, status, metadata)
         values ($1, 'withings', 'not_connected',
                 jsonb_build_object('oauthState', jsonb_build_object('value', $2::text, 'expiresAt', $3::text)))
         on conflict (user_id, provider) do update
           set metadata = source_connection.metadata
             || jsonb_build_object('oauthState', jsonb_build_object('value', $2::text, 'expiresAt', $3::text))`,
        [userId, state, expiresAt],
      );
    });
    return { authorizeUrl: this.deps.api.authorizeUrl(state) };
  }

  /**
   * OAuth redirect target. Validates + consumes the state nonce, exchanges the
   * code, stores encrypted tokens, subscribes to appli=4 notifications, and
   * runs the historical backfill.
   */
  async handleCallback(code: string, state: string): Promise<{ userId: string }> {
    if (state === '' || code === '') throw forbidden('INVALID_STATE', 'missing code or state');

    // Service-scope fan-out (see src/directory.ts): find the user whose
    // pending oauthState matches, inside each user's own RLS scope.
    let matched: { userId: string; connectionId: string; expiresAt: string } | null = null;
    for (const userId of this.deps.directory.userIds()) {
      const row = await this.deps.db.withUserTx(userId, async (client) => {
        const res = await client.query<{ id: string; expires_at: string }>(
          `select id, metadata->'oauthState'->>'expiresAt' as expires_at
             from source_connection
            where provider = 'withings' and metadata->'oauthState'->>'value' = $1`,
          [state],
        );
        return res.rows[0];
      });
      if (row !== undefined) {
        matched = { userId, connectionId: row.id, expiresAt: row.expires_at };
        break;
      }
    }
    if (matched === null) throw forbidden('INVALID_STATE', 'unknown or already-used state');
    const { userId, connectionId } = matched;

    // Single-use: consume the state BEFORE the exchange so a replay can never
    // trigger a second token exchange.
    await this.deps.db.withUserTx(userId, async (client) => {
      await client.query(
        `update source_connection set metadata = metadata - 'oauthState' where id = $1`,
        [connectionId],
      );
    });
    if (Date.parse(matched.expiresAt) < Date.now()) {
      throw forbidden('INVALID_STATE', 'state expired');
    }

    const tokens = await this.deps.api.exchangeCode(code);
    await this.deps.db.withUserTx(userId, async (client) => {
      await this.storeTokens(client, userId, connectionId, tokens, true);
      await client.query(
        `update source_connection
            set status = 'connected', external_user_id = $2, connected_at = now(),
                last_error = null, last_error_at = null
          where id = $1`,
        [connectionId, tokens.userid],
      );
      await client.query(
        `insert into audit_log (user_id, actor, action, entity, entity_id, details)
         values ($1, 'platform.withings', 'connection.connected', 'source_connection', $2, '{}')`,
        [userId, connectionId],
      );
    });

    await this.withAccessToken(userId, connectionId, (access) =>
      this.deps.api.subscribe(access, this.deps.config.withings.webhookUrl, WITHINGS_APPLI_BP),
    );

    // Kick the historical import so the account is usable immediately.
    await this.backfill(userId, CONNECT_BACKFILL_DAYS);

    return { userId };
  }

  // ------------------------------------------------------------------- tokens

  /** Fresh connect (replace any previous token rows) or rotation update. */
  private async storeTokens(
    client: TxClient,
    userId: string,
    connectionId: string,
    tokens: WithingsTokens,
    replace: boolean,
  ): Promise<void> {
    const key = this.deps.config.tokenEncKey;
    const accessEnc = encryptToken(key, tokens.accessToken);
    const refreshEnc = encryptToken(key, tokens.refreshToken);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
    const scopes = tokens.scope.split(',').map((s) => s.trim());
    if (replace) {
      await client.query('delete from oauth_token where connection_id = $1', [connectionId]);
      await client.query(
        `insert into oauth_token
           (connection_id, user_id, access_token_enc, refresh_token_enc, expires_at, scopes)
         values ($1, $2, $3, $4, $5, $6)`,
        [connectionId, userId, accessEnc, refreshEnc, expiresAt, scopes],
      );
    } else {
      await client.query(
        `update oauth_token
            set access_token_enc = $2, refresh_token_enc = $3, expires_at = $4, scopes = $5,
                rotated_at = now()
          where connection_id = $1`,
        [connectionId, accessEnc, refreshEnc, expiresAt, scopes],
      );
    }
  }

  private async loadTokens(
    userId: string,
    connectionId: string,
  ): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null }> {
    const row = await this.deps.db.withUserTx(userId, async (client) => {
      const res = await client.query<{
        access_token_enc: Buffer;
        refresh_token_enc: Buffer | null;
        expires_at: Date | null;
      }>(
        `select access_token_enc, refresh_token_enc, expires_at
           from oauth_token where connection_id = $1`,
        [connectionId],
      );
      return res.rows[0];
    });
    if (row === undefined) throw notFound('NOT_CONNECTED', 'Withings tokens missing');
    const key = this.deps.config.tokenEncKey;
    return {
      accessToken: decryptToken(key, row.access_token_enc),
      refreshToken:
        row.refresh_token_enc === null ? null : decryptToken(key, row.refresh_token_enc),
      expiresAt: row.expires_at,
    };
  }

  /**
   * Rotate tokens. The new pair is persisted (transaction committed) BEFORE
   * the new access token is returned for use — the invariant Withings'
   * rotating refresh tokens require. On invalid_grant the connection is marked
   * 'error' (surfaces SYNC_ERROR) and the error rethrown.
   */
  private async rotateTokens(userId: string, connectionId: string): Promise<string> {
    const current = await this.loadTokens(userId, connectionId);
    if (current.refreshToken === null) throw notFound('NOT_CONNECTED', 'no refresh token stored');
    try {
      const rotated = await this.deps.api.refresh(current.refreshToken);
      await this.deps.db.withUserTx(userId, async (client) => {
        await this.storeTokens(client, userId, connectionId, rotated, false);
      });
      // Only now — after commit — may the new access token be used.
      return rotated.accessToken;
    } catch (err) {
      if (isInvalidGrantError(err)) {
        await this.recordError(userId, connectionId, 'refresh token rejected (invalid_grant)', true);
      }
      throw err;
    }
  }

  /**
   * Run `fn` with a valid access token: refreshes proactively 60 s before
   * expiry, and on an invalid-token (343) failure refreshes once and retries.
   */
  private async withAccessToken<T>(
    userId: string,
    connectionId: string,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const tokens = await this.loadTokens(userId, connectionId);
    let access = tokens.accessToken;
    if (
      tokens.expiresAt !== null &&
      tokens.expiresAt.getTime() - Date.now() < TOKEN_REFRESH_MARGIN_MS
    ) {
      access = await this.rotateTokens(userId, connectionId);
    }
    try {
      return await fn(access);
    } catch (err) {
      if (!isInvalidTokenError(err)) throw err;
      access = await this.rotateTokens(userId, connectionId);
      return fn(access);
    }
  }

  // -------------------------------------------------------------------- sync

  async getConnection(userId: string): Promise<ConnectionRow | null> {
    const row = await this.deps.db.withUserTx(userId, async (client) => {
      const res = await client.query<ConnectionRow>(
        `select id, status, external_user_id, expected_latency_seconds
           from source_connection where provider = 'withings'`,
      );
      return res.rows[0];
    });
    return row ?? null;
  }

  private async requireConnection(userId: string): Promise<ConnectionRow> {
    const conn = await this.getConnection(userId);
    if (conn === null || conn.status === 'not_connected' || conn.status === 'revoked') {
      throw notFound('NOT_CONNECTED', 'Withings is not connected');
    }
    return conn;
  }

  private async recordError(
    userId: string,
    connectionId: string,
    message: string,
    fatal: boolean,
  ): Promise<void> {
    await this.deps.db
      .withUserTx(userId, async (client) => {
        await client.query(
          `update source_connection
              set last_error = $2, last_error_at = now()${fatal ? ", status = 'error'" : ''}
            where id = $1`,
          [connectionId, message],
        );
      })
      .catch(() => undefined);
  }

  private async recordSuccess(userId: string, connectionId: string): Promise<void> {
    await this.deps.db.withUserTx(userId, async (client) => {
      await client.query(
        `update source_connection
            set status = 'connected', last_success_at = now(), last_error = null,
                last_error_at = null
          where id = $1`,
        [connectionId],
      );
    });
  }

  /**
   * Drain getmeas pages for `opts`, ingesting each page in its own user
   * transaction. Returns aggregate counts plus the cursor inputs.
   */
  private async drain(
    userId: string,
    connectionId: string,
    opts: WithingsGetMeasuresOpts,
  ): Promise<{ counts: WithingsIngestCounts; updatetime: number; maxModified: number }> {
    const counts: WithingsIngestCounts = { inserted: 0, corrected: 0, rawDuplicates: 0, skipped: 0 };
    let updatetime = 0;
    let maxModified = 0;
    let offset: number | undefined;
    for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
      const result = await this.withAccessToken(userId, connectionId, (access) =>
        this.deps.api.getMeasures(access, { ...opts, ...(offset === undefined ? {} : { offset }) }),
      );
      updatetime = Math.max(updatetime, result.updatetime);
      for (const g of result.measuregrps) maxModified = Math.max(maxModified, g.modified);
      const pageCounts = await this.deps.db.withUserTx(userId, (client) =>
        ingestWithingsGroups(
          client,
          { userId, connectionId },
          result.measuregrps,
          result.timezone,
        ),
      );
      counts.inserted += pageCounts.inserted;
      counts.corrected += pageCounts.corrected;
      counts.rawDuplicates += pageCounts.rawDuplicates;
      counts.skipped += pageCounts.skipped;
      if (!result.more) break;
      offset = result.offset;
    }
    if (counts.inserted > 0 || counts.corrected > 0) {
      await this.deps.db.withUserTx(userId, (client) => recomputeSessions(client, userId));
    }
    return { counts, updatetime, maxModified };
  }

  /** Incremental sync via the durable lastupdate cursor (webhook + manual refresh). */
  async syncViaCursor(userId: string): Promise<SyncResult> {
    const conn = await this.requireConnection(userId);
    const cursor = await this.deps.db.withUserTx(userId, async (client) => {
      const res = await client.query<{ cursor_value: string }>(
        `select cursor_value from sync_cursor where connection_id = $1 and cursor_type = $2`,
        [conn.id, WITHINGS_CURSOR_TYPE],
      );
      return Number(res.rows[0]?.cursor_value ?? '0');
    });

    try {
      const { counts, updatetime, maxModified } = await this.drain(userId, conn.id, {
        lastupdate: cursor,
      });
      // Advance the cursor only after the batches above committed (§6 step 4);
      // never regress it.
      const nextCursor = Math.max(cursor, updatetime, maxModified);
      await this.deps.db.withUserTx(userId, async (client) => {
        await client.query(
          `insert into sync_cursor (connection_id, user_id, cursor_type, cursor_value)
           values ($1, $2, $3, $4)
           on conflict (connection_id, cursor_type) do update set cursor_value = $4`,
          [conn.id, userId, WITHINGS_CURSOR_TYPE, String(nextCursor)],
        );
      });
      await this.recordSuccess(userId, conn.id);
      return { imported: counts.inserted + counts.corrected, counts };
    } catch (err) {
      if (!(err instanceof ApiError)) {
        await this.recordError(userId, conn.id, syncErrorMessage(err), isInvalidGrantError(err));
      }
      throw err;
    }
  }

  /** Historical import via startdate/enddate windows; leaves the cursor alone. */
  async backfill(userId: string, sinceDays: number): Promise<SyncResult> {
    const conn = await this.requireConnection(userId);
    const enddate = Math.floor(Date.now() / 1000);
    const startdate = enddate - Math.floor(sinceDays * 86400);
    try {
      const { counts } = await this.drain(userId, conn.id, { startdate, enddate });
      await this.recordSuccess(userId, conn.id);
      return { imported: counts.inserted + counts.corrected, counts };
    } catch (err) {
      if (!(err instanceof ApiError)) {
        await this.recordError(userId, conn.id, syncErrorMessage(err), isInvalidGrantError(err));
      }
      throw err;
    }
  }

  // ----------------------------------------------------------------- webhook

  /**
   * Process a journaled webhook notification: find the connection whose
   * external_user_id matches (service-scope fan-out over the user directory),
   * record the notification as a raw event, then run the cursor sync.
   * Unknown userids are a no-op (the body is untrusted).
   */
  async processNotification(fields: Record<string, string>): Promise<boolean> {
    const externalUserId = fields.userid ?? '';
    if (externalUserId === '') return false;
    for (const userId of this.deps.directory.userIds()) {
      const conn = await this.getConnection(userId);
      if (conn === null || conn.external_user_id !== externalUserId) continue;
      await this.deps.db.withUserTx(userId, async (client) => {
        const payloadJson = canonicalJson(fields);
        await client.query(
          `insert into raw_ingest_event
             (user_id, connection_id, connector, external_id, event_type, payload,
              payload_hash, parser_version, processing_state, processed_at)
           values ($1, $2, 'withings', null, 'withings.notify', $3::jsonb, $4, $5, 'processed', now())
           on conflict (connector, coalesce(external_id, ''), payload_hash) do nothing`,
          [userId, conn.id, payloadJson, sha256Hex(payloadJson), 1],
        );
      });
      await this.syncViaCursor(userId);
      return true;
    }
    this.deps.logger.info({ provider: 'withings' }, 'webhook for unknown external user ignored');
    return false;
  }
}

function syncErrorMessage(err: unknown): string {
  // Stored in source_connection.last_error and surfaced via /sources —
  // keep it terse and free of tokens/values.
  return err instanceof Error ? err.message : 'sync failed';
}
