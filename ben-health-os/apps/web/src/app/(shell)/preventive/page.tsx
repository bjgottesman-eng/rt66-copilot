import type { PreventiveResponse } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { PreventiveForms, PreventiveItemActions } from '@/components/PreventiveForms';

export const dynamic = 'force-dynamic';
const tone = (s: string): 'good' | 'watch' | 'attention' | 'neutral' => (s === 'DUE' ? 'attention' : s === 'DUE_SOON' ? 'watch' : s === 'COMPLETED' ? 'good' : 'neutral');

export default async function PreventivePage() {
  const p = await apiFetch<PreventiveResponse>('/v1/preventive');
  return (
    <>
      <PageHeader title="Preventive care" subtitle={`As of ${p.today}. DUE / DUE SOON / COMPLETED are computed from your own intervals; the app never assumes a screening applies to you.`}>
        <a href="/api/proxy/v1/preventive/calendar.ics" className="rounded-lg border border-line px-3 py-1 text-sm text-muted" data-testid="prev-calendar">Export calendar (.ics)</a>
      </PageHeader>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {[['Due', p.counts.due, 'attention'], ['Due within 60 days', p.counts.dueSoon, 'watch'], ['Completed', p.counts.completed, 'good'], ['Discuss with clinician', p.counts.discuss, 'neutral'], ['Not applicable', p.counts.notApplicable, 'neutral']].map(([label, n, t]) => (
          <Card key={String(label)}><p className="text-xs text-muted">{label}</p><p className="num mt-1 text-2xl font-semibold">{n as number}</p><Chip tone={t as 'good'}>{String(label).toLowerCase()}</Chip></Card>
        ))}
      </div>
      <Card className="mt-5">
        <h3 className="text-sm font-semibold">Items</h3>
        <ul className="mt-2 space-y-2 text-sm" data-testid="prev-list">
          {p.items.map((i) => (
            <li key={i.id} className="border-t border-line pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{i.title} <span className="text-xs text-muted">· {i.category.toLowerCase().replace(/_/g, ' ')}</span></span>
                <span className="flex flex-wrap items-center gap-2"><Chip tone={tone(i.computedStatus)}>{i.computedStatus.toLowerCase().replace(/_/g, ' ')}{i.computedDueAt ? ` · ${i.computedDueAt}` : ''}</Chip><PreventiveItemActions id={i.id} title={i.title} /></span>
              </div>
              <p className="text-xs text-muted">Source: {i.guidelineSource}{i.guidelineReviewedAt ? ` (reviewed ${i.guidelineReviewedAt})` : ' (guidance not yet reviewed with a clinician)'}{i.intervalMonths ? ` · every ${i.intervalMonths} months` : ''}{i.lastCompletedAt ? ` · last ${i.lastCompletedAt}` : ''}{i.notes ? ` · ${i.notes}` : ''}</p>
            </li>
          ))}
          {p.items.length === 0 && <li className="text-xs text-muted">No items yet.</li>}
        </ul>
      </Card>
      <Card className="mt-5">
        <h3 className="text-sm font-semibold">Add an item</h3>
        <div className="mt-2"><PreventiveForms templates={p.templates} /></div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted">{p.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </Card>
    </>
  );
}
