'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Experiment, ExperimentsResponse } from '@bho/contracts';
import { Chip } from './ui';

const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';
const btn = 'rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-ink disabled:opacity-50';
const verdictTone = (v: string | null | undefined): 'good' | 'watch' | 'attention' | 'neutral' => (v === 'ADOPT' ? 'good' : v === 'RETEST' || v === 'INCONCLUSIVE' ? 'watch' : v === 'REJECT' ? 'attention' : 'neutral');
const statusTone = (s: string): 'good' | 'watch' | 'attention' | 'neutral' => (s === 'COMPLETED' ? 'good' : s === 'INTERVENTION' ? 'watch' : s === 'ABANDONED' ? 'neutral' : 'neutral');
const pretty = (s: string | null | undefined) => (s ?? '—').toLowerCase().replace(/_/g, ' ');

export function ExperimentForm({ outcomeMetrics }: { outcomeMetrics: ExperimentsResponse['outcomeMetrics'] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ title: '', researchQuestion: '', hypothesis: '', intervention: '', primaryOutcomeMetric: 'resting_heart_rate', secondary: '', design: 'BEFORE_AFTER', plannedBaselineDays: 14, plannedInterventionDays: 14, plannedBlocks: 2, plannedWashoutDays: 0, startDate: today, confounders: '', adherenceMeasure: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string, v: string | number) => setF({ ...f, [k]: v });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch('/api/proxy/v1/experiments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: f.title, researchQuestion: f.researchQuestion, hypothesis: f.hypothesis, intervention: f.intervention, primaryOutcomeMetric: f.primaryOutcomeMetric, secondaryOutcomeMetrics: f.secondary ? f.secondary.split(',').map((s) => s.trim()).filter(Boolean) : [], design: f.design, plannedBaselineDays: Number(f.plannedBaselineDays), plannedInterventionDays: Number(f.plannedInterventionDays), plannedBlocks: f.design === 'BEFORE_AFTER' ? 1 : Number(f.plannedBlocks), plannedWashoutDays: Number(f.plannedWashoutDays), startDate: f.startDate || undefined, confounders: f.confounders ? f.confounders.split(',').map((s) => s.trim()).filter(Boolean) : [], adherenceMeasure: f.adherenceMeasure || null }) });
    const body = await res.json();
    if (!res.ok) {
      setMsg(body.message ?? 'could not create the experiment');
      return;
    }
    setMsg('Experiment created.');
    setF({ ...f, title: '', researchQuestion: '', hypothesis: '', intervention: '' });
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <label className="block text-xs text-muted">Title<input className={input} value={f.title} onChange={(e) => set('title', e.target.value)} required data-testid="exp-title" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted">Research question<input className={input} value={f.researchQuestion} onChange={(e) => set('researchQuestion', e.target.value)} required data-testid="exp-question" /></label>
        <label className="block text-xs text-muted">Hypothesis (what change, how big, by when)<input className={input} value={f.hypothesis} onChange={(e) => set('hypothesis', e.target.value)} required data-testid="exp-hypothesis" /></label>
      </div>
      <label className="block text-xs text-muted">Intervention (one change only; no medication changes)<input className={input} value={f.intervention} onChange={(e) => set('intervention', e.target.value)} required data-testid="exp-intervention" /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-muted">Primary outcome<select className={input} value={f.primaryOutcomeMetric} onChange={(e) => set('primaryOutcomeMetric', e.target.value)} data-testid="exp-metric">{outcomeMetrics.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.unit})</option>)}</select></label>
        <label className="block text-xs text-muted">Secondary outcomes (metric ids, comma-separated)<input className={input} value={f.secondary} onChange={(e) => set('secondary', e.target.value)} placeholder="hrv_rmssd, checkin:energy" /></label>
        <label className="block text-xs text-muted">Design<select className={input} value={f.design} onChange={(e) => set('design', e.target.value)}><option value="BEFORE_AFTER">Before / after</option><option value="ALTERNATING">Alternating blocks (stronger)</option></select></label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className="block text-xs text-muted">Baseline days<input className={input} type="number" min={3} max={90} value={f.plannedBaselineDays} onChange={(e) => set('plannedBaselineDays', e.target.value)} /></label>
        <label className="block text-xs text-muted">Intervention days<input className={input} type="number" min={3} max={90} value={f.plannedInterventionDays} onChange={(e) => set('plannedInterventionDays', e.target.value)} /></label>
        {f.design !== 'BEFORE_AFTER' && <label className="block text-xs text-muted">Blocks<input className={input} type="number" min={1} max={6} value={f.plannedBlocks} onChange={(e) => set('plannedBlocks', e.target.value)} /></label>}
        {f.design !== 'BEFORE_AFTER' && <label className="block text-xs text-muted">Washout days<input className={input} type="number" min={0} max={30} value={f.plannedWashoutDays} onChange={(e) => set('plannedWashoutDays', e.target.value)} /></label>}
        <label className="block text-xs text-muted">Start (baseline begins)<input className={input} type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted">Possible confounders (comma-separated)<input className={input} value={f.confounders} onChange={(e) => set('confounders', e.target.value)} placeholder="travel, illness, new training block" /></label>
        <label className="block text-xs text-muted">How adherence is measured<input className={input} value={f.adherenceMeasure} onChange={(e) => set('adherenceMeasure', e.target.value)} placeholder="daily check-in: did it / skipped" /></label>
      </div>
      <div className="flex items-center gap-3">
        <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white dark:text-black" data-testid="exp-save">Create experiment</button>
        {msg && <span className="text-xs text-muted" data-testid="exp-msg">{msg}</span>}
      </div>
    </form>
  );
}

