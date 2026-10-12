import type pg from 'pg';
import type { SourceStatus, SourcesResponse } from '@bho/contracts';
import { CONNECTORS } from '@bho/shared-config';
import { hoursBetween } from '@bho/analytics';
import { withUser } from '../db/pool.js';

export async function listSources(pool: pg.Pool, userId: string, now: Date = new Date(), configured: Set<string> = new Set()): Promise<SourcesResponse> {
  const nowIso = now.toISOString();
  return withUser(pool, userId, async (tx) => {
    const conns = await tx.query<{ connector: string; status: string; last_successful_sync_at: Date | null; last_sync_attempt_at: Date | null; last_sync_status: string; last_error: string | null; granted_permissions: string[]; requested_permissions: string[]; metadata: Record<string, unknown> }>(
      'select connector, status, last_successful_sync_at, last_sync_attempt_at, last_sync_status, last_error, granted_permissions, requested_permissions, metadata from public.source_connections where user_id = $1',
      [userId],
    );
    const stats = await tx.query<{ connector: string; n: number; latest: Date | null; latest_ingested: Date | null; coverage30: number; metrics: string[] }>(
      `select connector, count(*)::int as n, max(measured_at) as latest, max(ingested_at) filter (where measured_at = (select max(measured_at) from public.observations o2 where o2.user_id = o.user_id and o2.connector = o.connector and o2.deleted_at is null)) as latest_ingested,
              count(distinct local_date) filter (where local_date >= ($2::timestamptz - interval '30 days')::date)::int as coverage30, array_agg(distinct metric_id) as metrics
       from public.observations o where user_id = $1 and deleted_at is null and canonical group by connector`,
      [userId, nowIso],
    );
    const devices = await tx.query<{ connector: string; id: string; label: string; manufacturer: string | null; model: string | null; last_seen_at: Date }>('select connector, id, label, manufacturer, model, last_seen_at from public.source_devices where user_id = $1 order by last_seen_at desc', [userId]);
    const byConn = new Map(conns.rows.map((c) => [c.connector, c]));
    const byStats = new Map(stats.rows.map((s) => [s.connector, s]));

    const sources: SourceStatus[] = CONNECTORS.map((def) => {
      const c = byConn.get(def.id);
      const s = byStats.get(def.id);
      const notes = [def.notes];
      const isOAuth = def.integrationClass === 'VERIFIED_DIRECT_API';
      const serverConfigured = !isOAuth || configured.has(def.id);
      let implementationStatus: SourceStatus['implementationStatus'] = def.implementationStatus;
      if (isOAuth && def.implementationStatus !== 'NOT_IMPLEMENTED' && !serverConfigured) implementationStatus = 'BLOCKED_BY_CREDENTIALS';
      let connectionStatus: SourceStatus['connectionStatus'] = (c?.status as SourceStatus['connectionStatus']) ?? 'NOT_CONFIGURED';
      if (def.implementationStatus === 'NOT_IMPLEMENTED') notes.push(`Not implemented yet (planned for phase ${def.phase}).`);
      else if (isOAuth && !serverConfigured) notes.push(`Server credentials missing: set ${def.id.toUpperCase()}_CLIENT_ID and ${def.id.toUpperCase()}_CLIENT_SECRET (see docs/environment.md).`);
      else if (isOAuth && !c) notes.push('Not connected yet. Connect authorizes Ben Health OS with the provider and imports history; the source shows as connected only after data is retrieved.');
      if (c?.status === 'EXPIRED') notes.push('Authorization expired or was revoked at the provider; reconnect to resume synchronization.');
      if (c && connectionStatus === 'PARTIAL') notes.push('Authorized, but no observations have been received yet.');
      const missing = c ? c.requested_permissions.filter((p) => !c.granted_permissions.includes(p)) : [];
      if (missing.length) notes.push(`${missing.length} requested permission(s) not granted; affected metrics stay NOT_CONNECTED.`);
      const latest = s?.latest ? new Date(s.latest).toISOString() : null;
      const latestIngested = s?.latest_ingested ? new Date(s.latest_ingested).toISOString() : null;
      const actions: SourceStatus['actions'] = [];
      if (def.integrationClass === 'VERIFIED_DIRECT_API' || def.integrationClass === 'CLINICAL_FHIR') {
        if (def.implementationStatus !== 'NOT_IMPLEMENTED' && serverConfigured) actions.push(c && c.status !== 'DISCONNECTED' ? 'reconnect' : 'connect');
      }
      const syncable = c && c.status !== 'DISCONNECTED' && def.id !== 'manual' && def.id !== 'demo' && def.integrationClass !== 'FILE_IMPORT';
      if (syncable) actions.push('refresh', 'disconnect');
      if (def.integrationClass === 'FILE_IMPORT' && def.implementationStatus !== 'NOT_IMPLEMENTED') notes.push(c ? `Last file import ${c.last_successful_sync_at ? new Date(c.last_successful_sync_at).toISOString() : 'never'}; import a newer export any time, unchanged days are skipped.` : 'No file imported yet. Import a Cronometer CSV export from the Nutrition page.');
      if (s) actions.push('export', 'delete');
      return {
        connectorId: def.id,
        displayName: def.displayName,
        integrationClass: def.integrationClass,
        implementationStatus,
        connectionStatus,
        lastSuccessfulSyncAt: c?.last_successful_sync_at ? new Date(c.last_successful_sync_at).toISOString() : null,
        lastSyncAttemptAt: c?.last_sync_attempt_at ? new Date(c.last_sync_attempt_at).toISOString() : null,
        lastSyncStatus: (c?.last_sync_status as SourceStatus['lastSyncStatus']) ?? 'NEVER',
        lastError: c?.last_error ?? null,
        expectedSyncIntervalHours: def.expectedSyncIntervalHours,
        actualLatencyHours: latest && latestIngested ? Number(hoursBetween(latest, latestIngested).toFixed(2)) : null,
        latestObservationAt: latest,
        observationCount: s ? Number(s.n) : 0,
        coverageDays30: s ? Number(s.coverage30) : 0,
        availableMetrics: s?.metrics ?? [],
        missingPermissions: missing,
        grantedPermissions: c?.granted_permissions ?? [],
        devices: devices.rows.filter((d) => d.connector === def.id).map((d) => ({ id: d.id, label: d.label, manufacturer: d.manufacturer, model: d.model, lastSeenAt: d.last_seen_at ? new Date(d.last_seen_at).toISOString() : null })),
        actions,
        notes,
      };
    });
    return { generatedAt: nowIso, sources };
  });
}
