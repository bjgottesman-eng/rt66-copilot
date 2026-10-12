import type { TrendsResponse } from '@bho/contracts';
import { formatValue } from '@/lib/format';
import { Card, Chip } from './ui';

export function TrendInsights({ t, precision }: { t: TrendsResponse; precision: number }) {
  const sigTone = (d: string | null) => (d === 'unfavourable' ? 'attention' : d === 'favourable' ? 'good' : 'neutral');
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Windows ending {t.asOfDate} (latest complete day)</h2>
        {t.percentile365 !== null && <span className="text-xs text-muted">Current 7-day mean sits at the {t.percentile365.toFixed(0)}th percentile of your trailing 365 days</span>}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm" data-testid="trend-windows">
          <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Window</th><th className="py-1 pr-3">Mean</th><th className="py-1 pr-3">Median</th><th className="py-1 pr-3">SD</th><th className="py-1 pr-3">Min–max</th><th className="py-1 pr-3">Slope/day</th><th className="py-1 pr-3">Coverage</th><th className="py-1 pr-3">Confidence</th></tr></thead>
          <tbody>
            {t.windows.map((w) => (
              <tr key={w.days} className="border-t border-line">
                <td className="py-1.5 pr-3">{w.days} days</td>
                <td className="num py-1.5 pr-3 font-medium">{formatValue(w.stats.mean, t.unit, precision)}</td>
                <td className="num py-1.5 pr-3">{formatValue(w.stats.median, '', precision)}</td>
                <td className="num py-1.5 pr-3">{formatValue(w.stats.sd, '', precision)}</td>
                <td className="num py-1.5 pr-3">{w.stats.min === null ? '—' : `${formatValue(w.stats.min, '', precision)} – ${formatValue(w.stats.max, '', precision)}`}</td>
                <td className="num py-1.5 pr-3">{w.stats.slopePerDay === null ? '—' : w.stats.slopePerDay.toFixed(precision + 2)}</td>
                <td className="num py-1.5 pr-3">{w.stats.daysWithData}/{w.stats.days} ({Math.round(w.stats.coverage * 100)}%)</td>
                <td className="py-1.5 pr-3"><Chip tone={w.confidence === 'HIGH' ? 'good' : w.confidence === 'MEDIUM' ? 'watch' : 'neutral'}>{w.confidence.toLowerCase()}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.comparison && <p className="mt-3 text-xs text-muted">7-day vs preceding 28-day baseline: {t.comparison.explanation}</p>}
      {t.zone && (
        <p className="mt-2 text-xs text-muted">
          {t.zone.maxHeartRate ? `Max heart rate ${t.zone.maxHeartRate} bpm (${t.zone.source === 'profile' ? 'from your profile' : 'Tanaka estimate from birth date'}); Zone 2 = ${t.zone.zone2![0]}–${t.zone.zone2![1]} bpm. Minutes are estimated from heart-rate samples inside each workout.` : 'Set your maximum heart rate or birth date in Settings to estimate Zone 2 minutes.'}
        </p>
      )}
      {t.signals.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-widest text-muted">Signals (deterministic, as of {t.signals[0]!.asOfDate})</p>
          <ul className="mt-2 space-y-2 text-sm">
            {t.signals.slice(0, 8).map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <Chip tone={sigTone(s.direction)}>{s.kind.replace(/_/g, ' ').toLowerCase()}</Chip>
                <span>{s.explanation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
