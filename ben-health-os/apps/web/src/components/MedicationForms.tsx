'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MedicationsResponse } from '@bho/contracts';

const input = 'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent';
const MED_STATUSES = ['CURRENT', 'AS_NEEDED', 'HISTORICAL', 'UNCERTAIN', 'DUPLICATE'];

async function send(path: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string; id?: string }> {
  const res = await fetch(`/api/proxy${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return { ok: true };
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, message: json.message, id: json.id };
}

export function MedicationForms({ data }: { data: MedicationsResponse }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [med, setMed] = useState({ name: '', dosage: '', route: '', frequency: '', prescribingClinician: '', startDate: '', indication: '', status: 'CURRENT', refillDate: '' });
  const [supp, setSupp] = useState({ name: '', brand: '', dose: '', frequency: '', purpose: '', monthlyCost: '' });
  const [allergy, setAllergy] = useState({ substance: '', reaction: '', severity: 'UNKNOWN' });
  const [condition, setCondition] = useState({ name: '', status: 'ACTIVE', onsetDate: '' });
  const [linkTarget, setLinkTarget] = useState<Record<string, string>>({});
  const done = (r: { ok: boolean; message?: string }, okText: string) => {
    setMsg(r.ok ? okText : (r.message ?? 'failed'));
    if (r.ok) router.refresh();
  };
  const nul = (v: string) => (v.trim() ? v.trim() : null);
  return (
    <div className="space-y-5 text-xs">
      {msg && <p className="rounded-lg border border-line px-3 py-2 text-sm">{msg}</p>}
      {data.unreconciled.length > 0 && (
        <div className="rounded-lg border border-watch/40 p-3" data-testid="med-reconcile">
          <p className="text-sm font-semibold">Records waiting for reconciliation ({data.unreconciled.length})</p>
          <p className="mt-1 text-muted">Each record comes from a clinical system or document. Link it to a medication you already track, create a medication from it, or ignore it. Your decisions are logged.</p>
          <ul className="mt-2 space-y-2">
            {data.unreconciled.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                <span className="font-medium">{r.name ?? 'Unnamed'}</span><span className="text-muted">{r.source}{r.recordedAt ? ` · ${r.recordedAt.slice(0, 10)}` : ''}{typeof r.raw.dosageText === 'string' ? ` · ${r.raw.dosageText}` : ''}</span>
                <button className="rounded-lg bg-accent px-2 py-1 text-white dark:text-black" onClick={async () => done(await send('/v1/medications/reconcile', 'POST', { decisions: [{ sourceRecordId: r.id, action: 'CREATE' }] }), 'Medication created from the record.')}>create medication</button>
                {data.medications.length > 0 && (
                  <>
                    <select className="rounded border border-line bg-surface-2 px-2 py-1" value={linkTarget[r.id] ?? ''} onChange={(e) => setLinkTarget({ ...linkTarget, [r.id]: e.target.value })}><option value="">link to…</option>{data.medications.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                    <button className="rounded-lg border border-line px-2 py-1" disabled={!linkTarget[r.id]} onClick={async () => done(await send('/v1/medications/reconcile', 'POST', { decisions: [{ sourceRecordId: r.id, action: 'LINK', medicationId: linkTarget[r.id] }] }), 'Record linked.')}>link</button>
                  </>
                )}
                <button className="rounded-lg border border-line px-2 py-1 text-muted" onClick={async () => done(await send('/v1/medications/reconcile', 'POST', { decisions: [{ sourceRecordId: r.id, action: 'IGNORE' }] }), 'Record ignored.')}>ignore</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form className="grid grid-cols-2 gap-2 sm:grid-cols-5" onSubmit={async (e) => { e.preventDefault(); done(await send('/v1/medications', 'POST', { name: med.name, dosage: nul(med.dosage), route: nul(med.route), frequency: nul(med.frequency), prescribingClinician: nul(med.prescribingClinician), startDate: nul(med.startDate), indication: nul(med.indication), status: med.status, refillDate: nul(med.refillDate) }), `Added ${med.name}.`); setMed({ ...med, name: '' }); }}>
        <p className="col-span-2 text-sm font-semibold sm:col-span-5">Add a medication</p>
        <label className="text-muted">Name<input className={input} value={med.name} onChange={(e) => setMed({ ...med, name: e.target.value })} required data-testid="med-name" /></label>
        <label className="text-muted">Dosage<input className={input} value={med.dosage} onChange={(e) => setMed({ ...med, dosage: e.target.value })} placeholder="10 mg" /></label>
        <label className="text-muted">Frequency<input className={input} value={med.frequency} onChange={(e) => setMed({ ...med, frequency: e.target.value })} placeholder="daily" /></label>
        <label className="text-muted">Route<input className={input} value={med.route} onChange={(e) => setMed({ ...med, route: e.target.value })} placeholder="oral" /></label>
        <label className="text-muted">Status<select className={input} value={med.status} onChange={(e) => setMed({ ...med, status: e.target.value })}>{MED_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase().replace('_', ' ')}</option>)}</select></label>
        <label className="text-muted">Prescribing clinician<input className={input} value={med.prescribingClinician} onChange={(e) => setMed({ ...med, prescribingClinician: e.target.value })} /></label>
        <label className="text-muted">Indication<input className={input} value={med.indication} onChange={(e) => setMed({ ...med, indication: e.target.value })} /></label>
        <label className="text-muted">Start date<input className={input} type="date" value={med.startDate} onChange={(e) => setMed({ ...med, startDate: e.target.value })} /></label>
        <label className="text-muted">Refill date<input className={input} type="date" value={med.refillDate} onChange={(e) => setMed({ ...med, refillDate: e.target.value })} /></label>
        <div className="flex items-end"><button className="rounded-lg border border-line px-3 py-2 text-sm" data-testid="med-save">Add medication</button></div>
      </form>
      <form className="grid grid-cols-2 gap-2 sm:grid-cols-6" onSubmit={async (e) => { e.preventDefault(); done(await send('/v1/supplements', 'POST', { name: supp.name, brand: nul(supp.brand), dose: nul(supp.dose), frequency: nul(supp.frequency), purpose: nul(supp.purpose), monthlyCostCents: supp.monthlyCost ? Math.round(Number(supp.monthlyCost) * 100) : null }), `Added ${supp.name}.`); setSupp({ ...supp, name: '' }); }}>
        <p className="col-span-2 text-sm font-semibold sm:col-span-6">Add a supplement</p>
        <label className="text-muted">Name<input className={input} value={supp.name} onChange={(e) => setSupp({ ...supp, name: e.target.value })} required /></label>
        <label className="text-muted">Brand<input className={input} value={supp.brand} onChange={(e) => setSupp({ ...supp, brand: e.target.value })} /></label>
        <label className="text-muted">Dose<input className={input} value={supp.dose} onChange={(e) => setSupp({ ...supp, dose: e.target.value })} /></label>
        <label className="text-muted">Frequency<input className={input} value={supp.frequency} onChange={(e) => setSupp({ ...supp, frequency: e.target.value })} /></label>
        <label className="text-muted">Purpose<input className={input} value={supp.purpose} onChange={(e) => setSupp({ ...supp, purpose: e.target.value })} /></label>
        <label className="text-muted">Monthly cost ($)<input className={input} type="number" step="0.01" value={supp.monthlyCost} onChange={(e) => setSupp({ ...supp, monthlyCost: e.target.value })} /></label>
        <div className="col-span-2 sm:col-span-6"><button className="rounded-lg border border-line px-3 py-2 text-sm">Add supplement</button></div>
      </form>
      <div className="grid gap-3 sm:grid-cols-2">
        <form className="grid grid-cols-3 gap-2" onSubmit={async (e) => { e.preventDefault(); done(await send('/v1/allergies', 'POST', { substance: allergy.substance, reaction: nul(allergy.reaction), severity: allergy.severity }), `Added allergy to ${allergy.substance}.`); setAllergy({ ...allergy, substance: '' }); }}>
          <p className="col-span-3 text-sm font-semibold">Add an allergy</p>
          <label className="text-muted">Substance<input className={input} value={allergy.substance} onChange={(e) => setAllergy({ ...allergy, substance: e.target.value })} required /></label>
          <label className="text-muted">Reaction<input className={input} value={allergy.reaction} onChange={(e) => setAllergy({ ...allergy, reaction: e.target.value })} /></label>
          <label className="text-muted">Severity<select className={input} value={allergy.severity} onChange={(e) => setAllergy({ ...allergy, severity: e.target.value })}>{['UNKNOWN', 'MILD', 'MODERATE', 'SEVERE'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select></label>
          <div className="col-span-3"><button className="rounded-lg border border-line px-3 py-2 text-sm">Add allergy</button></div>
        </form>
        <form className="grid grid-cols-3 gap-2" onSubmit={async (e) => { e.preventDefault(); done(await send('/v1/clinical/conditions', 'POST', { name: condition.name, status: condition.status, onsetDate: nul(condition.onsetDate) }), `Added condition ${condition.name}.`); setCondition({ ...condition, name: '' }); }}>
          <p className="col-span-3 text-sm font-semibold">Add a condition (as told by your clinician)</p>
          <label className="text-muted">Name<input className={input} value={condition.name} onChange={(e) => setCondition({ ...condition, name: e.target.value })} required /></label>
          <label className="text-muted">Status<select className={input} value={condition.status} onChange={(e) => setCondition({ ...condition, status: e.target.value })}>{['ACTIVE', 'RESOLVED', 'HISTORICAL', 'UNCERTAIN'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select></label>
          <label className="text-muted">Onset<input className={input} type="date" value={condition.onsetDate} onChange={(e) => setCondition({ ...condition, onsetDate: e.target.value })} /></label>
          <div className="col-span-3"><button className="rounded-lg border border-line px-3 py-2 text-sm">Add condition</button></div>
        </form>
      </div>
    </div>
  );
}

export function RowActions({ path, label, statuses, current }: { path: string; label: string; statuses?: string[]; current?: string }) {
  const router = useRouter();
  return (
    <span className="flex items-center gap-2 text-xs">
      {statuses && (
        <select className="rounded border border-line bg-surface-2 px-1 py-0.5" value={current} onChange={async (e) => { await fetch(`/api/proxy${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: e.target.value }) }); router.refresh(); }}>
          {statuses.map((s) => <option key={s} value={s}>{s.toLowerCase().replace('_', ' ')}</option>)}
        </select>
      )}
      <button className="text-muted hover:text-attention" onClick={async () => { if (!confirm(`Remove ${label}?`)) return; await fetch(`/api/proxy${path}`, { method: 'DELETE' }); router.refresh(); }}>remove</button>
    </span>
  );
}
