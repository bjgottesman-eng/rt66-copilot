import type { FreshnessStatus } from '@bho/contracts';

export function formatValue(value: number | null | undefined, unit: string, precision?: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const p = precision ?? (Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2);
  const s = value.toLocaleString(undefined, { maximumFractionDigits: p, minimumFractionDigits: 0 });
  return unit === '%' ? `${s}%` : unit ? `${s} ${unit}` : s;
}

export function formatDelta(delta: number | null, unit: string): string {
  if (delta === null) return '';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${formatValue(delta, unit)}`;
}

export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'never';
  const ms = now.getTime() - new Date(iso).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function freshnessTone(status: FreshnessStatus): 'good' | 'watch' | 'attention' | 'neutral' {
  switch (status) {
    case 'CURRENT':
      return 'good';
    case 'RECENT':
    case 'SOURCE_DELAYED':
      return 'watch';
    case 'STALE':
    case 'SYNC_ERROR':
      return 'attention';
    default:
      return 'neutral';
  }
}

export function freshnessLabel(status: FreshnessStatus): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function domainTone(status: string): 'good' | 'watch' | 'attention' | 'neutral' {
  if (status === 'IMPROVING' || status === 'STEADY') return 'good';
  if (status === 'WATCH') return 'watch';
  if (status === 'ATTENTION') return 'attention';
  return 'neutral';
}

export function changeTone(changeClass: string | undefined, delta: number | null, direction: string): 'good' | 'watch' | 'attention' | 'neutral' {
  if (!changeClass || delta === null || changeClass === 'INSUFFICIENT_EVIDENCE' || changeClass === 'NOISE') return 'neutral';
  if (direction === 'neutral' || direction === 'target_range') return 'watch';
  const favourable = direction === 'higher_better' ? delta > 0 : delta < 0;
  if (changeClass === 'MEANINGFUL') return favourable ? 'good' : 'attention';
  return favourable ? 'good' : 'watch';
}
