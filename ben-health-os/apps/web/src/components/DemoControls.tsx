'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DemoControls({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function seed() {
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/proxy/v1/demo/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days: 120, replace: true }) });
    const body = await res.json();
    setMsg(res.ok ? `Loaded ${body.ingest.inserted} synthetic records (${body.ingest.crossSourceDuplicates} cross-source duplicates linked).` : body.message ?? 'seed failed');
    setBusy(false);
    router.refresh();
  }
  async function clear() {
    setBusy(true);
    const res = await fetch('/api/proxy/v1/demo', { method: 'DELETE' });
    setMsg(res.ok ? 'Demo data cleared.' : (await res.json()).message ?? 'clear failed');
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button onClick={seed} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:text-black" data-testid="seed-demo">
        {busy ? 'Working…' : demoMode ? 'Regenerate demo data' : 'Load synthetic demo data'}
      </button>
      {demoMode && (
        <button onClick={clear} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm" data-testid="clear-demo">
          Clear demo data
        </button>
      )}
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
