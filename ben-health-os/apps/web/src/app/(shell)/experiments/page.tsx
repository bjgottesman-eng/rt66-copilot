import Link from 'next/link';
import type { ExperimentsResponse } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { ExperimentChart } from '@/components/ExperimentChart';
import { ExperimentActions, ExperimentForm, VerdictBadge } from '@/components/ExperimentForms';

export const dynamic = 'force-dynamic';
const fmt = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits }));

export default async function ExperimentsPage() {
  const data = await apiFetch<ExperimentsResponse>('/v1/experiments');
  const open = data.experiments.filter((e) => !['COMPLETED', 'ABANDONED'].includes(e.status));
  const closed = data.experiments.filter((e) => ['COMPLETED', 'ABANDONED'].includes(e.status));
  return (
    <>
      <PageHeader title="Experiments" subtitle="One change at a time, your own baseline against your own intervention days, the same change classifier as the trend engine. Verdicts never claim causation.">
        <Link href="/inbox" className="rounded-lg border border-line px-3 py-1 text-sm text-muted">Recommendations</Link>
      </PageHeader>
      <div className="space-y-5">
        {open.length === 0 && <Card><p className="text-sm text-muted">No experiment is running. Design one below; the recommendation inbox proposes low-risk candidates.</p></Card>}
        {[...open, ...closed].map((exp) => {
          const ev = exp.evaluation;
          return (
            <Card key={exp.id} className={closed.includes(exp) ? 'opacity-80' : ''} data-testid="experiment-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{exp.title}</h2>
                  <p className="text-xs text-muted">{exp.design.toLowerCase().replace(/_/g, ' ')} · outcome {exp.primaryOutcomeLabel}{exp.secondaryOutcomeMetrics.length ? ` · also ${exp.secondaryOutcomeMetrics.join(', ')}` : ''}{exp.startDate ? ` · ${exp.startDate} → ${exp.endDate ?? 'open'}` : ' · not started'}</p>
                </div>
                <VerdictBadge exp={exp} />
              </div>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                <p><span className="text-muted">Question: </span>{exp.researchQuestion}</p>
                <p><span className="text-muted">Hypothesis: </span>{exp.hypothesis}</p>
                <p><span className="text-muted">Intervention: </span>{exp.intervention}</p>
              </div>
              {exp.phases.length > 0 && (
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                  {exp.phases.map((p) => {
                    const pe = ev?.phases.find((x) => x.sequence === p.sequence);
                    return (
                      <div key={p.id} className="rounded-lg border border-line p-2">
                        <p className="font-medium">{p.sequence}. {p.phase.toLowerCase()} <span className="text-muted">{p.startDate} → {p.endDate ?? 'open'}</span></p>
                        {pe ? <p className="text-muted">mean {fmt(pe.stats.mean)} {ev!.unit} · {pe.stats.daysWithData}/{pe.stats.days} days{pe.adherenceRate !== null ? ` · adherence ${Math.round(pe.adherenceRate * 100)}% (${pe.adherenceDays} logged)` : p.phase === 'INTERVENTION' ? ' · no adherence logged' : ''}</p> : <p className="text-muted">not evaluated yet</p>}
                      </div>
                    );
                  })}
                </div>
              )}
              <ExperimentChart daily={exp.daily} unit={ev?.unit ?? ''} />
              {ev && (
                <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm" data-testid="experiment-evaluation">
                  <p className="font-medium">{ev.summary}</p>
                  <p className="mt-1 text-xs text-muted">Baseline {fmt(ev.baseline?.mean)} → intervention {fmt(ev.intervention?.mean)} {ev.unit} · Δ {fmt(ev.delta)} ({ev.deltaPct !== null ? `${ev.deltaPct > 0 ? '+' : ''}${fmt(ev.deltaPct)}%` : '—'}) · effect size {fmt(ev.effectSize, 2)} · {ev.changeClass.toLowerCase().replace('_', ' ')}{ev.consistency !== null ? ` · block consistency ${Math.round(ev.consistency * 100)}%` : ''}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{ev.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  {ev.secondary.length > 0 && <p className="mt-2 text-xs"><span className="text-muted">Secondary: </span>{ev.secondary.map((s) => `${s.label} ${fmt(s.baselineMean)} → ${fmt(s.interventionMean)} ${s.unit} (${s.changeClass.toLowerCase().replace('_', ' ')})`).join(' · ')}</p>}
                  <p className="mt-2 text-[11px] text-muted">Limitations: {ev.limitations.join(' ')}</p>
                  <p className="mt-1 text-[11px] text-muted">{ev.algorithm} v{ev.version} · evaluated {new Date(ev.evaluatedAt).toLocaleString()} · <Chip tone="neutral">derived trend</Chip></p>
                </div>
              )}
              {exp.decisionNote && <p className="mt-2 text-xs text-muted">Decision note: {exp.decisionNote}</p>}
              <ExperimentActions exp={exp} />
            </Card>
          );
        })}
        <Card>
          <h2 className="text-base font-semibold">Design a new experiment</h2>
          <p className="mt-1 text-xs text-muted">Pick one low-risk change, the metric that should move, and how long each phase lasts. Alternating blocks are stronger than before/after. Medication changes are not experiments here; discuss those with your clinician.</p>
          <div className="mt-3"><ExperimentForm outcomeMetrics={data.outcomeMetrics} /></div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-[11px] text-muted">{data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
