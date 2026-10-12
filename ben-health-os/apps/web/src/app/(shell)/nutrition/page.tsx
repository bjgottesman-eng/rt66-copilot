import Link from 'next/link';
import type { GlucoseDayResponse, NutritionDaysResponse, NutritionTargets, RepeatedMealsResponse } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { GlucoseDayChart, type ChartPoint } from '@/components/GlucoseDayChart';
import { CronometerImport } from '@/components/CronometerImport';
import { AnnotationForm } from '@/components/AnnotationForm';
import { NutritionSettingsForm } from '@/components/NutritionSettingsForm';

export const dynamic = 'force-dynamic';

const TOTALS: Array<[keyof NutritionDaysResponse['mean7d'], string, string]> = [['calories', 'Calories', 'kcal'], ['protein_g', 'Protein', 'g'], ['carbs_g', 'Carbs', 'g'], ['fat_g', 'Fat', 'g'], ['saturated_fat_g', 'Sat. fat', 'g'], ['fiber_g', 'Fiber', 'g'], ['sodium_mg', 'Sodium', 'mg'], ['potassium_mg', 'Potassium', 'mg']];

function localMinutes(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}
const n = (v: number | null | undefined, digits = 0) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits }));

function targetFor(key: string, targets: NutritionTargets): { value: number; kind: 'min' | 'max' | 'aim' } | null {
  const rec = targets as Record<string, number | string | undefined>;
  const max = rec[`${key}_max`];
  if (typeof max === 'number') return { value: max, kind: 'max' };
  const t = rec[key];
  if (typeof t === 'number') return { value: t, kind: key === 'calories' ? 'aim' : 'min' };
  return null;
}
function judge(mean: number | null, target: { value: number; kind: 'min' | 'max' | 'aim' } | null): { tone: 'good' | 'watch' | 'neutral'; text: string } | null {
  if (mean == null || !target) return null;
  if (target.kind === 'max') return mean <= target.value ? { tone: 'good', text: `within max ${n(target.value)}` } : { tone: 'watch', text: `over max ${n(target.value)}` };
  if (target.kind === 'min') return mean >= target.value ? { tone: 'good', text: `meets target ${n(target.value)}` } : { tone: 'watch', text: `below target ${n(target.value)}` };
  const pct = ((mean - target.value) / target.value) * 100;
  return Math.abs(pct) <= 10 ? { tone: 'good', text: `near target ${n(target.value)}` } : { tone: 'watch', text: `${pct > 0 ? '+' : ''}${pct.toFixed(0)}% vs target ${n(target.value)}` };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="num mt-1 text-xl font-semibold">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

export default async function NutritionPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const dateQuery = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? `?date=${sp.date}` : '';
  const [days, glucose, repeated] = await Promise.all([
    apiFetch<NutritionDaysResponse>('/v1/nutrition/days'),
    apiFetch<GlucoseDayResponse>(`/v1/glucose/day${dateQuery}`),
    apiFetch<RepeatedMealsResponse>('/v1/glucose/repeated-meals?days=28'),
  ]);
  const tz = glucose.timeZone;
  const sorted = glucose.samples.map((s) => ({ minutes: localMinutes(s.t, tz), mgDl: s.mgDl as number | null })).sort((a, b) => a.minutes - b.minutes);
  const points: ChartPoint[] = [];
  sorted.forEach((s, i) => {
    if (i > 0 && s.minutes - sorted[i - 1]!.minutes > 45) points.push({ minutes: sorted[i - 1]!.minutes + 1, mgDl: null });
    points.push(s);
  });
  const mealMarks = glucose.meals.map((m) => ({ minutes: localMinutes(m.at, tz), label: m.label }));
  const workoutMarks = glucose.workouts.map((w) => {
    const start = localMinutes(w.startAt, tz);
    return { start, end: Math.max(localMinutes(w.endAt, tz), start + 5), label: w.label };
  });
  const s = glucose.stats;
  const latestAge = glucose.freshness.latestSampleAt ? (Date.now() - Date.parse(glucose.freshness.latestSampleAt)) / 3_600_000 : null;
  const freshnessTone = latestAge == null ? 'neutral' : latestAge <= glucose.freshness.expectedSourceLatencyHours ? 'good' : latestAge <= 24 ? 'watch' : 'attention';

  return (
    <>
      <PageHeader title="Nutrition and glucose" subtitle="Cronometer day totals against your own targets; Stelo glucose from Health Connect with meal and exercise context. Descriptive only." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Last 7 days</h3>
            <Chip tone={days.daysWithData7d >= 4 ? 'good' : days.daysWithData7d > 0 ? 'watch' : 'neutral'}>{days.daysWithData7d} of 7 days logged</Chip>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="nutrition-means">
            {TOTALS.map(([key, label, unit]) => {
              const mean = days.mean7d[key];
              const j = judge(mean, targetFor(key, days.targets));
              return (
                <div key={key}>
                  <p className="text-xs text-muted">{label}</p>
                  <p className="num mt-1 text-xl font-semibold">{mean == null ? '—' : `${n(mean)} ${unit}`}</p>
                  {j ? <Chip tone={j.tone}>{j.text}</Chip> : <p className="text-[11px] text-muted">{mean == null ? 'no data' : 'no target set'}</p>}
                </div>
              );
            })}
          </div>
          <h3 className="mt-6 text-sm font-semibold">Days ({days.from} → {days.to})</h3>
          <div className="mt-2 overflow-x-auto" data-testid="nutrition-days">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Day</th><th className="py-1 pr-3">kcal</th><th className="py-1 pr-3">Protein</th><th className="py-1 pr-3">Carbs</th><th className="py-1 pr-3">Fat</th><th className="py-1 pr-3">Fiber</th><th className="py-1 pr-3">Sodium</th><th className="py-1 pr-3">Potassium</th><th className="py-1 pr-3">Meals</th><th className="py-1 pr-3">Source</th></tr></thead>
              <tbody>
                {[...days.days].reverse().map((d) => (
                  <tr key={d.date} className="border-t border-line">
                    <td className="num py-1.5 pr-3">{d.date}</td>
                    <td className="num py-1.5 pr-3 font-medium">{n(d.totals.calories)}</td>
                    <td className="num py-1.5 pr-3">{n(d.totals.protein_g)} g</td>
                    <td className="num py-1.5 pr-3">{n(d.totals.carbs_g)} g</td>
                    <td className="num py-1.5 pr-3">{n(d.totals.fat_g)} g</td>
                    <td className="num py-1.5 pr-3">{n(d.totals.fiber_g)} g</td>
                    <td className="num py-1.5 pr-3">{n(d.totals.sodium_mg)} mg</td>
                    <td className="num py-1.5 pr-3">{n(d.totals.potassium_mg)} mg</td>
                    <td className="num py-1.5 pr-3">{d.mealsCount}{d.meals.some((m) => !m.canonical) ? <span className="text-muted" title="Lower-priority meals for this day are linked as duplicates, not summed"> (+{d.meals.filter((m) => !m.canonical).length} linked)</span> : ''}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted">{d.sources.join(', ')}</td>
                  </tr>
                ))}
                {days.days.length === 0 && <tr><td colSpan={10} className="py-3 text-muted">No logged meals in this window. Import a Cronometer CSV or share Cronometer through Health Connect.</td></tr>}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">{days.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Card>
        <div className="space-y-5">
          <Card>
            <h3 className="text-sm font-semibold">Import Cronometer CSV</h3>
            <div className="mt-2"><CronometerImport /></div>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold">Targets and glucose range</h3>
            <div className="mt-2"><NutritionSettingsForm targets={days.targets} range={glucose.range} /></div>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Glucose · {glucose.date} <span className="font-normal text-muted">({tz})</span></h3>
            <p className="mt-0.5 text-xs text-muted">Range {glucose.range.lowMgDl}–{glucose.range.highMgDl} mg/dL · {glucose.range.source ?? 'default placeholder'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Chip tone={freshnessTone}>{glucose.freshness.latestSampleAt ? `latest sample ${relativeTime(glucose.freshness.latestSampleAt)}` : 'no samples yet'}</Chip>
            <span className="text-muted">expected source delay ≤ {glucose.freshness.expectedSourceLatencyHours} h (Stelo)</span>
          </div>
        </div>
        {glucose.datesWithData.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 text-xs" data-testid="glucose-dates">
            {glucose.datesWithData.slice(0, 14).map((d) => (
              <Link key={d} href={`/nutrition?date=${d}`} className={`rounded-md border px-2 py-0.5 ${d === glucose.date ? 'border-accent text-accent' : 'border-line text-muted'}`}>{d.slice(5)}</Link>
            ))}
          </div>
        )}
        <GlucoseDayChart points={points} range={glucose.range} meals={mealMarks} workouts={workoutMarks} />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6" data-testid="glucose-stats">
          <Stat label="Samples" value={String(s.n)} sub={s.n ? `${s.coverageHours.toFixed(1)} h covered${s.intervalMinutes ? ` · every ${n(s.intervalMinutes)} min` : ''}` : 'no data'} />
          <Stat label="Mean" value={s.mean == null ? '—' : `${n(s.mean)} mg/dL`} sub={s.sd == null ? undefined : `SD ${n(s.sd, 1)} · CV ${n(s.cvPct, 1)}%`} />
          <Stat label="Time in range" value={s.timeInRangePct == null ? '—' : `${n(s.timeInRangePct, 1)}%`} sub={s.timeInRangePct == null ? undefined : `below ${n(s.timeBelowPct, 1)}% · above ${n(s.timeAbovePct, 1)}%`} />
          <Stat label="Overnight mean" value={s.overnightMean == null ? '—' : `${n(s.overnightMean)} mg/dL`} sub="00:00–06:00 local" />
          <Stat label="Min / max" value={s.min == null ? '—' : `${n(s.min)} / ${n(s.max)}`} sub="mg/dL" />
          <Stat label="Meals · exercise" value={`${glucose.meals.length} · ${glucose.workouts.length}`} sub="markers on the chart" />
        </div>
        <p className="mt-3 text-xs text-muted">{glucose.freshness.note}</p>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold">Post-meal excursions (2 h)</h4>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Meal</th><th className="py-1 pr-3">Baseline</th><th className="py-1 pr-3">Peak</th><th className="py-1 pr-3">Δ</th><th className="py-1 pr-3">To peak</th><th className="py-1 pr-3">iAUC</th><th className="py-1 pr-3">Confidence</th></tr></thead>
              <tbody>
                {glucose.excursions.map((e, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1.5 pr-3">{e.label} <span className="text-xs text-muted">{new Date(e.mealAt).toLocaleTimeString(undefined, { timeZone: tz, timeStyle: 'short' })}</span></td>
                    <td className="num py-1.5 pr-3">{n(e.baselineMgDl)}</td>
                    <td className="num py-1.5 pr-3">{n(e.peakMgDl)}</td>
                    <td className="num py-1.5 pr-3">{e.peakDeltaMgDl == null ? '—' : `${e.peakDeltaMgDl >= 0 ? '+' : ''}${n(e.peakDeltaMgDl)}`}</td>
                    <td className="num py-1.5 pr-3">{e.minutesToPeak == null ? '—' : `${n(e.minutesToPeak)} min`}</td>
                    <td className="num py-1.5 pr-3">{n(e.iAuc2h)}</td>
                    <td className="py-1.5 pr-3"><Chip tone={e.confidence === 'HIGH' ? 'good' : e.confidence === 'MEDIUM' ? 'watch' : 'neutral'}>{e.confidence.toLowerCase()} · {e.samplesIn2h} samples</Chip></td>
                  </tr>
                ))}
                {glucose.excursions.length === 0 && <tr><td colSpan={7} className="py-2 text-xs text-muted">No meals on this day. Log meals in Cronometer or add a meal annotation.</td></tr>}
              </tbody>
            </table>
            <h4 className="mt-5 text-sm font-semibold">Annotations for {glucose.date}</h4>
            <div className="mt-2"><AnnotationForm date={glucose.date} timeZone={tz} annotations={glucose.annotations} /></div>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Repeated meals ({repeated.from} → {repeated.to})</h4>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Meal label</th><th className="py-1 pr-3">Times</th><th className="py-1 pr-3">Mean Δ peak</th><th className="py-1 pr-3">Mean iAUC</th></tr></thead>
              <tbody>
                {repeated.meals.slice(0, 12).map((m) => (
                  <tr key={m.label} className="border-t border-line">
                    <td className="py-1.5 pr-3">{m.label}</td>
                    <td className="num py-1.5 pr-3">{m.occurrences}</td>
                    <td className="num py-1.5 pr-3">{m.meanPeakDelta == null ? '—' : `+${n(m.meanPeakDelta)} mg/dL`}</td>
                    <td className="num py-1.5 pr-3">{n(m.meanIAuc)}</td>
                  </tr>
                ))}
                {repeated.meals.length === 0 && <tr><td colSpan={4} className="py-2 text-xs text-muted">No meal label repeats with glucose coverage yet.</td></tr>}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">{repeated.note}</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">{glucose.disclaimer}</p>
      </Card>
    </>
  );
}
