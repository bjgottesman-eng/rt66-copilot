'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LabImportResult } from '@bho/contracts';

const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';

export function LabImportForm() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [source, setSource] = useState<'function_health' | 'file_import'>('function_health');
  const [laboratory, setLaboratory] = useState('');
  const [collectedAt, setCollectedAt] = useState('');
  const [review, setReview] = useState<LabImportResult | null>(null);
  const [result, setResult] = useState<LabImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setReview(null);
    setResult(null);
    if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      setPdfBase64(btoa(bin));
      setCsv('');
    } else {
      setPdfBase64(null);
      setCsv(await f.text());
    }
  }
  async function call(dryRun: boolean): Promise<LabImportResult | null> {
    setBusy(true);
    setError(null);
    try {
      const body = { ...(pdfBase64 ? { pdfBase64 } : { csv }), fileName: fileName ?? undefined, source, laboratory: laboratory || undefined, collectedAt: collectedAt || undefined, dryRun };
      const res = await fetch('/api/proxy/v1/imports/labs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) {
        setError(json.message ?? `request failed (${res.status})`);
        return null;
      }
      return json as LabImportResult;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const ready = pdfBase64 !== null || csv.trim() !== '';
  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted">Function Health results download as a PDF; other labs may export CSV. Only the PDF text layer is read (no OCR). Every extracted row is staged for your review before it counts; nothing is inferred from a scanned image.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-muted">Source<select className={input} value={source} onChange={(e) => setSource(e.target.value as 'function_health' | 'file_import')}><option value="function_health">Function Health export</option><option value="file_import">Other lab file</option></select></label>
        <label className="text-muted">Laboratory (if the file lacks it)<input className={input} value={laboratory} onChange={(e) => setLaboratory(e.target.value)} placeholder="Quest Diagnostics" /></label>
        <label className="text-muted">Collection date (if the file lacks it)<input className={input} type="date" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} /></label>
        <label className="text-muted">File (.pdf or .csv)<input type="file" accept=".pdf,.csv,application/pdf,text/csv" onChange={onFile} className="mt-2 block text-xs" data-testid="lab-file" /></label>
      </div>
      <label className="block text-muted">…or paste CSV text<textarea className={`${input} h-24 font-mono text-[11px]`} value={csv} onChange={(e) => { setCsv(e.target.value); setPdfBase64(null); setReview(null); setResult(null); }} placeholder="Test,Value,Unit,Reference Range,Flag,Collected" data-testid="lab-csv-text" /></label>
      <div className="flex flex-wrap gap-2">
        <button onClick={async () => { setResult(null); setReview(await call(true)); }} disabled={busy || !ready} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-40" data-testid="lab-review">Review extraction</button>
        <button onClick={async () => { const r = await call(false); setResult(r); if (r?.staged) router.refresh(); }} disabled={busy || !review || review.rows === 0} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:text-black" data-testid="lab-import">Stage {review?.rows ?? ''} row(s) for review</button>
      </div>
      {error && <p className="text-attention">{error}</p>}
      {review && (
        <div className="rounded-lg border border-line p-3" data-testid="lab-mapping">
          <p><span className="font-medium">{review.format === 'CSV' ? 'CSV' : 'PDF text layer'}</span> · {review.rows} result rows{review.pageCount ? ` · ${review.pageCount} page(s)` : ''} · collected {review.collectedAt ?? 'unknown'} · {review.laboratory ?? 'laboratory unknown'}</p>
          {review.warnings.length > 0 && <ul className="mt-1 list-disc pl-4 text-watch">{review.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {review.preview.length > 0 && (
            <table className="mt-2 w-full">
              <thead className="text-left text-muted"><tr><th className="pr-2">Reported name</th><th className="pr-2">Mapped</th><th className="pr-2">Value</th><th className="pr-2">Canonical</th><th className="pr-2">Range</th><th className="pr-2">Flag</th><th className="pr-2">Conf.</th></tr></thead>
              <tbody>
                {review.preview.slice(0, 25).map((p, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1 pr-2">{p.analyteRawName}</td>
                    <td className="py-1 pr-2">{p.analyteId ?? <span className="text-muted">unmapped</span>}</td>
                    <td className="num py-1 pr-2">{p.valueText ?? p.value} {p.unit ?? ''}</td>
                    <td className="num py-1 pr-2">{p.canonicalValue != null ? `${p.canonicalValue} ${p.canonicalUnit}` : p.flags.find((f) => f.startsWith('UNIT_NOT')) ? 'not convertible' : '—'}</td>
                    <td className="py-1 pr-2">{p.referenceText ?? '—'}</td>
                    <td className="py-1 pr-2">{p.abnormalFlag ?? ''}</td>
                    <td className="num py-1 pr-2">{Math.round(p.extractionConfidence * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {result && <p className="rounded-lg border border-line p-3" data-testid="lab-import-result">{result.staged} row(s) staged for review, {result.unchanged} unchanged (already decided). Confirm them below so they count.</p>}
    </div>
  );
}
