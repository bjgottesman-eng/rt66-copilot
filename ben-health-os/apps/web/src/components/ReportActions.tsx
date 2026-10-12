'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ReportActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function generate(kind: 'weekly' | 'monthly') {
    setBusy(kind);
    setMsg(null);
    const res = await fetch(`/api/proxy/v1/reports/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: true }) });
    const body = await res.json();
    setBusy(null);
    if (!res.ok) {
      setMsg(body.message ?? 'generation failed');
      return;
    }
    router.push(`/health-ceo/${kind}/${body.id}`);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => generate('weekly')} disabled={busy !== null} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:text-black" data-testid="generate-weekly">{busy === 'weekly' ? 'Generating…' : 'Generate weekly report'}</button>
      <button onClick={() => generate('monthly')} disabled={busy !== null} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted disabled:opacity-60" data-testid="generate-monthly">{busy === 'monthly' ? 'Generating…' : 'Generate monthly report'}</button>
      {msg && <span className="text-xs text-attention">{msg}</span>}
    </div>
  );
}
