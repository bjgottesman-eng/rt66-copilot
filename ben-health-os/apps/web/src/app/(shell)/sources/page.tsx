import type { SourcesResponse } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { SourceActions } from '@/components/SourceActions';

export const dynamic = 'force-dynamic';

function statusTone(s: string): 'good' | 'watch' | 'attention' | 'neutral' {
  if (s === 'CONNECTED') return 'good';
  if (s === 'PARTIAL' || s === 'PENDING_AUTH') return 'watch';
  if (s === 'ERROR' || s === 'EXPIRED' || s === 'REVOKED') return 'attention';
  return 'neutral';
}

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string; connector?: string; warning?: string }> }) {
  const sp = await searchParams;
  const { sources } = await apiFetch<SourcesResponse>('/v1/sources');
  return (
    <>
      <PageHeader title="Data Sources" subtitle="A source is shown as connected only after authentication and data retrieval both succeeded." />
      {sp.connected && (
        <Card className="mb-4 border-good/40">
          <p className="text-sm">{sp.connected} connected and history imported.{sp.warning ? ` First import reported: ${sp.warning}` : ''}</p>
        </Card>
      )}
      {sp.error && (
        <Card className="mb-4 border-attention/40">
          <p className="text-sm text-attention">{sp.connector ?? 'Connection'} failed: {sp.error}</p>
        </Card>
      )}
      <div className="space-y-4">
        {sources.map((s) => (
          <Card key={s.connectorId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold" data-testid={`source-${s.connectorId}`}>{s.displayName}</h2>
                  <Chip tone={statusTone(s.connectionStatus)}>{s.connectionStatus.replace(/_/g, ' ').toLowerCase()}</Chip>
                  <Chip tone="neutral">{s.integrationClass.replace(/_/g, ' ').toLowerCase()}</Chip>
                  <Chip tone={s.implementationStatus === 'NOT_IMPLEMENTED' ? 'neutral' : s.implementationStatus === 'BLOCKED_BY_CREDENTIALS' ? 'watch' : 'good'}>{s.implementationStatus.replace(/_/g, ' ').toLowerCase()}</Chip>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-muted">{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </div>
              <SourceActions connectorId={s.connectorId} actions={s.actions} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4 lg:grid-cols-6">
              <div><dt className="text-xs text-muted">Latest observation</dt><dd>{s.latestObservationAt ? relativeTime(s.latestObservationAt) : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Last successful sync</dt><dd>{s.lastSuccessfulSyncAt ? relativeTime(s.lastSuccessfulSyncAt) : 'never'}</dd></div>
              <div><dt className="text-xs text-muted">Expected cadence</dt><dd>every {s.expectedSyncIntervalHours} h</dd></div>
              <div><dt className="text-xs text-muted">Measured → ingested</dt><dd>{s.actualLatencyHours != null ? `${s.actualLatencyHours.toFixed(1)} h` : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Observations</dt><dd className="num">{s.observationCount.toLocaleString()}</dd></div>
              <div><dt className="text-xs text-muted">Coverage (30d)</dt><dd className="num">{s.coverageDays30}/30 days</dd></div>
            </dl>
            {s.lastError && <p className="mt-3 rounded-lg bg-attention/10 px-3 py-2 text-xs text-attention">Last error: {s.lastError}</p>}
            {(s.availableMetrics.length > 0 || s.missingPermissions.length > 0 || s.devices.length > 0) && (
              <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
                {s.availableMetrics.length > 0 && <div><p className="text-muted">Available metrics</p><p className="mt-1">{s.availableMetrics.join(', ')}</p></div>}
                {s.missingPermissions.length > 0 && <div><p className="text-muted">Missing permissions</p><p className="mt-1 text-attention">{s.missingPermissions.map((p) => p.replace('android.permission.health.', '')).join(', ')}</p></div>}
                {s.devices.length > 0 && <div><p className="text-muted">Devices</p><ul className="mt-1 space-y-0.5">{s.devices.slice(0, 8).map((d) => <li key={d.id}>{d.label} · seen {relativeTime(d.lastSeenAt)}</li>)}</ul></div>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
