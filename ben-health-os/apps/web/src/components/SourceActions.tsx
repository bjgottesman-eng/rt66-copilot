'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SourceActions({ connectorId, actions }: { connectorId: string; actions: string[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function run(action: string) {
    setMsg(null);
    if (action === 'refresh') {
      setMsg(connectorId === 'health_connect' ? 'Health Connect syncs from the Android app; open the app or wait for its background sync.' : 'Refresh is available once this connector is implemented.');
      return;
    }
    if (action === 'export') {
      window.open('/api/proxy/v1/me/export', '_blank');
      return;
    }
    if (action === 'disconnect') {
      const res = await fetch(`/api/proxy/v1/sources/${connectorId}/disconnect`, { method: 'POST' });
      setMsg(res.ok ? 'Disconnected.' : 'failed');
    }
    if (action === 'delete') {
      if (!confirm(`Delete all imported data from ${connectorId}? Raw and normalized records are removed; this cannot be undone.`)) return;
      const res = await fetch(`/api/proxy/v1/sources/${connectorId}/data`, { method: 'DELETE' });
      const body = await res.json();
      setMsg(res.ok ? `Deleted ${Object.values(body.deleted as Record<string, number>).reduce((a, b) => a + b, 0)} rows.` : body.message ?? 'failed');
    }
    if (action === 'connect' || action === 'reconnect') setMsg('OAuth connection flows arrive in Phase 2.');
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((a) => (
        <button key={a} onClick={() => run(a)} className={`rounded-lg border px-3 py-1 text-xs ${a === 'delete' ? 'border-attention/40 text-attention' : 'border-line text-muted hover:text-ink'}`}>
          {a}
        </button>
      ))}
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
