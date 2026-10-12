'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NutritionTargets } from '@bho/contracts';

const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';
const FIELDS: Array<[keyof NutritionTargets, string]> = [['calories', 'Calories (kcal)'], ['protein_g', 'Protein (g)'], ['carbs_g', 'Carbs (g)'], ['fat_g', 'Fat (g)'], ['fiber_g', 'Fiber (g)'], ['saturated_fat_g_max', 'Saturated fat max (g)'], ['sodium_mg_max', 'Sodium max (mg)'], ['potassium_mg', 'Potassium (mg)']];

export function NutritionSettingsForm({ targets, range }: { targets: NutritionTargets; range: { lowMgDl: number; highMgDl: number; source?: string } }) {
  const router = useRouter();
  const [t, setT] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map(([k]) => [k, targets[k] != null ? String(targets[k]) : ''])));
  const [source, setSource] = useState(targets.source ?? '');
  const [low, setLow] = useState(String(range.lowMgDl));
  const [high, setHigh] = useState(String(range.highMgDl));
  const [rangeSource, setRangeSource] = useState(range.source ?? '');
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const nutritionTargets: Record<string, number | string> = {};
    for (const [k] of FIELDS) if (t[k] && Number(t[k]) > 0) nutritionTargets[k] = Number(t[k]);
    if (source.trim()) nutritionTargets.source = source.trim();
    const glucoseRange = { lowMgDl: Number(low), highMgDl: Number(high), ...(rangeSource.trim() ? { source: rangeSource.trim() } : {}) };
    const res = await fetch('/api/proxy/v1/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nutritionTargets, glucoseRange }) });
    setMsg(res.ok ? 'Saved.' : ((await res.json()).message ?? 'failed'));
    if (res.ok) router.refresh();
  }
  return (
    <form onSubmit={save} className="space-y-3 text-xs">
      <p className="text-muted">Targets and the glucose range are yours or your clinician’s. The app suggests none; without a target a value is shown without judgement.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="text-muted">{label}<input className={input} type="number" min={0} step="any" value={t[k] ?? ''} onChange={(e) => setT({ ...t, [k]: e.target.value })} /></label>
        ))}
      </div>
      <label className="block text-muted">Target source (e.g. “set with dietitian, Sep 2026”)<input className={input} value={source} onChange={(e) => setSource(e.target.value)} maxLength={200} /></label>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-muted">Glucose range low (mg/dL)<input className={input} type="number" min={40} max={200} value={low} onChange={(e) => setLow(e.target.value)} /></label>
        <label className="text-muted">Range high (mg/dL)<input className={input} type="number" min={60} max={400} value={high} onChange={(e) => setHigh(e.target.value)} /></label>
        <label className="text-muted">Range source<input className={input} value={rangeSource} onChange={(e) => setRangeSource(e.target.value)} maxLength={200} /></label>
      </div>
      <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white dark:text-black" data-testid="nutrition-save">Save targets and range</button>
      {msg && <span className="ml-2 text-muted">{msg}</span>}
    </form>
  );
}
