import Link from 'next/link';
import type { LabReviewQueueResponse, LabsOverviewResponse } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { LabImportForm } from '@/components/LabImportForm';
import { LabReviewQueue } from '@/components/LabReviewQueue';
import { ManualLabForm } from '@/components/ManualLabForm';

export const dynamic = 'force-dynamic';
const n = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d }));

export default async function LabsPage() {
  const [labs, queue] = await Promise.all([apiFetch<LabsOverviewResponse>('/v1/labs'), apiFetch<LabReviewQueueResponse>('/v1/labs/review')]);
  const confirmed = labs.analytes.reduce((a, x) => a + x.count, 0);
  return (
    <>
      <PageHeader title="Labs" subtitle="Laboratory history from Function Health exports, clinical records and manual entry. Ranges and flags are the laboratory’s; nothing is interpreted.">
        <div className="flex items-center gap-2">
          <Link href="/preventive" className="rounded-lg border border-line px-3 py-1 text-sm text-muted">Preventive care</Link>
          <Link href="/physician-brief" className="rounded-lg border border-line px-3 py-1 text-sm text-muted">Physician brief</Link>
        </div>
      </PageHeader>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="labs-summary">
        <Card><p className="text-xs text-muted">Confirmed results</p><p className="num mt-1 text-2xl font-semibold">{confirmed}</p><p className="text-[11px] text-muted">{labs.analytes.length} analytes</p></Card>
        <Card><p className="text-xs text-muted">Latest panel</p><p className="num mt-1 text-2xl font-semibold">{labs.latestCollectedAt ? labs.latestCollectedAt.slice(0, 10) : '—'}</p><p className="text-[11px] text-muted">{labs.latestCollectedAt ? relativeTime(labs.latestCollectedAt) : 'no confirmed results'}</p></Card>
        <Card><p className="text-xs text-muted">Pending review</p><p className="num mt-1 text-2xl font-semibold">{labs.pendingReview}</p><p className="text-[11px] text-muted">staged rows do not count yet</p></Card>
        <Card><p className="text-xs text-muted">Sources</p><p className="mt-1 text-sm font-medium">{labs.sources.length ? labs.sources.join(', ') : '—'}</p><p className="text-[11px] text-muted">clinical records outrank file imports for duplicates</p></Card>
      </div>
      {queue.total > 0 && (
        <Card className="mt-5 border-watch/40">
          <h3 className="text-sm font-semibold">Review {queue.total} imported result(s)</h3>
          <p className="mt-1 text-xs text-muted">Check the mapping, value, unit and collection date, then confirm. Rejected rows stay on file as evidence but never count.</p>
          <div className="mt-3"><LabReviewQueue key={queue.pending.map((p) => p.id).join(',')} pending={queue.pending} /></div>
        </Card>
      )}
      <Card className="mt-5">
        <h3 className="text-sm font-semibold">Analytes</h3>
        <div className="mt-2 overflow-x-auto" data-testid="labs-analytes">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Analyte</th><th className="py-1 pr-3">Latest</th><th className="py-1 pr-3">Canonical</th><th className="py-1 pr-3">Reference</th><th className="py-1 pr-3">Flag</th><th className="py-1 pr-3">Collected</th><th className="py-1 pr-3">vs previous</th><th className="py-1 pr-3">Results</th><th className="py-1 pr-3">Source</th></tr></thead>
            <tbody>
              {labs.analytes.map((a) => (
                <tr key={a.analyteKey} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3">{a.label}{!a.mapped && <span className="ml-1 text-[11px] text-muted">(unmapped)</span>}<details className="text-xs text-muted"><summary className="cursor-pointer">history</summary><ul className="mt-1 space-y-0.5">{a.history.map((h) => <li key={h.id}>{h.collectedAt?.slice(0, 10) ?? '?'}: {h.valueText ?? n(h.value)} {h.unit ?? ''}{h.abnormalFlag ? ` (${h.abnormalFlag})` : ''} · {h.source}{h.canonical ? '' : ' · linked duplicate'}</li>)}</ul></details></td>
                  <td className="num py-1.5 pr-3 font-medium">{a.latest ? `${a.latest.valueText ?? n(a.latest.value)} ${a.latest.unit ?? ''}` : '—'}</td>
                  <td className="num py-1.5 pr-3">{a.latest?.canonicalValue != null ? `${n(a.latest.canonicalValue)} ${a.latest.canonicalUnit}` : a.latest?.qualityFlags.some((f) => f.startsWith('UNIT_NOT')) ? <span className="text-watch">not convertible</span> : '—'}</td>
                  <td className="py-1.5 pr-3 text-xs">{a.latest?.referenceText ?? '—'}</td>
                  <td className="py-1.5 pr-3">{a.latest?.abnormalFlag ? <Chip tone={a.latest.abnormalFlag === 'N' ? 'good' : 'watch'}>{a.latest.abnormalFlag}</Chip> : a.flaggedLatest ? <Chip tone="watch">outside range</Chip> : ''}</td>
                  <td className="num py-1.5 pr-3">{a.latest?.collectedAt?.slice(0, 10) ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-xs">{a.direction ? <Chip tone="neutral">{a.direction.toLowerCase()} {a.deltaPct != null ? `${a.deltaPct > 0 ? '+' : ''}${a.deltaPct}%` : ''}</Chip> : <span className="text-muted">{a.count > 1 ? 'not comparable' : 'single result'}</span>}</td>
                  <td className="num py-1.5 pr-3">{a.count}</td>
                  <td className="py-1.5 pr-3 text-xs text-muted">{a.latest?.source}{a.latest?.laboratory ? ` · ${a.latest.laboratory}` : ''}</td>
                </tr>
              ))}
              {labs.analytes.length === 0 && <tr><td colSpan={9} className="py-3 text-sm text-muted">No confirmed results yet. Import a Function Health PDF or CSV, connect clinical records in Data Sources, or add a result manually.</td></tr>}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">{labs.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold">Import lab results (PDF or CSV)</h3>
          <div className="mt-2"><LabImportForm /></div>
        </Card>
        <div className="space-y-5">
          <Card>
            <h3 className="text-sm font-semibold">Add a result manually</h3>
            <p className="mt-1 text-xs text-muted">Confirmed on save; deduplicated against imported results for the same day.</p>
            <div className="mt-2"><ManualLabForm /></div>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold">Documents</h3>
            <ul className="mt-2 space-y-1 text-xs">
              {labs.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-1">
                  <span>{d.title} <span className="text-muted">· {d.kind.replace('LAB_', '').toLowerCase()} · {d.documentDate ?? 'date unknown'}{d.pageCount ? ` · ${d.pageCount} p.` : ''}</span></span>
                  <span className="flex items-center gap-2"><Chip tone={d.extractionStatus === 'CONFIRMED' ? 'good' : d.extractionStatus === 'REVIEW' ? 'watch' : 'neutral'}>{d.extractionStatus.toLowerCase()}</Chip><span className="text-muted">{d.resultsConfirmed} confirmed · {d.resultsStaged} pending</span><a className="text-accent" href={`/api/proxy/v1/documents/${d.id}/file`} target="_blank" rel="noreferrer">open</a></span>
                </li>
              ))}
              {labs.documents.length === 0 && <li className="text-muted">No documents uploaded.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
