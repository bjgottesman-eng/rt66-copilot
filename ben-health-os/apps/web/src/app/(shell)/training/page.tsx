import type { CheckInsResponse, TrainingOverview } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { CheckInForm, TrainingSetForm } from '@/components/TrainingForms';

export const dynamic = 'force-dynamic';
const fmt = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits }));
const progTone = (s: string): 'good' | 'watch' | 'attention' | 'neutral' => (s === 'PROGRESSING' ? 'good' : s === 'REGRESSING' ? 'attention' : s === 'MAINTAINING' ? 'neutral' : 'watch');
const changeTone = (c: string, fav: boolean | null): 'good' | 'watch' | 'attention' | 'neutral' => (c === 'INSUFFICIENT_EVIDENCE' || c === 'NOISE' ? 'neutral' : fav === true ? 'good' : fav === false ? 'attention' : 'watch');

export default async function TrainingPage() {
  const t = await apiFetch<TrainingOverview>('/v1/training?days=56');
  const c = await apiFetch<CheckInsResponse>('/v1/checkins');
  const recentWeeks = [...t.summary.weeks].reverse();
  return (
    <>
      <PageHeader title="Training" subtitle={`${t.from} → ${t.to}. Sessions from exercise records, sets and loads from your log; progression compares your last four weeks with the four before.`} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card><p className="text-xs text-muted">Resistance sessions / week</p><p className="num mt-1 text-2xl font-semibold">{fmt(t.summary.sessionsPerWeek)}</p><p className="text-[11px] text-muted">{t.summary.weeksWithoutSession} week(s) without a session</p></Card>
        <Card><p className="text-xs text-muted">Logged volume (last week)</p><p className="num mt-1 text-2xl font-semibold">{fmt(recentWeeks[0]?.volumeKg, 0)} <span className="text-sm">kg</span></p><p className="text-[11px] text-muted">{recentWeeks[0]?.loggedSets ?? 0} sets</p></Card>
        <Card><p className="text-xs text-muted">Zone 2 this week</p><p className="num mt-1 text-2xl font-semibold">{fmt(t.zone2.minutes7d, 0)} <span className="text-sm">min</span></p><p className="text-[11px] text-muted">{t.zone2.note}</p></Card>
        <Card><p className="text-xs text-muted">Recovery context (7-day means)</p><p className="mt-1 text-sm">HRV {fmt(t.recovery.hrv7d, 0)} ms · RHR {fmt(t.recovery.restingHr7d, 0)} bpm · sleep {fmt(t.recovery.sleep7d, 0)} min</p><p className="text-[11px] text-muted">{t.recovery.note}</p></Card>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold">Progression by exercise</h3>
          <ul className="mt-2 divide-y divide-line text-sm" data-testid="progression-list">
            {t.summary.progression.map((p) => (
              <li key={p.exercise} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{p.exercise}</span><Chip tone={progTone(p.status)}>{p.status.toLowerCase().replace(/_/g, ' ')}</Chip></div>
                <p className="text-xs text-muted">Best est. 1RM {fmt(p.bestEstimatedOneRepMaxKg)} kg · last 4 weeks {fmt(p.recentMeanKg)} vs prior {fmt(p.priorMeanKg)} kg{p.deltaPct !== null ? ` (${p.deltaPct > 0 ? '+' : ''}${p.deltaPct}%)` : ''} · {p.sessions.length} session(s)</p>
                <p className="text-[11px] text-muted">{p.note}</p>
              </li>
            ))}
            {t.summary.progression.length === 0 && <li className="py-2 text-xs text-muted">No sets logged yet.</li>}
          </ul>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold">Weeks</h3>
          <table className="mt-2 w-full text-xs">
            <thead className="text-muted"><tr><th className="text-left font-normal">Week of</th><th className="text-right font-normal">Sessions</th><th className="text-right font-normal">Sets</th><th className="text-right font-normal">Volume kg</th><th className="text-right font-normal">Minutes</th></tr></thead>
            <tbody>{recentWeeks.map((w) => <tr key={w.weekStart} className="border-t border-line"><td className="py-1">{w.weekStart}</td><td className="num text-right">{w.sessions}</td><td className="num text-right">{w.loggedSets}</td><td className="num text-right">{fmt(w.volumeKg, 0)}</td><td className="num text-right">{w.minutes}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold">Log sets</h3>
          <div className="mt-2"><TrainingSetForm /></div>
          <h4 className="mt-4 text-xs uppercase tracking-widest text-muted">Recent sets</h4>
          <ul className="mt-1 max-h-64 divide-y divide-line overflow-y-auto text-xs" data-testid="recent-sets">
            {t.recentSets.map((s) => <li key={s.id} className="flex justify-between py-1"><span>{s.localDate} · {s.exercise} · set {s.setIndex}</span><span className="num">{s.reps} × {s.loadKg} kg{s.rpe ? ` @ ${s.rpe}` : ''}</span></li>)}
            {t.recentSets.length === 0 && <li className="py-1 text-muted">Nothing logged in this window.</li>}
          </ul>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold">Sessions (exercise records)</h3>
          <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto text-xs">
            {t.sessions.map((s) => <li key={s.id} className="flex justify-between py-1"><span>{s.localDate} · {s.title ?? 'Resistance'} · {s.source}</span><span className="num">{Math.round(s.durationMin)} min{s.avgHeartRate ? ` · ${Math.round(s.avgHeartRate)} bpm` : ''}</span></li>)}
            {t.sessions.length === 0 && <li className="py-1 text-muted">No resistance sessions recorded in this window.</li>}
          </ul>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-muted">{[...t.summary.notes, ...t.notes].map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Card>
      </div>
      <Card className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">How do I feel? Daily check-in</h3><span className="text-xs text-muted">{c.summary.daysLogged7d} of the last 7 days logged</span></div>
        <div className="mt-2"><CheckInForm /></div>
        <table className="mt-4 w-full text-xs" data-testid="checkin-summary">
          <thead className="text-muted"><tr><th className="text-left font-normal">Dimension</th><th className="text-right font-normal">7-day mean</th><th className="text-right font-normal">28-day mean</th><th className="text-right font-normal">Change</th></tr></thead>
          <tbody>{c.summary.dimensions.map((d) => <tr key={d.dimension} className="border-t border-line"><td className="py-1">{d.label} <span className="text-muted">({d.direction === 'lower_better' ? 'lower is better' : 'higher is better'})</span></td><td className="num text-right">{fmt(d.mean7d)} <span className="text-muted">({d.daysWithData7d}d)</span></td><td className="num text-right">{fmt(d.mean28d)} <span className="text-muted">({d.daysWithData28d}d)</span></td><td className="text-right"><Chip tone={changeTone(d.changeClass, d.favourable)}>{d.changeClass.toLowerCase().replace(/_/g, ' ')}</Chip></td></tr>)}</tbody>
        </table>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-muted">{[...c.summary.notes, ...c.notes].map((n, i) => <li key={i}>{n}</li>)}</ul>
        {c.checkIns.length > 0 && <p className="mt-2 text-[11px] text-muted">Latest: {new Date(c.checkIns[0]!.at).toLocaleString()}{c.checkIns[0]!.note ? ` — ${c.checkIns[0]!.note}` : ''}</p>}
      </Card>
    </>
  );
}