export function ExperimentActions({ exp }: { exp: Experiment }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/proxy/v1/experiments/${exp.id}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    if (!res.ok) setMsg((await res.json()).message ?? 'request failed');
    router.refresh();
  }
  const open = !['COMPLETED', 'ABANDONED'].includes(exp.status);
  const inIntervention = exp.status === 'INTERVENTION';
  const todayEntry = exp.phases.flatMap((p) => p.adherence).find((a) => a.date === today);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {exp.status === 'DRAFT' && <button disabled={busy} onClick={() => call('', 'PATCH', { action: 'start', startDate: today })} className={btn} data-testid="exp-start">Start today</button>}
      {inIntervention && <><button disabled={busy} onClick={() => call('/adherence', 'POST', { date: today, adhered: true })} className={`${btn} ${todayEntry?.adhered ? 'border-good text-good' : ''}`} data-testid="exp-adhered">Did it today</button><button disabled={busy} onClick={() => call('/adherence', 'POST', { date: today, adhered: false })} className={`${btn} ${todayEntry && !todayEntry.adhered ? 'border-attention text-attention' : ''}`}>Skipped today</button></>}
      {open && exp.status !== 'DRAFT' && <button disabled={busy} onClick={() => call('/evaluate', 'POST')} className={btn} data-testid="exp-evaluate">Evaluate now</button>}
      {open && exp.status !== 'DRAFT' && <button disabled={busy} onClick={() => call('', 'PATCH', { action: 'extend_intervention', extraDays: 7 })} className={btn}>Extend intervention 7 days</button>}
      {open && exp.status !== 'DRAFT' && (
        <span className="flex flex-wrap items-center gap-1">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note" className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs" />
          {(['ADOPT', 'RETEST', 'INCONCLUSIVE', 'REJECT'] as const).map((d) => <button key={d} disabled={busy} onClick={() => call('', 'PATCH', { action: 'decide', decision: d, decisionNote: note || undefined })} className={btn} data-testid={`exp-decide-${d}`}>{pretty(d)}</button>)}
        </span>
      )}
      {open && <button disabled={busy} onClick={() => confirm('Abandon this experiment? Its data stays; no verdict is recorded.') && call('', 'PATCH', { action: 'abandon', decisionNote: note || undefined })} className={`${btn} border-attention/40 text-attention`}>Abandon</button>}
      {msg && <span className="text-xs text-attention">{msg}</span>}
    </div>
  );
}

export function VerdictBadge({ exp }: { exp: Experiment }) {
  const ev = exp.evaluation;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Chip tone={statusTone(exp.status)}>{pretty(exp.status)}</Chip>
      {ev && <Chip tone={verdictTone(ev.verdict)}>{pretty(ev.verdict)}{ev.preliminary ? ' · preliminary' : ''} · {ev.confidence.toLowerCase()} confidence</Chip>}
      {exp.decision && <Chip tone={verdictTone(exp.decision)}>decision: {pretty(exp.decision)}</Chip>}
    </span>
  );
}
