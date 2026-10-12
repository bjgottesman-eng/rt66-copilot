'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ManualBpForm() {
  const router = useRouter();
  const [state, setState] = useState({ systolic: '', diastolic: '', pulse: '', arm: 'LEFT', posture: 'SEATED', seatedRestMinutes: '5', notes: '', measuredAt: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload = {
      systolic: Number(state.systolic),
      diastolic: Number(state.diastolic),
      pulse: state.pulse ? Number(state.pulse) : null,
      measuredAt: state.measuredAt ? new Date(state.measuredAt).toISOString() : new Date().toISOString(),
      arm: state.arm,
      posture: state.posture,
      seatedRestMinutes: state.seatedRestMinutes ? Number(state.seatedRestMinutes) : null,
      notes: state.notes || null,
      clientEntryId: `web-${crypto.randomUUID()}`,
    };
    const res = await fetch('/api/proxy/v1/measurements/blood-pressure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    setMsg(res.ok ? `Saved ${body.systolic}/${body.diastolic}${body.canonical ? '' : ' (linked as duplicate of a cuff reading)'}.` : body.message ?? 'failed');
    setBusy(false);
    if (res.ok) router.refresh();
  }
  const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-accent';
  return (
    <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-3 text-xs">
      <label>Systolic<input className={input} type="number" required min={50} max={260} value={state.systolic} onChange={(e) => setState({ ...state, systolic: e.target.value })} data-testid="bp-sys" /></label>
      <label>Diastolic<input className={input} type="number" required min={30} max={160} value={state.diastolic} onChange={(e) => setState({ ...state, diastolic: e.target.value })} data-testid="bp-dia" /></label>
      <label>Pulse<input className={input} type="number" min={25} max={220} value={state.pulse} onChange={(e) => setState({ ...state, pulse: e.target.value })} /></label>
      <label>Seated rest (min)<input className={input} type="number" min={0} max={60} value={state.seatedRestMinutes} onChange={(e) => setState({ ...state, seatedRestMinutes: e.target.value })} /></label>
      <label>Arm<select className={input} value={state.arm} onChange={(e) => setState({ ...state, arm: e.target.value })}><option>LEFT</option><option>RIGHT</option><option>UNKNOWN</option></select></label>
      <label>Posture<select className={input} value={state.posture} onChange={(e) => setState({ ...state, posture: e.target.value })}><option>SEATED</option><option>STANDING</option><option>LYING</option><option>RECLINING</option></select></label>
      <label className="col-span-2">Measured at (blank = now)<input className={input} type="datetime-local" value={state.measuredAt} onChange={(e) => setState({ ...state, measuredAt: e.target.value })} /></label>
      <label className="col-span-2">Notes<input className={input} value={state.notes} onChange={(e) => setState({ ...state, notes: e.target.value })} /></label>
      <button disabled={busy} className="col-span-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:text-black" data-testid="bp-save">{busy ? 'Saving…' : 'Save reading'}</button>
      {msg && <p className="col-span-2 text-muted" data-testid="bp-msg">{msg}</p>}
    </form>
  );
}
