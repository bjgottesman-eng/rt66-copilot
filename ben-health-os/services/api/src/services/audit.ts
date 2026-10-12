import type pg from 'pg';
import { withService } from '../db/pool.js';

/** Writes an audit entry with the service connection. Details must never contain measurement values. */
export async function audit(pool: pg.Pool, entry: { userId: string | null; actor: string; action: string; entity?: string; entityId?: string; details?: Record<string, unknown> }): Promise<void> {
  await withService(pool, async (tx) => {
    await tx.query('insert into public.audit_log (user_id, actor, action, entity, entity_id, details) values ($1, $2, $3, $4, $5, $6)', [
      entry.userId,
      entry.actor,
      entry.action,
      entry.entity ?? null,
      entry.entityId ?? null,
      JSON.stringify(entry.details ?? {}),
    ]);
  });
}
