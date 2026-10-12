import type { TodayResponse } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { DomainCard } from '@/components/DomainCard';
import { DemoControls } from '@/components/DemoControls';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const today = await apiFetch<TodayResponse>('/v1/dashboard/today');
  const empty = today.dataQuality.observations30d === 0;
  return (
    <>
      <PageHeader title="Today" subtitle={`${new Date(today.generatedAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })} · ${today.timeZone}`} />
      {empty && (
        <Card className="mb-6 border-accent/40">
          <h2 className="text-base font-semibold">No data yet</h2>
          <p className="mt-1 text-sm text-muted">Install the Android app and grant Health Connect permissions, or load the synthetic demo dataset to explore the dashboard.</p>
          <DemoControls demoMode={today.demoMode} />
        </Card>
      )}
      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <p className="text-xs uppercase tracking-widest text-muted">How am I doing?</p>
          <p className="mt-2 text-lg font-medium" data-testid="headline">{today.headline}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-widest text-muted">What changed</p>
          <ul className="mt-2 space-y-2 text-sm">{today.whatChanged.length ? today.whatChanged.map((s, i) => <li key={i}>{s}</li>) : <li className="text-muted">No meaningful or directional changes versus your 28-day baseline.</li>}</ul>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-widest text-muted">What matters</p>
          <ul className="mt-2 space-y-2 text-sm">{today.whatMatters.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-widest text-muted">What should I do today</p>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{today.doToday.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Card>
      </section>
      <div className="space-y-5">
        {today.domains.map((d) => (
          <DomainCard key={d.domain} domain={d} />
        ))}
      </div>
      <Card className="mt-6">
        <p className="text-xs uppercase tracking-widest text-muted">Data quality</p>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div><dt className="text-muted">Connected sources</dt><dd className="num font-medium">{today.dataQuality.connectedSources}</dd></div>
          <div><dt className="text-muted">Stale sources</dt><dd className="num font-medium">{today.dataQuality.staleSources}</dd></div>
          <div><dt className="text-muted">Observations (30d)</dt><dd className="num font-medium">{today.dataQuality.observations30d.toLocaleString()}</dd></div>
          <div><dt className="text-muted">Cross-source duplicates</dt><dd className="num font-medium">{today.dataQuality.crossSourceDuplicates30d}</dd></div>
          <div><dt className="text-muted">Implausible values</dt><dd className="num font-medium">{today.dataQuality.implausibleValues30d}</dd></div>
        </dl>
        {today.dataQuality.notes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">{today.dataQuality.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </Card>
      <p className="mt-6 text-xs text-muted">{today.disclaimer}</p>
    </>
  );
}
