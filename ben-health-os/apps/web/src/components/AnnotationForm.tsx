'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';
const KINDS = ['MEAL', 'EXERCISE', 'NOTE', 'MEDICATION_TAKEN', 'TAG'] as const;

/** Wall-clock time in the profile time zone → instant (two passes to settle DST edges). */
function zonedToIso(date: string, time: string, tz: string): string {
  const naive = Date.parse(`${date}T${time}:00Z`);
  const offsetAt = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')) - ms;
  };
  let ms = naive - offsetAt(naive);
  ms = naive - offsetAt(ms);
  return new Date(ms).toISOString();
}

export function AnnotationForm({ date, timeZone, annotations }: { date: string; timeZone: string; annotations: Array<{ id: string; kind: string; at: string; label: string }> }) {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('MEAL');
  const [time, setTime] = useState('12:00');
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const at = zonedToIso(date, time, timeZone);
    const res = await fetch('/api/proxy/v1/annotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, at, label }) });
    const body = await res.json();
    setMsg(res.ok ? 'Saved.' : body.message ?? 'failed');
    if (res.ok) {
      setLabel('');
      router.refresh();
    }
  }
  async function remove(id: string) {
    const res = await fetch(`/api/proxy/v1/annotations/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) router.refresh();
  }
  return (
    <div>
      <form onSubmit={submit} className="grid grid-cols-[auto_auto_1fr_auto] items-end gap-2">
        <label className="text-xs text-muted">Kind<select className={input} value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>{KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase().replace('_', ' ')}</option>)}</select></label>
        <label className="text-xs text-muted">Time<input className={input} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label className="text-xs text-muted">Label<input className={input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Pizza, 30-min walk" required maxLength={200} data-testid="annotation-label" /></label>
        <button className="rounded-lg border border-line px-3 py-2 text-sm" data-testid="annotation-save">Add</button>
      </form>
      <p className="mt-1 text-[11px] text-muted">Times are in your profile time zone ({timeZone}). Meal annotations get a post-meal excursion like logged meals; exercise annotations are shaded on the chart.</p>
      {msg && <p className="mt-1 text-xs text-muted">{msg}</p>}
      {annotations.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {annotations.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1">
              <span><span className="text-muted">{new Date(a.at).toLocaleTimeString(undefined, { timeZone, timeStyle: 'short' })} · {a.kind.toLowerCase().replace('_', ' ')}</span> · {a.label}</span>
              <button onClick={() => remove(a.id)} className="text-muted hover:text-attention">remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
