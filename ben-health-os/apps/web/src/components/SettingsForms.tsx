'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MeResponse } from '@bho/contracts';
import { Card } from './ui';

export function SettingsForms({ me, aiSharing }: { me: MeResponse; aiSharing: { enabled: boolean; excludedConnectors: string[] } }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [timeZone, setTimeZone] = useState(me.timeZone);
  const [ai, setAi] = useState(aiSharing);
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/proxy/v1/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName, timeZone, aiSharing: ai }) });
    setMsg(res.ok ? 'Saved.' : (await res.json()).message ?? 'failed');
    router.refresh();
  }
  async function deleteAll() {
    const res = await fetch('/api/proxy/v1/me/data', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: confirm }) });
    const body = await res.json();
    setMsg(res.ok ? `Deleted ${body.total} rows.` : body.message ?? 'failed');
    setConfirm('');
    router.refresh();
  }
  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-base font-semibold">Profile</h2>
        <form onSubmit={saveProfile} className="mt-3 space-y-3">
          <label className="block text-xs text-muted">Display name<input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          <label className="block text-xs text-muted">Time zone (IANA)<input className={input} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} /></label>
          <fieldset className="rounded-lg border border-line p-3 text-xs">
            <legend className="px-1 text-muted">AI data sharing</legend>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ai.enabled} onChange={(e) => setAi({ ...ai, enabled: e.target.checked })} /> Allow structured analysis packets to be sent to the configured AI provider (Phase 6).</label>
            <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={ai.excludedConnectors.includes('oura')} onChange={(e) => setAi({ ...ai, excludedConnectors: e.target.checked ? [...new Set([...ai.excludedConnectors, 'oura'])] : ai.excludedConnectors.filter((c) => c !== 'oura') })} /> Exclude Oura API data (the Oura API Agreement restricts providing API data to AI models; keep this on unless you have reviewed it).</label>
          </fieldset>
          <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white dark:text-black">Save</button>
        </form>
      </Card>
      <Card>
        <h2 className="text-base font-semibold">Your data</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/proxy/v1/me/export" className="rounded-lg border border-line px-3 py-1.5 text-sm" data-testid="export-all">Export all data (JSON)</a>
        </div>
        <div className="mt-4 rounded-lg border border-attention/30 p-3">
          <p className="text-sm font-medium text-attention">Delete all health data</p>
          <p className="mt-1 text-xs text-muted">Removes every raw and normalized record, connection and derived metric. Type <code>DELETE ALL MY HEALTH DATA</code> to confirm.</p>
          <div className="mt-2 flex gap-2">
            <input className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE ALL MY HEALTH DATA" />
            <button onClick={deleteAll} disabled={confirm !== 'DELETE ALL MY HEALTH DATA'} className="rounded-lg bg-attention px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Delete</button>
          </div>
        </div>
        {msg && <p className="mt-3 text-xs text-muted">{msg}</p>}
      </Card>
    </div>
  );
}
