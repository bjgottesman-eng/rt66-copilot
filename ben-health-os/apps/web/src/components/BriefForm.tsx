'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';

export function BriefForm() {
  const router = useRouter();
  const [f, setF] = useState({ reasonForVisit: '', concerns: '', questions: '', clinicianName: '', includeAppendix: false });
  const [result, setResult] = useState<{ id: string; medications: number; labs: number; conditions: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
    const res = await fetch('/api/proxy/v1/physician-brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reasonForVisit: f.reasonForVisit, concerns: lines(f.concerns), questions: lines(f.questions), clinicianName: f.clinicianName || undefined, includeAppendix: f.includeAppendix }) });
    const body = await res.json();
    if (!res.ok) {
      setMsg(body.message ?? 'failed');
      return;
    }
    const c = body.content as { medications: unknown[]; labs: unknown[]; conditions: unknown[] };
    setResult({ id: body.id, medications: c.medications.length, labs: c.labs.length, conditions: c.conditions.length });
    setMsg(null);
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="space-y-2 text-xs">
      <label className="block text-muted">Reason for visit<input className={input} value={f.reasonForVisit} onChange={(e) => setF({ ...f, reasonForVisit: e.target.value })} required data-testid="brief-reason" /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-muted">Current concerns (one per line)<textarea className={`${input} h-20`} value={f.concerns} onChange={(e) => setF({ ...f, concerns: e.target.value })} /></label>
        <label className="text-muted">Questions for the clinician (one per line)<textarea className={`${input} h-20`} value={f.questions} onChange={(e) => setF({ ...f, questions: e.target.value })} /></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-muted">Clinician name (optional)<input className={input} value={f.clinicianName} onChange={(e) => setF({ ...f, clinicianName: e.target.value })} /></label>
        <label className="flex items-end gap-2 pb-2 text-muted"><input type="checkbox" checked={f.includeAppendix} onChange={(e) => setF({ ...f, includeAppendix: e.target.checked })} /> include a supporting appendix</label>
      </div>
      <button className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white dark:text-black" data-testid="brief-generate">Generate brief (PDF)</button>
      {msg && <span className="ml-2 text-attention">{msg}</span>}
      {result && (
        <p className="rounded-lg border border-line p-3" data-testid="brief-result">
          Brief generated with {result.medications} medication(s), {result.conditions} condition(s) and {result.labs} lab analyte(s). <a className="text-accent underline" href={`/api/proxy/v1/physician-brief/${result.id}/pdf`} target="_blank" rel="noreferrer">Open PDF</a>
        </p>
      )}
    </form>
  );
}
