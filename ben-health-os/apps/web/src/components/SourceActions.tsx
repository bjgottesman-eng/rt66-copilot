'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SourceActions({ connectorId, actions }: { connectorId: string; actions: string[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(action: string, org?: string) {
    setMsg(null);
    if (action === 'connect' || action === 'reconnect') {
      setBusy(true);
      const res = await fetch(`/api/proxy/v1/oauth/${connectorId}/start?client=web&returnTo=/sources${org ? `&org=${org}` : ''}`);
      const body = await res.json();
      setBusy(false);
      if (!res.ok) {
        setMsg(body.message ?? 'could not start authorization');
        return;
      }
      window.location.href = body.url; // provider consent screen; the API callback returns here
      return;
    }
    if (action === 'refresh') {
      if (connectorId === 'health_connect') {
        setMsg('Health Connect syncs from the Android app; open the app or wait for its background sync.');
        return;
      }
      setBusy(true);
      const res = await fetch(`/api/proxy/v1/sources/${connectorId}/refresh`, { method: 'POST' });
      const body = await res.json();
      setBusy(false);
      setMsg(res.ok ? ('labsStaged' in body ? `Refreshed clinical records: ${body.labsStaged} new lab results (${body.labsUnchanged} unchanged), ${body.conditions} conditions, ${body.medicationSourceRecords} medication records, ${body.allergies} allergies, ${body.events} events.${body.warnings?.length ? ` Not granted: ${body.warnings.join('; ')}` : ''}` : `Refreshed: ${body.inserted} new, ${body.updated} updated, ${body.unchangedDuplicates} unchanged.`) : body.message ?? 'refresh failed');
      router.refresh();
      return;
    }
    if (action === 'export') {
      window.open('/api/proxy/v1/me/export', '_blank');
      return;
    }
    if (action === 'disconnect') {
      if (!confirm(`Disconnect ${connectorId}? Stored tokens are deleted; imported data stays until you delete it.`)) return;
      const res = await fetch(`/api/proxy/v1/sources/${connectorId}/disconnect`, { method: 'POST' });
      setMsg(res.ok ? 'Disconnected.' : 'failed');
    }
    if (action === 'delete') {
      if (!confirm(`Delete all imported data from ${connectorId}? Raw and normalized records are removed; this cannot be undone.`)) return;
      const res = await fetch(`/api/proxy/v1/sources/${connectorId}/data`, { method: 'DELETE' });
      const body = await res.json();
      setMsg(res.ok ? `Deleted ${Object.values(body.deleted as Record<string, number>).reduce((a, b) => a + b, 0)} rows.` : body.message ?? 'failed');
    }
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((a) =>
        connectorId === 'clinical_fhir' && (a === 'connect' || a === 'reconnect') ? (
          [['weill_cornell', 'Weill Cornell (MyChart)'], ['nyu_langone', 'NYU Langone (MyChart)']].map(([org, label]) => (
            <button key={`${a}-${org}`} disabled={busy} onClick={() => run(a, org)} className="rounded-lg border border-accent px-3 py-1 text-xs text-accent disabled:opacity-50" data-testid={`action-${connectorId}-${a}-${org}`}>
              {a} {label}
            </button>
          ))
        ) : (
          <button key={a} disabled={busy} onClick={() => run(a)} className={`rounded-lg border px-3 py-1 text-xs disabled:opacity-50 ${a === 'delete' ? 'border-attention/40 text-attention' : a === 'connect' || a === 'reconnect' ? 'border-accent text-accent' : 'border-line text-muted hover:text-ink'}`} data-testid={`action-${connectorId}-${a}`}>
            {a}
          </button>
        ),
      )}
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
