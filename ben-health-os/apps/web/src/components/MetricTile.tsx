import type { MetricCard } from '@bho/contracts';
import { metricById } from '@bho/shared-config';
import Link from 'next/link';
import { changeTone, formatDelta, formatValue, freshnessLabel, freshnessTone, relativeTime } from '@/lib/format';
import { Chip, Sparkline } from './ui';

export function MetricTile({ card }: { card: MetricCard }) {
  const def = metricById(card.metricId);
  const precision = def?.precision ?? 1;
  const cmp = card.comparison;
  const tone = changeTone(cmp?.changeClass, cmp?.delta ?? null, def?.direction ?? 'neutral');
  const latestLabel = card.latest
    ? card.metricId === 'blood_pressure_systolic' && card.latest.companions
      ? `${formatValue(card.latest.value, '', 0)}/${formatValue(card.latest.companions.blood_pressure_diastolic ?? null, '', 0)} mmHg`
      : formatValue(card.latest.value, card.unit, precision)
    : '—';
  const href = card.metricId === 'blood_pressure_systolic' ? '/trends/blood-pressure' : `/trends?metric=${card.metricId}`;
  return (
    <Link href={href} className="block rounded-xl border border-line bg-surface-2/60 p-4 transition-colors hover:border-accent/50" data-testid={`metric-${card.metricId}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">{card.label}</p>
          <p className="num mt-1 text-xl font-semibold tracking-tight">{latestLabel}</p>
        </div>
        <Sparkline points={card.sparkline} tone={tone} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Chip tone={freshnessTone(card.freshness.status)} title={card.freshness.reason}>
          {freshnessLabel(card.freshness.status)}
        </Chip>
        {cmp && cmp.changeClass !== 'INSUFFICIENT_EVIDENCE' && (
          <span className={`num text-xs ${tone === 'good' ? 'text-good' : tone === 'attention' ? 'text-attention' : tone === 'watch' ? 'text-watch' : 'text-muted'}`} title={cmp.explanation}>
            {formatDelta(cmp.delta, card.unit === 'score' ? '' : card.unit)} vs 28d · {cmp.changeClass.toLowerCase()}
          </span>
        )}
        {cmp && cmp.changeClass === 'INSUFFICIENT_EVIDENCE' && <span className="text-xs text-muted">insufficient evidence</span>}
      </div>
      <p className="mt-2 truncate text-[11px] text-muted" title={card.freshness.reason}>
        {card.latest ? `${relativeTime(card.latest.measuredAt)} · ${card.latest.sourceLabel}` : card.freshness.reason}
      </p>
    </Link>
  );
}
