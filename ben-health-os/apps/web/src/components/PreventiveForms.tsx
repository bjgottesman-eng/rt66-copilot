'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PreventiveResponse } from '@bho/contracts';

const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';
const STATUSES = ['DISCUSS_WITH_CLINICIAN', 'COMPLETED', 'DUE', 'NOT_APPLICABLE'];

export function PreventiveForms({ templates }: { templates: PreventiveResponse['templates'] }) {
  const router = useRouter();
  const [f, setF] = useState({ title: '', category: '', guidelineSource: '', guidelineReviewedAt: '', intervalMonths: '', lastCompletedAt: '', status: 'DISCUSS_WITH_CLINICIAN', notes: '' });
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/proxy/v1/preventive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: f.title, category: f.category, guidelineSource: f.guidelineSource, guidelineReviewedAt: f.guidelineReviewedAt || null, intervalMonths: f.intervalMonths ? Number(f.intervalMonths) : null, lastCompletedAt: f.lastCompletedAt || null, status: f.status, notes: f.notes || null }) });
    const body = await res.json();
    setMsg(res.ok ? `Added ${f.title}.` : body.message ?? 'failed');
    if (res.ok) {
      setF({ ...f, title: '', notes: '' });
      router.refresh();
    }
  }
  return (
    <div className="text-xs">
      <p className="text-muted">Start from a template (it only names the official source to check) or add your own item. Every item needs a guideline source; record the date you reviewed that guidance with your clinician.</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {templates.map((t) => (
          <button key={t.title} type="button" onClick={() => setF({ ...f, title: t.title, category: t.category, guidelineSource: t.guidelineSource, intervalMonths: t.intervalMonths ? String(t.intervalMonths) : '', notes: t.note })} className="rounded-md border border-line px-2 py-0.5 text-muted hover:text-ink" data-testid={`template-${t.category.toLowerCase()}`}>{t.title}</button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-muted">Title<input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required data-testid="prev-title" /></label>
        <label className="text-muted">Category<input className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} required placeholder="VACCINATION" /></label>
        <label className="col-span-2 text-muted">Guideline source (required)<input className={input} value={f.guidelineSource} onChange={(e) => setF({ ...f, guidelineSource: e.target.value })} required /></label>
        <label className="text-muted">Guidance reviewed on<input className={input} type="date" value={f.guidelineReviewedAt} onChange={(e) => setF({ ...f, guidelineReviewedAt: e.target.value })} /></label>
        <label className="text-muted">Interval (months)<input className={input} type="number" min={1} value={f.intervalMonths} onChange={(e) => setF({ ...f, intervalMonths: e.target.value })} /></label>
        <label className="text-muted">Last completed<input className={input} type="date" value={f.lastCompletedAt} onChange={(e) => setF({ ...f, lastCompletedAt: e.target.value })} /></label>
        <label className="text-muted">Status<select className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase().replace(/_/g, ' ')}</option>)}</select></label>
        <label className="col-span-2 text-muted sm:col-span-3">Notes<input className={input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <div className="flex items-end gap-2"><button className="rounded-lg border border-line px-3 py-2 text-sm" data-testid="prev-save">Add item</button>{msg && <span className="text-muted">{msg}</span>}</div>
      </form>
    </div>
  );
}

export function PreventiveItemActions({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <span className="flex items-center gap-1 text-xs">
      <input type="date" className="rounded border border-line bg-surface-2 px-1 py-0.5" value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="rounded border border-line px-2 py-0.5" onClick={async () => { await fetch(`/api/proxy/v1/preventive/${id}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ completedAt: date }) }); router.refresh(); }}>mark completed</button>
      <button className="text-muted hover:text-attention" onClick={async () => { if (!confirm(`Remove ${title}?`)) return; await fetch(`/api/proxy/v1/preventive/${id}`, { method: 'DELETE' }); router.refresh(); }}>remove</button>
    </span>
  );
}
