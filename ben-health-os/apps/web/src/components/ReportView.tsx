import Link from 'next/link';
import type { Report } from '@bho/contracts';
import { Card, Chip } from './ui';

const claimTone = (c: string | null): 'good' | 'watch' | 'attention' | 'neutral' => (c === 'MEASURED_FACT' ? 'good' : c === 'DERIVED_TREND' ? 'neutral' : c === 'HYPOTHESIS' ? 'watch' : c === 'RECOMMENDATION' ? 'attention' : 'neutral');
export const claimLabel = (c: string | null) => (c ? c.replace(/_/g, ' ').toLowerCase() : 'unlabelled');
const aiTone = (s: string): 'good' | 'watch' | 'attention' | 'neutral' => (s === 'OK' ? 'good' : s === 'MOCK' ? 'watch' : s === 'FAILED' ? 'attention' : 'neutral');

export function ReportView({ report }: { report: Report }) {
  const c = report.content;
  const ai = c.aiNarrative;
  const gen = report.generator as { ai?: { status?: string }; version?: number; rules?: string };
  return (
    <div className="space-y-5" data-testid={`report-${report.kind}`}>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{report.kind === 'weekly' ? 'Weekly Health CEO report' : 'Monthly Health Board report'}</h2>
          <span className="text-xs text-muted">{report.periodFrom} → {report.periodTo}{report.baselineFrom ? ` · baseline ${report.baselineFrom} → ${report.baselineTo}` : ''} · generated {new Date(report.generatedAt).toLocaleString()}</span>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm" data-testid="report-summary">{c.executiveSummary.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </Card>
      <Card>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{report.kind === 'weekly' ? 'Top three priorities this week' : 'Priorities for next month'}</h3>
          <Link href="/inbox" className="text-xs text-accent">Open inbox</Link>
        </div>
        <ol className="mt-3 grid gap-3 md:grid-cols-3" data-testid="report-priorities">
          {c.priorities.map((p) => (
            <li key={p.rank} className={`rounded-xl border p-3 ${p.insufficient ? 'border-dashed border-line text-muted' : 'border-line'}`} data-testid={`priority-${p.rank}`}>
              <p className="text-xs uppercase tracking-widest text-muted">Priority {p.rank}</p>
              <p className="mt-1 text-sm font-medium">{p.title}</p>
              <p className="mt-1 text-xs text-muted">{p.text}</p>
              {p.recommendationId && <Link href={`/inbox#rec-${p.recommendationId}`} className="mt-2 inline-block text-xs text-accent">Evidence and actions</Link>}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-muted">Never more than three. A slot without enough evidence stays empty rather than being filled.</p>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        {c.sections.map((s) => (
          <Card key={s.key}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{s.title}</h3>
              <span className="flex gap-1">
                <Chip tone={claimTone(s.claimType)}>{claimLabel(s.claimType)}</Chip>
                {s.insufficient && <Chip tone="neutral">insufficient evidence</Chip>}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-sm">{s.lines.map((l, i) => <li key={i} className="border-t border-line pt-1 first:border-t-0 first:pt-0">{l}</li>)}</ul>
          </Card>
        ))}
      </div>
      {'physicianFollowUp' in c && (
        <Card>
          <h3 className="text-sm font-semibold">For your physician</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm" data-testid="report-physician">{c.physicianFollowUp.length ? c.physicianFollowUp.map((l, i) => <li key={i}>{l}</li>) : <li className="text-muted">Nothing flagged for clinical follow-up this period.</li>}</ul>
          <Link href="/physician-brief" className="mt-2 inline-block text-xs text-accent">Generate a physician brief</Link>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">AI narrative</h3>
          <Chip tone={aiTone(ai.status)}>{ai.status.replace(/_/g, ' ').toLowerCase()}{ai.provider ? ` · ${ai.provider}/${ai.model}` : ''}</Chip>
        </div>
        <p className="mt-1 text-xs text-muted" data-testid="ai-note">{ai.note}</p>
        {ai.summary && <p className="mt-3 text-sm">{ai.summary}</p>}
        {ai.findings.length > 0 && (
          <ul className="mt-3 space-y-2 text-sm">
            {ai.findings.map((f, i) => (
              <li key={i} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2"><Chip tone={claimTone(f.claimType)}>{claimLabel(f.claimType)}</Chip><span className="font-medium">{f.title}</span><Chip tone="neutral">{f.confidence.toLowerCase()} confidence</Chip>{f.clinicianReview && <Chip tone="watch">discuss with clinician</Chip>}</div>
                <p className="mt-1">{f.text}</p>
                {f.proposedAction && <p className="mt-1 text-xs"><span className="text-muted">Proposed: </span>{f.proposedAction}</p>}
                <p className="mt-1 text-[11px] text-muted">Cites {f.citations.join(', ')}{f.limitations ? ` · ${f.limitations}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
        {ai.physicianQuestions.length > 0 && <div className="mt-3 text-sm"><p className="text-xs uppercase tracking-widest text-muted">Questions prepared for your physician</p><ul className="mt-1 list-disc space-y-1 pl-5">{ai.physicianQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
        {ai.rejected.length > 0 && <div className="mt-3 text-xs text-muted"><p className="uppercase tracking-widest">Withheld by the validator</p><ul className="mt-1 list-disc space-y-1 pl-5">{ai.rejected.map((r, i) => <li key={i}>{r.title}: {r.reason}</li>)}</ul></div>}
      </Card>
      <p className="text-[11px] text-muted">{c.algorithm} v{c.version}{gen.rules ? ` · rules ${gen.rules}` : ''} · packet {c.packetHash.slice(0, 12)} · every line is labelled by claim type; nothing here is a diagnosis or a medication change.</p>
    </div>
  );
}
