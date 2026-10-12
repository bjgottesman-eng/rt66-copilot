import { metricById } from '@bho/shared-config';

/** Returns quality flags for a value; implausible values are flagged, never dropped. */
export function plausibilityFlags(metricId: string, value: number): string[] {
  const def = metricById(metricId);
  if (!def) return ['UNKNOWN_METRIC'];
  const flags: string[] = [];
  if (!Number.isFinite(value)) flags.push('NON_FINITE_VALUE');
  else if (value < def.plausibleMin || value > def.plausibleMax) flags.push('IMPLAUSIBLE_VALUE');
  return flags;
}

export function timestampFlags(measuredAt: string, nowIso: string, sourceModifiedAt?: string | null): string[] {
  const flags: string[] = [];
  const m = new Date(measuredAt).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(m)) return ['INVALID_TIMESTAMP'];
  if (m > now + 15 * 60_000) flags.push('FUTURE_TIMESTAMP');
  if (sourceModifiedAt) {
    const sm = new Date(sourceModifiedAt).getTime();
    if (!Number.isNaN(sm) && sm < m - 60_000) flags.push('MODIFIED_BEFORE_MEASURED');
  }
  return flags;
}
