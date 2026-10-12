import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { TodayResponse, TrendsResponse } from '@bho/contracts';
import { DOMAINS, DOMAIN_LABELS, metricById } from '@bho/shared-config';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { MetricTile } from '@/components/MetricTile';
import { domainTone, formatValue } from '@/lib/format';
import { DomainChart } from '@/components/DomainChart';

export const dynamic = 'force-dynamic';

export default async function DomainPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  if (!(DOMAINS as readonly string[]).includes(domain)) notFound();
  const today = await apiFetch<TodayResponse>('/v1/dashboard/today');
  const d = today.domains.find((x) => x.domain === domain)!;
  const trends = await Promise.all(d.metrics.map((m) => apiFetch<TrendsResponse>(`/v1/analytics/trends/${m.metricId}`).catch(() => null)));
  return (
    <>
      <PageHeader title={DOMAIN_LABELS[domain as keyof typeof DOMAIN_LABELS]} subtitle={d.summary}>
        <div className="flex items-center gap-2">
          <Chip tone={domainTone(d.status)}>{d.status.replace(/_/g, ' ').toLowerCase()}</Chip>
          <Link href="/today" className="rounded-lg border border-line px-3 py-1 text-sm text-muted">Today</Link>
        </div>
      </PageHeader>
      {d.evidence.length > 0 && (
        <Card className="mb-5">
          <p className="text-xs uppercase tracking-widest text-muted">Evidence</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{d.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{d.metrics.map((m) => <MetricTile key={m.metricId} card={m} />)}</div>
      <div className="mt-6 space-y-5">
        {d.metrics.map((m, i) => {
          const t = trends[i];
          const def = metricById(m.metricId);
          if (!t || !def) return null;
          const w90 = t.windows.find((w) => w.days === 90)!;
          const w365 = t.windows.find((w) => w.days === 365)!;
          return (
            <Card key={m.metricId}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">{def.label}</h2>
                <Link href={`/trends?metric=${m.metricId}&days=90`} className="text-xs text-accent">Open in Trends</Link>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {t.windows.map((w) => (
                  <div key={w.days}>
                    <p className="text-xs text-muted">{w.days}-day mean</p>
                    <p className="num font-medium">{formatValue(w.stats.mean, def.unit, def.precision)}</p>
                    <p className="text-[11px] text-muted">{w.stats.daysWithData}/{w.stats.days} days · {w.confidence.toLowerCase()}</p>
                  </div>
                ))}
              </div>
              <DomainChart daily={t.daily.slice(-90)} unit={def.unit} precision={def.precision} />
              <p className="mt-2 text-xs text-muted">
                {w90.stats.n > 0 ? `90-day range ${formatValue(w90.stats.min, '', def.precision)} – ${formatValue(w90.stats.max, '', def.precision)}` : 'No data in the last 90 days'}
                {t.percentile365 !== null ? ` · current week at the ${t.percentile365.toFixed(0)}th percentile of ${w365.stats.daysWithData} days` : ''}
              </p>
            </Card>
          );
        })}
      </div>
    </>
  );
}
