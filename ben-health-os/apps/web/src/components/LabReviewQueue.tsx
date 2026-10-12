'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LabResult } from '@bho/contracts';
import { LAB_ANALYTES } from '@bho/shared-config';

const input = 'w-full rounded border border-line bg-surface-2 px-2 py-1 text-xs outline-none focus:border-accent';

export function LabReviewQueue({ pending }: { pending: LabResult[] }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, { analyteId?: string | null; value?: string; unit?: string; collectedAt?: string }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set(pending.map((p) => p.id)));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function edit(id: string, patch: Record<string, string | null>) {
    setEdits({ ...edits, [id]: { ...(edits[id] ?? {}), ...patch } });
  }
  async function decide(action: 'CONFIRM' | 'REJECT') {
    const decisions = pending.filter((p) => selected.has(p.id)).map((p) => {
      const e = edits[p.id] ?? {};
      const corrections: Record<string, unknown> = {};
      if (e.analyteId !== undefined) corrections.analyteId = e.analyteId;
      if (e.value !== undefined && e.value !== '') corrections.value = Number(e.value);
      if (e.unit !== undefined) corrections.unit = e.unit;
      if (e.collectedAt) corrections.collectedAt = e.collectedAt;
      return { id: p.id, action, ...(Object.keys(corrections).length ? { corrections } : {}) };
    });
    if (decisions.length === 0) return;
    setBusy(true);
    const res = await fetch('/api/proxy/v1/labs/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decisions }) });
    const body = await res.json();
    setBusy(false);
    setMsg(res.ok ? `${body.confirmed} confirmed, ${body.rejected} rejected, ${body.duplicatesLinked} linked as duplicates of existing results; ${body.remaining} still pending.` : body.message ?? 'failed');
    router.refresh();
  }
  return (
    <div className="text-xs" data-testid="lab-queue">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => decide('CONFIRM')} disabled={busy || selected.size === 0} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:text-black" data-testid="lab-confirm-selected">Confirm {selected.size} selected</button>
        <button onClick={() => decide('REJECT')} disabled={busy || selected.size === 0} className="rounded-lg border border-attention/40 px-3 py-1.5 text-sm text-attention disabled:opacity-40">Reject selected</button>
        <button onClick={() => setSelected(new Set(pending.map((p) => p.id)))} className="text-muted underline">select all</button>
        <button onClick={() => setSelected(new Set())} className="text-muted underline">none</button>
        {msg && <span className="text-muted">{msg}</span>}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full">
          <thead className="text-left text-muted"><tr><th className="pr-2"></th><th className="pr-2">Reported name</th><th className="pr-2">Analyte</th><th className="pr-2">Value</th><th className="pr-2">Unit</th><th className="pr-2">Range · flag</th><th className="pr-2">Collected</th><th className="pr-2">Source · confidence</th></tr></thead>
          <tbody>
            {pending.map((p) => {
              const e = edits[p.id] ?? {};
              return (
                <tr key={p.id} className="border-t border-line align-top">
                  <td className="py-1 pr-2"><input type="checkbox" checked={selected.has(p.id)} onChange={(ev) => { const n = new Set(selected); if (ev.target.checked) n.add(p.id); else n.delete(p.id); setSelected(n); }} /></td>
                  <td className="py-1 pr-2">{p.analyteRawName}{p.qualityFlags.some((f) => f.startsWith('UNIT_NOT')) && <span className="ml-1 text-watch">unit not convertible</span>}</td>
                  <td className="py-1 pr-2"><select className={input} value={e.analyteId === undefined ? (p.analyteId ?? '') : (e.analyteId ?? '')} onChange={(ev) => edit(p.id, { analyteId: ev.target.value || null })}><option value="">unmapped (keep name)</option>{LAB_ANALYTES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td>
                  <td className="py-1 pr-2"><input className={`${input} w-20`} value={e.value ?? (p.value ?? p.valueText ?? '')} onChange={(ev) => edit(p.id, { value: ev.target.value })} /></td>
                  <td className="py-1 pr-2"><input className={`${input} w-20`} value={e.unit ?? (p.unit ?? '')} onChange={(ev) => edit(p.id, { unit: ev.target.value })} /></td>
                  <td className="py-1 pr-2">{p.referenceText ?? '—'}{p.abnormalFlag ? ` · ${p.abnormalFlag}` : ''}</td>
                  <td className="py-1 pr-2"><input className={`${input} w-32`} type="date" value={e.collectedAt ?? (p.collectedAt ? p.collectedAt.slice(0, 10) : '')} onChange={(ev) => edit(p.id, { collectedAt: ev.target.value })} /></td>
                  <td className="py-1 pr-2 text-muted">{p.source}{p.extractionConfidence != null ? ` · ${Math.round(p.extractionConfidence * 100)}%` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
