'use client';
import { useState } from 'react';
import type { NotificationPrefs } from '@bho/contracts';
import { ALERT_KINDS } from '@bho/contracts';
import { Card } from './ui';

export function NotificationPrefsForm({ prefs }: { prefs: NotificationPrefs }) {
  const [p, setP] = useState(prefs);
  const [msg, setMsg] = useState<string | null>(null);
  const input = 'rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs';
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/proxy/v1/notifications/prefs', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
    setMsg(res.ok ? 'Saved. The Android app applies these on its next sync.' : (await res.json()).message ?? 'failed');
  }
  return (
    <Card>
      <h2 className="text-base font-semibold">Notifications</h2>
      <p className="mt-1 text-xs text-muted">High-signal only. Titles never carry values and stay private on the lock screen; quiet hours are respected by the phone.</p>
      <form onSubmit={save} className="mt-3 space-y-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.pushEnabled} onChange={(e) => setP({ ...p, pushEnabled: e.target.checked })} data-testid="prefs-push" /> Push notifications on the phone</label>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Quiet hours <input type="time" value={p.quietHoursStart ?? ''} onChange={(e) => setP({ ...p, quietHoursStart: e.target.value || null })} className={input} /> to <input type="time" value={p.quietHoursEnd ?? ''} onChange={(e) => setP({ ...p, quietHoursEnd: e.target.value || null })} className={input} />
        </div>
        <fieldset className="grid grid-cols-2 gap-1 text-xs">
          <legend className="mb-1 text-muted">Kinds</legend>
          {ALERT_KINDS.map((k) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={p.enabledKinds.includes(k)} onChange={(e) => setP({ ...p, enabledKinds: e.target.checked ? [...p.enabledKinds, k] : p.enabledKinds.filter((x) => x !== k) })} /> {k.toLowerCase().replace(/_/g, ' ')}</label>
          ))}
        </fieldset>
        <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white dark:text-black" data-testid="prefs-save">Save notification preferences</button>
        {msg && <p className="text-xs text-muted">{msg}</p>}
      </form>
    </Card>
  );
}
