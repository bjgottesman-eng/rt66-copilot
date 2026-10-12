import type { ClinicalRecordsResponse, MedicationsResponse } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { MedicationForms, RowActions } from '@/components/MedicationForms';

export const dynamic = 'force-dynamic';
const tone = (s: string): 'good' | 'watch' | 'attention' | 'neutral' => (s === 'CURRENT' || s === 'ACTIVE' ? 'good' : s === 'UNCERTAIN' || s === 'AS_NEEDED' ? 'watch' : 'neutral');

export default async function MedicationsPage() {
  const [meds, records] = await Promise.all([apiFetch<MedicationsResponse>('/v1/medications'), apiFetch<ClinicalRecordsResponse>('/v1/clinical/records')]);
  return (
    <>
      <PageHeader title="Medications" subtitle="Medication reconciliation, supplement ledger, allergies and conditions. The app records and reconciles; it never changes a medication." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Medications</h3><Chip tone="neutral">{meds.medications.length}</Chip></div>
          <ul className="mt-2 space-y-2 text-sm" data-testid="med-list">
            {meds.medications.map((m) => (
              <li key={m.id} className="border-t border-line pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{m.name} <span className="text-xs text-muted">{[m.dosage, m.frequency, m.route].filter(Boolean).join(' · ')}</span></span>
                  <span className="flex items-center gap-2"><Chip tone={tone(m.status)}>{m.status.toLowerCase().replace('_', ' ')}</Chip><RowActions path={`/v1/medications/${m.id}`} label={m.name} statuses={['CURRENT', 'AS_NEEDED', 'HISTORICAL', 'UNCERTAIN', 'DUPLICATE']} current={m.status} /></span>
                </div>
                <p className="text-xs text-muted">{[m.prescribingClinician ? `by ${m.prescribingClinician}` : null, m.indication ? `for ${m.indication}` : null, m.startDate ? `since ${m.startDate}` : null, m.refillDate ? `refill ${m.refillDate}` : null, `source ${m.source}`, m.sourceRecords.length ? `${m.sourceRecords.length} linked record(s)` : null].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
            {meds.medications.length === 0 && <li className="text-xs text-muted">No medications recorded.</li>}
          </ul>
          <h3 className="mt-5 text-sm font-semibold">Supplements</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {meds.supplements.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-1">
                <span>{s.name} <span className="text-xs text-muted">{[s.brand, s.dose, s.frequency, s.purpose, s.monthlyCostCents != null ? `$${(s.monthlyCostCents / 100).toFixed(2)}/mo` : null].filter(Boolean).join(' · ')}</span></span>
                <span className="flex items-center gap-2"><Chip tone={tone(s.status)}>{s.status.toLowerCase().replace('_', ' ')}</Chip><RowActions path={`/v1/supplements/${s.id}`} label={s.name} statuses={['CURRENT', 'AS_NEEDED', 'HISTORICAL', 'UNCERTAIN']} current={s.status} /></span>
              </li>
            ))}
            {meds.supplements.length === 0 && <li className="text-xs text-muted">No supplements recorded.</li>}
          </ul>
          <div className="mt-4 rounded-lg border border-line p-3 text-xs">
            <div className="flex items-center gap-2"><span className="font-semibold">Interactions</span><Chip tone="neutral">{meds.interactionsCheck.status.replace(/_/g, ' ').toLowerCase()}</Chip></div>
            <p className="mt-1 text-muted">{meds.interactionsCheck.note}</p>
          </div>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold">Allergies</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {meds.allergies.map((a) => <li key={a.id} className="flex items-center justify-between border-t border-line pt-1"><span>{a.substance} <span className="text-xs text-muted">{[a.reaction, a.severity.toLowerCase(), a.source].filter(Boolean).join(' · ')}</span></span><RowActions path={`/v1/allergies/${a.id}`} label={a.substance} /></li>)}
            {meds.allergies.length === 0 && <li className="text-xs text-muted">No allergies recorded.</li>}
          </ul>
          <h3 className="mt-5 text-sm font-semibold">Conditions</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {records.conditions.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-1"><span>{c.name} <span className="text-xs text-muted">{[c.code, c.onsetDate ? `since ${c.onsetDate}` : null, c.source.toLowerCase(), c.verificationStatus.toLowerCase()].filter(Boolean).join(' · ')}</span></span><span className="flex items-center gap-2"><Chip tone={tone(c.status)}>{c.status.toLowerCase()}</Chip><RowActions path={`/v1/clinical/conditions/${c.id}`} label={c.name} statuses={['ACTIVE', 'RESOLVED', 'HISTORICAL', 'UNCERTAIN']} current={c.status} /></span></li>)}
            {records.conditions.length === 0 && <li className="text-xs text-muted">No conditions recorded.</li>}
          </ul>
          <h3 className="mt-5 text-sm font-semibold">Clinical events</h3>
          <ul className="mt-2 space-y-1 text-xs">
            {records.events.slice(0, 20).map((e) => <li key={e.id} className="border-t border-line pt-1">{e.occurredAt.slice(0, 10)} · {e.kind.toLowerCase()} · {e.title}{e.provider ? ` · ${e.provider}` : ''}</li>)}
            {records.events.length === 0 && <li className="text-muted">No clinical events imported. Connect clinical records in Data Sources.</li>}
          </ul>
          {meds.reconciliations.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold">Reconciliation log</h3>
              <ul className="mt-2 space-y-1 text-xs text-muted">{meds.reconciliations.map((r) => <li key={r.id}>{r.performedAt.slice(0, 16).replace('T', ' ')} · {r.performedBy.toLowerCase()} · {r.decisions.length} decision(s){r.summary ? ` · ${r.summary}` : ''}</li>)}</ul>
            </>
          )}
        </Card>
      </div>
      <Card className="mt-5">
        <MedicationForms data={meds} />
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted">{[...meds.notes, ...records.notes].map((x, i) => <li key={i}>{x}</li>)}</ul>
      </Card>
    </>
  );
}
