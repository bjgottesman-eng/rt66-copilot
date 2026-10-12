'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';

export function ManualLabForm() {
  const router = useRouter();
  const [s, setS] = useState({ analyteRawName: '', value: '', unit: '', referenceLow: '', referenceHigh: '', abnormalFlag: '', collectedAt: '', laboratory: '' });
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { analyteRawName: s.analyteRawName, value: s.value ? Number(s.value) : null, unit: s.unit || undefined, referenceLow: s.referenceLow ? Number(s.referenceLow) : null, referenceHigh: s.referenceHigh ? Number(s.referenceHigh) : null, abnormalFlag: s.abnormalFlag || null, collectedAt: s.collectedAt, laboratory: s.laboratory || undefined, clientEntryId: `web-${crypto.randomUUID()}` };
    const res = await fetch('/api/proxy/v1/labs/results', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    setMsg(res.ok ? `Saved ${body.analyteRawName}${body.canonical ? '' : ' (linked as a duplicate of an existing result)'}.` : body.message ?? 'failed');
    if (res.ok) router.refresh();
  }
  const f = (k: keyof typeof s, label: string, type = 'text', placeholder = '') => <label className="text-xs text-muted">{label}<input className={input} type={type} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} placeholder={placeholder} required={k === 'analyteRawName' || k === 'collectedAt'} /></label>;
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {f('analyteRawName', 'Test name', 'text', 'Apolipoprotein B')}
      {f('value', 'Value', 'number')}
      {f('unit', 'Unit', 'text', 'mg/dL')}
      {f('collectedAt', 'Collected', 'date')}
      {f('referenceLow', 'Ref low', 'number')}
      {f('referenceHigh', 'Ref high', 'number')}
      {f('abnormalFlag', 'Flag (as reported)', 'text', 'H / L')}
      {f('laboratory', 'Laboratory')}
      <div className="col-span-2 flex items-center gap-2 sm:col-span-4"><button className="rounded-lg border border-line px-3 py-1.5 text-sm" data-testid="manual-lab-save">Add result</button>{msg && <span className="text-xs text-muted">{msg}</span>}</div>
    </form>
  );
}
