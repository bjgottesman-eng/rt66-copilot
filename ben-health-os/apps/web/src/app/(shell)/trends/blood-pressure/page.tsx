import type { BloodPressureSummary } from '@bho/contracts';
import { apiFetch } from '@/lib/api';
import { Card, Chip, PageHeader } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { ManualBpForm } from '@/components/ManualBpForm';

export const dynamic = 'force-dynamic';

function Avg({ label, v }: { label: string; v: { systolic: number; diastolic: number; pulse?: number | null; n: number } | null }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="num mt-1 text-xl font-semibold">{v ? `${v.systolic.toFixed(0)}/${v.diastolic.toFixed(0)}` : '—'}</p>
      <p className="text-[11px] text-muted">{v ? `${v.pulse != null ? `${v.pulse.toFixed(0)} bpm · ` : ''}${v.n} reading${v.n === 1 ? '' : 's'}` : 'no readings'}</p>
    </div>
  );
}

export default async function BloodPressurePage() {
  const s = await apiFetch<BloodPressureSummary>('/v1/blood-pressure/summary?days=30');
  return (
    <>
      <PageHeader title="Blood pressure" subtitle="Primary source: Withings cuff → Withings cloud → backend. Manual entry is optional." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted">Latest</p>
              <p className="num mt-1 text-2xl font-semibold" data-testid="bp-latest">{s.latest ? `${s.latest.systolic.toFixed(0)}/${s.latest.diastolic.toFixed(0)}` : '—'}</p>
              <p className="text-[11px] text-muted">{s.latest ? `${s.latest.pulse != null ? `${s.latest.pulse.toFixed(0)} bpm · ` : ''}${relativeTime(s.latest.measuredAt)} · ${s.latest.deviceLabel ?? s.latest.connector}` : 'no reading yet'}</p>
            </div>
            <Avg label="7-day average" v={s.avg7d} />
            <Avg label="30-day average" v={s.avg30d} />
            <div>
              <p className="text-xs text-muted">Morning / evening (30d)</p>
              <p className="num mt-1 text-xl font-semibold">{s.morning ? `${s.morning.systolic.toFixed(0)}/${s.morning.diastolic.toFixed(0)}` : '—'} <span className="text-muted">/</span> {s.evening ? `${s.evening.systolic.toFixed(0)}/${s.evening.diastolic.toFixed(0)}` : '—'}</p>
              <p className="text-[11px] text-muted">{s.morning?.n ?? 0} morning · {s.evening?.n ?? 0} evening</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Chip tone={s.targets.clinicianConfigured ? 'good' : 'neutral'}>{s.targets.clinicianConfigured ? 'clinician target' : 'default target'}</Chip>
            <span>Target below {s.targets.systolicMax}/{s.targets.diastolicMax} mmHg — {s.targets.source}</span>
            <span>· Last sync {relativeTime(s.lastSyncAt)}</span>
          </div>
          <h3 className="mt-6 text-sm font-semibold">Sessions (readings within 30 minutes, averaged transparently)</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Started</th><th className="py-1 pr-3">Average</th><th className="py-1 pr-3">Pulse</th><th className="py-1 pr-3">Rule</th></tr></thead>
              <tbody>
                {s.sessions.slice(0, 20).map((x, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="num py-1.5 pr-3">{new Date(x.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="num py-1.5 pr-3 font-medium">{x.systolic.toFixed(0)}/{x.diastolic.toFixed(0)}</td>
                    <td className="num py-1.5 pr-3">{x.pulse != null ? x.pulse.toFixed(0) : '—'}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted">{x.rule}</td>
                  </tr>
                ))}
                {s.sessions.length === 0 && <tr><td colSpan={4} className="py-3 text-muted">No readings in the last 30 days.</td></tr>}
              </tbody>
            </table>
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted">{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold">Manual entry (optional)</h3>
          <p className="mt-1 text-xs text-muted">Use only when the cuff cannot sync. Readings are deduplicated against cuff data automatically.</p>
          <ManualBpForm />
        </Card>
      </div>
      <Card className="mt-5">
        <h3 className="text-sm font-semibold">Recent readings</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Measured</th><th className="py-1 pr-3">Sys/Dia</th><th className="py-1 pr-3">Pulse</th><th className="py-1 pr-3">Source</th><th className="py-1 pr-3">Status</th></tr></thead>
            <tbody>
              {s.readings.slice(0, 40).map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="num py-1.5 pr-3">{new Date(r.measuredAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="num py-1.5 pr-3 font-medium">{r.systolic.toFixed(0)}/{r.diastolic.toFixed(0)}</td>
                  <td className="num py-1.5 pr-3">{r.pulse != null ? r.pulse.toFixed(0) : '—'}</td>
                  <td className="py-1.5 pr-3 text-xs">{r.deviceLabel ?? r.connector}{r.arm !== 'UNKNOWN' ? ` · ${r.arm.toLowerCase()} arm` : ''}{r.posture !== 'UNKNOWN' ? ` · ${r.posture.toLowerCase()}` : ''}</td>
                  <td className="py-1.5 pr-3">{r.canonical ? <Chip tone="good">canonical</Chip> : <Chip tone="neutral">duplicate</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
