import type { SeriesResponse } from '@bho/contracts';
import { METRIC_CATALOG, DOMAIN_LABELS, metricById } from '@bho/shared-config';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { TrendChart } from '@/components/TrendChart';

export const dynamic = 'force-dynamic';

export default async function TrendsPage({ searchParams }: { searchParams: Promise<{ metric?: string; days?: string }> }) {
  const sp = await searchParams;
  const metricId = sp.metric && metricById(sp.metric) ? sp.metric : 'resting_heart_rate';
  const days = Math.min(365, Math.max(7, Number(sp.days ?? 90) || 90));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const series = await apiFetch<SeriesResponse>(`/v1/metrics/${metricId}/series?from=${from.toISOString()}&to=${to.toISOString()}&bucket=raw`);
  const def = metricById(metricId)!;
  const groups = new Map<string, typeof METRIC_CATALOG>();
  for (const m of METRIC_CATALOG) groups.set(m.domain, [...(groups.get(m.domain) ?? []), m]);
  return (
    <>
      <PageHeader title="Trends" subtitle="Daily values from canonical observations. Missing days stay empty — they are never shown as zero.">
        <div className="flex gap-2 text-sm">
          {[30, 90, 365].map((d) => (
            <Link key={d} href={`/trends?metric=${metricId}&days=${d}`} className={`rounded-lg border px-3 py-1 ${d === days ? 'border-accent text-accent' : 'border-line text-muted'}`}>
              {d}d
            </Link>
          ))}
          <Link href="/trends/blood-pressure" className="rounded-lg border border-line px-3 py-1 text-muted">Blood pressure</Link>
        </div>
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit">
          <p className="text-xs uppercase tracking-widest text-muted">Metric</p>
          <nav className="mt-2 space-y-3">
            {[...groups].map(([domain, metrics]) => (
              <div key={domain}>
                <p className="text-[11px] uppercase tracking-wide text-muted">{DOMAIN_LABELS[domain as keyof typeof DOMAIN_LABELS]}</p>
                <ul className="mt-1 space-y-0.5">
                  {metrics.filter((m) => m.id !== 'lab_result').map((m) => (
                    <li key={m.id}>
                      <Link href={`/trends?metric=${m.id}&days=${days}`} className={`block rounded px-2 py-1 text-sm ${m.id === metricId ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'}`}>
                        {m.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </Card>
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">{def.label}</h2>
            <span className="text-xs text-muted">{def.unit} · daily {def.dailyAggregation}</span>
          </div>
          <TrendChart series={series} unit={def.unit} precision={def.precision} />
          <p className="mt-3 text-xs text-muted">
            {series.points.length} raw observation{series.points.length === 1 ? '' : 's'} ({series.points.filter((p) => !p.canonical).length} linked duplicates shown hollow), {series.daily.filter((d) => d.value !== null).length} of {series.daily.length} days with data.
          </p>
        </Card>
      </div>
    </>
  );
}
