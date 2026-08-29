/**
 * Database access for the platform service.
 *
 * All user-scoped work goes through {@link Db.withUserTx}: a transaction that
 * first runs `select set_config('app.user_id', $1, true)` so the FORCED
 * row-level-security policies (packages/db migrations 0004) scope every query
 * to that user. The service role `benhealth_app` is NOT BYPASSRLS, and its
 * grants (migration 0005) are deliberately limited: raw_ingest_event has
 * column-limited UPDATE and no DELETE, blood_pressure_reading has no hard
 * DELETE, audit_log is append-only.
 *
 * SERVICE SCOPE (documented exception): a small set of queries legitimately
 * run without a user context, limited to the `webhook_delivery` journal —
 * whose RLS policy grants the service role all rows because webhook deliveries
 * arrive unauthenticated and are not user data. Everything else, including
 * "which user owns Withings account X" lookups, is answered by iterating the
 * in-memory {@link UserDirectory} (src/directory.ts) and running normal
 * user-scoped queries — never by bypassing RLS.
 */

import pg from 'pg';

const { Pool } = pg;

export type TxClient = pg.PoolClient;

export class Db {
  readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  /**
   * Run `fn` inside a transaction scoped to `userId` via
   * `set_config('app.user_id', $1, true)` (transaction-local, per contracts §1).
   */
  async withUserTx<T>(userId: string, fn: (client: TxClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.user_id', $1, true)", [userId]);
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * SERVICE-SCOPE helper — webhook_delivery journal only (see module doc).
   * Inserts the delivery hash; returns false when this exact delivery was
   * already journaled (unique(provider, delivery_hash)) so the caller can
   * short-circuit duplicate webhook deliveries.
   */
  async recordWebhookDelivery(provider: string, deliveryHash: string): Promise<boolean> {
    const res = await this.pool.query(
      `insert into webhook_delivery (provider, delivery_hash, status)
       values ($1, $2, 'accepted')
       on conflict (provider, delivery_hash) do nothing`,
      [provider, deliveryHash],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** SERVICE-SCOPE helper — mark a journaled delivery's processing outcome. */
  async setWebhookDeliveryStatus(
    provider: string,
    deliveryHash: string,
    status: 'accepted' | 'failed',
  ): Promise<void> {
    await this.pool.query(
      'update webhook_delivery set status = $3 where provider = $1 and delivery_hash = $2',
      [provider, deliveryHash, status],
    );
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
