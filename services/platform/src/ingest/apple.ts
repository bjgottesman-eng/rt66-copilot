/**
 * Apple Health ingestion wrapper: maintains the apple_health
 * source_connection (the iOS app pushes batches; every accepted batch is a
 * successful "sync") and runs the batch through normalization + sessions.
 */

import type { HealthKitBpBatch } from '@benhealth/shared';
import type { Db } from '../db.js';
import { recomputeSessions } from '../sessions.js';
import { ingestHealthKitBatch, type HealthKitIngestCounts } from './normalize.js';

export async function ingestAppleHealth(
  db: Db,
  userId: string,
  batch: HealthKitBpBatch,
): Promise<HealthKitIngestCounts> {
  return db.withUserTx(userId, async (client) => {
    const conn = await client.query<{ id: string }>(
      `insert into source_connection (user_id, provider, status, connected_at, last_success_at)
       values ($1, 'apple_health', 'connected', now(), now())
       on conflict (user_id, provider) do update
         set status = 'connected', last_success_at = now(), last_error = null, last_error_at = null
       returning id`,
      [userId],
    );
    const counts = await ingestHealthKitBatch(
      client,
      { userId, connectionId: conn.rows[0]!.id },
      batch,
    );
    await recomputeSessions(client, userId);
    return counts;
  });
}
