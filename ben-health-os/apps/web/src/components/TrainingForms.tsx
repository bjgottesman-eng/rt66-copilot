'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = 'rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm outline-none focus:border-accent';

export function TrainingSetForm() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [exercise, setExercise] = useState('');
  const [rows, setRows] = useState([{ reps: '5', loadKg: '', rpe: '' }]);
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sets = rows.filter((r) => r.reps && r.loadKg !== '').map((r, i) => ({ localDate: date, exercise, setIndex: i + 1, reps: Number(r.reps), loadKg: Number(r.loadKg), rpe: r.rpe ? Number(r.rpe) : null }));
    const res = await fetch('/api/proxy/v1/training/sets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sets }) });
    const body = await res.json();
    setMsg(res.ok ? `Saved ${body.sets.length} set(s).` : body.message ?? 'save failed');
    if (res.ok) setRows([{ reps: '5', loadKg: '', rpe: '' }]);
    router.refresh();
  }
  return (
    <form onSubmit={save} className="space-y-2 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">Date<br /><input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="text-xs text-muted">Exercise<br /><input className={input} value={exercise} onChange={(e) => setExercise(e.target.value)} placeholder="Back squat" required data-testid="set-exercise" /></label>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-10 text-muted">Set {i + 1}</span>
          <input className={`${input} w-20`} type="number" min={1} max={200} value={r.reps} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, reps: e.target.value } : x)))} placeholder="reps" aria-label="reps" data-testid={`set-reps-${i + 1}`} />
          <input className={`${input} w-24`} type="number" min={0} max={1000} step={0.5} value={r.loadKg} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, loadKg: e.target.value } : x)))} placeholder="kg" aria-label="load kg" data-testid={`set-load-${i + 1}`} />
          <input className={`${input} w-20`} type="number" min={1} max={10} step={0.5} value={r.rpe} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, rpe: e.target.value } : x)))} placeholder="RPE" aria-label="rpe" />
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setRows([...rows, { reps: '5', loadKg: rows[rows.length - 1]?.loadKg ?? '', rpe: '' }])} className="rounded-lg border border-line px-2 py-1 text-xs text-muted">+ set</button>
        <button className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white dark:text-black" data-testid="set-save">Save sets</button>
        {msg && <span className="text-xs text-muted" data-testid="set-msg">{msg}</span>}
      </div>
    </form>
  );
}

const DIMS: Array<[string, string, number, number]> = [['energy', 'Energy', 1, 10], ['mood', 'Mood', 1, 10], ['stress', 'Stress', 1, 10], ['soreness', 'Soreness', 1, 10], ['fatigue', 'Fatigue', 1, 10], ['focus', 'Focus', 1, 10], ['pain', 'Pain', 0, 10], ['perceivedSleepQuality', 'Sleep quality', 1, 10], ['subjectiveRecovery', 'Recovery', 1, 10]];
export function CheckInForm() {
  const router = useRouter();
  const [v, setV] = useState<Record<string, number | ''>>({ energy: 6, mood: 7, stress: 4, soreness: 3, fatigue: 4, focus: 7, pain: 0, perceivedSleepQuality: 7, subjectiveRecovery: 6 });
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { note: note || null };
    for (const [k] of DIMS) if (v[k] !== '') payload[k] = v[k];
    const res = await fetch('/api/proxy/v1/checkins', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    setMsg(res.ok ? 'Check-in saved.' : (await res.json()).message ?? 'save failed');
    router.refresh();
  }
  return (
    <form onSubmit={save} className="space-y-2 text-sm" data-testid="checkin-form">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {DIMS.map(([k, label, min, max]) => (
          <label key={k} className="text-xs text-muted">{label} <span className="num">{v[k] === '' ? '—' : v[k]}</span><input type="range" min={min} max={max} value={v[k] === '' ? min : v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="w-full" aria-label={label} data-testid={`checkin-${k}`} /></label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} min-w-64 flex-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" data-testid="checkin-note" />
        <button className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white dark:text-black" data-testid="checkin-save">Save check-in</button>
        {msg && <span className="text-xs text-muted" data-testid="checkin-msg">{msg}</span>}
      </div>
    </form>
  );
}
