import Link from 'next/link';
import type { Alert, HealthMemory, RecommendationsResponse } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { AlertRow, MemoryPanel, RecommendationCard } from '@/components/InboxActions';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const recs = await apiFetch<RecommendationsResponse>('/v1/recommendations');
  const alerts = await apiFetch<{ alerts: Alert[]; unread: number }>('/v1/alerts'); // refreshed by the reports job, the seed and the phone's sync, not on every page view
  const memories = await apiFetch<{ memories: HealthMemory[]; notes: string[] }>('/v1/memories');
  const active = recs.recommendations.filter((r) => ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'DISCUSS_WITH_CLINICIAN', 'SNOOZED'].includes(r.status));
  const closed = recs.recommendations.filter((r) => !active.includes(r));
  return (
    <>
      <PageHeader title="Inbox" subtitle="Recommendations with their evidence, alerts, and what the system remembers about you. Accepting is a decision you make; outcomes are measured, not promised.">
        <Link href="/health-ceo" className="rounded-lg border border-line px-3 py-1 text-sm text-muted">Latest report</Link>
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Recommendations</h2>
              <span className="text-xs text-muted">{Object.entries(recs.counts).map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, ' ')}`).join(' · ') || 'none yet'}</span>
            </div>
            <ul className="mt-3 space-y-3" data-testid="rec-list">
              {active.map((r) => <RecommendationCard key={r.id} rec={r} />)}
              {active.length === 0 && <li className="text-xs text-muted">No open recommendations. They are generated with each weekly report when the rules find enough evidence.</li>}
            </ul>
            {closed.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-muted">Closed ({closed.length}): dismissed, completed, expired</summary>
                <ul className="mt-3 space-y-3 opacity-70">{closed.map((r) => <RecommendationCard key={r.id} rec={r} />)}</ul>
              </details>
            )}
            <ul className="mt-4 list-disc space-y-1 pl-5 text-[11px] text-muted">{recs.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Alerts</h2><span className="text-xs text-muted">{alerts.unread} unread</span></div>
            <ul className="mt-2 divide-y divide-line" data-testid="alert-list">
              {alerts.alerts.map((a) => <AlertRow key={a.id} alert={a} />)}
              {alerts.alerts.length === 0 && <li className="py-2 text-xs text-muted">No alerts. Only report readiness, lab imports, connection problems, due follow-ups and medication reviews raise one.</li>}
            </ul>
            <p className="mt-2 text-[11px] text-muted">Alert titles never contain measurements; on the phone they stay private on the lock screen. Preferences are in <Link href="/settings" className="text-accent">Settings</Link>.</p>
          </Card>
          <Card>
            <h2 className="text-sm font-semibold">Health memory</h2>
            <p className="mt-1 text-[11px] text-muted">{memories.notes[0]}</p>
            <div className="mt-2"><MemoryPanel memories={memories.memories} /></div>
          </Card>
        </div>
      </div>
    </>
  );
}
