import Link from 'next/link';
import type { AiStatus, Report, ReportListResponse } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, Chip, Empty, PageHeader } from '@/components/ui';
import { ReportActions } from '@/components/ReportActions';
import { ReportView } from '@/components/ReportView';

export const dynamic = 'force-dynamic';

export default async function HealthCeoPage() {
  const list = await apiFetch<ReportListResponse>('/v1/reports');
  const ai = await apiFetch<AiStatus>('/v1/ai/status');
  const latest = list.reports[0];
  const report = latest ? await apiFetch<Report>(`/v1/reports/${latest.kind}/${latest.id}`).catch(() => null) : null;
  return (
    <>
      <PageHeader title="Health CEO" subtitle="Weekly report: the latest seven complete days against the preceding 28. Monthly board report: 30 days against the prior 90. Rules first; AI narrative only with your consent.">
        <ReportActions />
      </PageHeader>
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="text-sm font-semibold">Reports</h2>
          <ul className="mt-2 divide-y divide-line text-sm" data-testid="report-list">
            {list.reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/health-ceo/${r.kind}/${r.id}`} className="text-accent">{r.kind === 'weekly' ? 'Weekly Health CEO' : 'Monthly Health Board'} · {r.periodFrom} → {r.periodTo}</Link>
                <span className="text-xs text-muted">{new Date(r.generatedAt).toLocaleDateString()} · {r.status.toLowerCase()}</span>
              </li>
            ))}
            {list.reports.length === 0 && <li className="py-2 text-xs text-muted">No reports yet. Generate one once data has been synced; the demo seed creates the first weekly report.</li>}
          </ul>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">AI provider</h2><Chip tone={ai.status === 'CONFIGURED' ? 'good' : ai.status === 'MOCK' ? 'watch' : 'neutral'}>{ai.status.replace(/_/g, ' ').toLowerCase()}</Chip></div>
          <p className="mt-2 text-xs text-muted" data-testid="ai-status-note">{ai.note}</p>
          <p className="mt-2 text-xs text-muted">Sharing {ai.sharingEnabled ? 'on' : 'off'}{ai.excludedConnectors.length ? ` · excluded: ${ai.excludedConnectors.join(', ')}` : ''} · <Link href="/settings" className="text-accent">Settings</Link></p>
        </Card>
      </div>
      {report ? <ReportView report={report} /> : <Empty title="No report to show" body="Reports are built only from synced data; nothing is simulated." />}
    </>
  );
}
