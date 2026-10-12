import type { FastifyInstance } from 'fastify';
import { HealthConnectIngestBatchSchema, HealthConnectSyncReportSchema } from '@bho/contracts';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { withUser } from '../db/pool.js';
import { ingestHealthConnectBatch } from '../services/ingest.js';

export async function ingestRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/v1/ingest/health-connect', { bodyLimit: 32 * 1024 * 1024 }, async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = HealthConnectIngestBatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid ingest batch', details: parsed.error.issues.slice(0, 20) });
    await ensureProfile(ctx.pool, ctx.config, user);
    const result = await ingestHealthConnectBatch(ctx.pool, user.userId, parsed.data);
    request.log.info({ userId: user.userId, received: result.received, inserted: result.inserted, updated: result.updated, duplicates: result.unchangedDuplicates, rejected: result.rejected.length }, 'health connect batch ingested');
    return result;
  });

  // The app reports every sync attempt (including failures and permission state) so the Data Sources
  // screen can explain exactly why a source is stale or erroring.
  app.post('/v1/sources/health-connect/sync-report', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = HealthConnectSyncReportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid sync report', details: parsed.error.issues.slice(0, 20) });
    await ensureProfile(ctx.pool, ctx.config, user);
    const r = parsed.data;
    await withUser(ctx.pool, user.userId, async (tx) => {
      const status = r.sdkStatus === 'SDK_UNAVAILABLE' ? 'UNSUPPORTED' : r.sdkStatus === 'SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED' ? 'ERROR' : r.grantedPermissions.length === 0 ? 'REVOKED' : r.status === 'ERROR' ? 'ERROR' : null;
      await tx.query(
        `insert into public.source_connections (user_id, connector, status, last_sync_attempt_at, last_sync_status, last_error, granted_permissions, requested_permissions, metadata)
         values ($1, 'health_connect', coalesce($2, 'PENDING_AUTH'), $3, $4, $5, $6, $7, $8)
         on conflict (user_id, connector) do update set
           status = case when $2 is not null then $2 when public.source_connections.status in ('REVOKED','ERROR','UNSUPPORTED') and $4 = 'SUCCESS' then 'CONNECTED' else public.source_connections.status end,
           last_sync_attempt_at = excluded.last_sync_attempt_at, last_sync_status = excluded.last_sync_status, last_error = excluded.last_error,
           granted_permissions = excluded.granted_permissions, requested_permissions = excluded.requested_permissions, metadata = public.source_connections.metadata || excluded.metadata`,
        [user.userId, status, r.attemptedAt, r.status, r.error ?? null, r.grantedPermissions, r.requestedPermissions, JSON.stringify({ sdkStatus: r.sdkStatus, backgroundReadGranted: r.backgroundReadGranted, historyReadGranted: r.historyReadGranted, lastDeviceInstanceId: r.deviceInstanceId, lastAppVersion: r.appVersion })],
      );
      if (r.status === 'ERROR') {
        await tx.query(
          `insert into public.sync_runs (user_id, connector, mode, started_at, finished_at, status, records_received, error) values ($1, 'health_connect', 'APP_REPORT', $2, $2, 'ERROR', $3, $4)`,
          [user.userId, r.attemptedAt, r.recordsRead, r.error ?? 'unknown error'],
        );
      }
    });
    return reply.code(204).send();
  });
}
