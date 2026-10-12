import { apiFetch } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { BriefForm } from '@/components/BriefForm';

export const dynamic = 'force-dynamic';

export default async function PhysicianBriefPage() {
  const { briefs } = await apiFetch<{ briefs: Array<{ id: string; generatedAt: string; reasonForVisit: string | null }> }>('/v1/physician-brief');
  return (
    <>
      <PageHeader title="Physician brief" subtitle="A concise PDF for your clinician: reason for visit, confirmed medications, allergies, conditions, blood pressure and weight trends, lab results with the lab’s ranges, exercise and recovery, recent changes, your questions. Every value carries its source and date. No AI content." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold">Generate</h3>
          <div className="mt-2"><BriefForm /></div>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold">Previous briefs</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {briefs.map((b) => <li key={b.id} className="flex items-center justify-between border-t border-line pt-1"><span>{b.generatedAt.slice(0, 16).replace('T', ' ')} · {b.reasonForVisit ?? '—'}</span><a className="text-xs text-accent underline" href={`/api/proxy/v1/physician-brief/${b.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></li>)}
            {briefs.length === 0 && <li className="text-xs text-muted">None yet.</li>}
          </ul>
          <p className="mt-3 text-xs text-muted">Only confirmed results and medications are included; items still waiting for review are counted but not listed. The brief is stored with your documents and included in Export all data.</p>
        </Card>
      </div>
    </>
  );
}
