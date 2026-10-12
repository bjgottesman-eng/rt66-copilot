'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CronometerImportResult } from '@bho/contracts';

const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';

export function CronometerImport() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [review, setReview] = useState<CronometerImportResult | null>(null);
  const [result, setResult] = useState<CronometerImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(dryRun: boolean): Promise<CronometerImportResult | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/v1/imports/cronometer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, fileName: fileName ?? undefined, dryRun }) });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? `request failed (${res.status})`);
        return null;
      }
      return body as CronometerImportResult;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setCsv(await f.text());
    setReview(null);
    setResult(null);
  }
  async function doReview() {
    setResult(null);
    setReview(await call(true));
  }
  async function doImport() {
    const r = await call(false);
    setResult(r);
    if (r?.ingest) router.refresh();
  }
  const mapped = review ? Object.entries(review.mapping.metricColumns) : [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Export from Cronometer (Settings → Data → Export) as a daily nutrition summary or a servings/diary CSV. The file is parsed locally on the server, the detected column mapping is shown for review, and nothing is written until you confirm. Re-importing a newer export updates changed days only.</p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} className="block text-xs" data-testid="csv-file" />
      <label className="block text-xs text-muted">
        …or paste CSV text
        <textarea className={`${input} h-28 font-mono text-[11px]`} value={csv} onChange={(e) => { setCsv(e.target.value); setReview(null); setResult(null); }} placeholder={'Day,Group,Food Name,Amount,Energy (kcal),Protein (g),...'} data-testid="csv-text" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button onClick={doReview} disabled={busy || csv.trim() === ''} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-40" data-testid="csv-review">Review mapping</button>
        <button onClick={doImport} disabled={busy || !review || review.mapping.format === 'UNKNOWN' || review.meals === 0} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:text-black" data-testid="csv-import">Import {review && review.meals > 0 ? `${review.meals} meal(s) over ${review.days} day(s)` : ''}</button>
      </div>
      {error && <p className="text-xs text-attention">{error}</p>}
      {review && (
        <div className="rounded-lg border border-line p-3 text-xs" data-testid="csv-mapping">
          <p><span className="font-medium">Layout:</span> {review.mapping.format} · {review.rows} rows · {review.meals} meals · {review.days} days{review.firstDay ? ` (${review.firstDay} → ${review.lastDay})` : ''}</p>
          <p className="mt-1"><span className="font-medium">Day column:</span> {review.mapping.dayColumn ?? '—'}{review.mapping.timeColumn ? ` · time: ${review.mapping.timeColumn}` : ' · no time column (meal times assumed, flagged)'}{review.mapping.groupColumn ? ` · meal group: ${review.mapping.groupColumn}` : ''}{review.mapping.foodColumn ? ` · food: ${review.mapping.foodColumn}` : ''}</p>
          <p className="mt-1"><span className="font-medium">Nutrients:</span> {mapped.length ? mapped.map(([id, h]) => `${h} → ${id}`).join(', ') : 'none recognised'}</p>
          {review.mapping.extraNutrientColumns.length > 0 && <p className="mt-1"><span className="font-medium">Kept as extra nutrients:</span> {review.mapping.extraNutrientColumns.join(', ')}</p>}
          {review.mapping.ignoredColumns.length > 0 && <p className="mt-1 text-muted"><span className="font-medium">Ignored:</span> {review.mapping.ignoredColumns.join(', ')}</p>}
          {review.warnings.length > 0 && <ul className="mt-1 list-disc pl-4 text-watch">{review.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>
      )}
      {result && (
        <div className="rounded-lg border border-line p-3 text-xs" data-testid="csv-result">
          {result.ingest ? (
            <p>Imported: {result.ingest.inserted} inserted, {result.ingest.updated} updated, {result.ingest.unchangedDuplicates} unchanged, {result.ingest.rejected.length} rejected. Health Connect meals linked as duplicates: {result.healthConnectDuplicatesLinked}.</p>
          ) : (
            <p>Nothing imported.{result.warnings.length ? ` ${result.warnings[result.warnings.length - 1]}` : ''}</p>
          )}
        </div>
      )}
    </div>
  );
}
