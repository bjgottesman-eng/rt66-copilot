/** Freshness status computation (rules documented in @bho/shared-config freshness.ts). */
import type { FreshnessInfo, FreshnessStatus } from '@bho/contracts';
import { thresholdsFor } from '@bho/shared-config';
import { hoursBetween } from './time.js';

export interface ConnectionHealth {
  status: string; // ConnectionStatus
  lastSuccessfulSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncStatus: string; // SyncStatus
  lastError: string | null;
  expectedSyncIntervalHours: number;
  displayName: string;
}

export interface FreshnessInput {
  metricId: string;
  now: string;
  latestMeasuredAt: string | null;
  sourceUpdatedAt: string | null;
  ingestedAt: string | null;
  /** Connections that can provide this metric (may be empty). */
  connections: ConnectionHealth[];
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export function computeFreshness(input: FreshnessInput): FreshnessInfo {
  const t = thresholdsFor(input.metricId);
  const base = {
    measuredAt: input.latestMeasuredAt,
    sourceUpdatedAt: input.sourceUpdatedAt,
    ingestedAt: input.ingestedAt,
    expectedLatencyHours: t.expectedLatencyHours,
  };
  const active = input.connections.filter((c) => !['NOT_CONFIGURED', 'DISCONNECTED', 'UNSUPPORTED'].includes(c.status));
  if (active.length === 0) {
    return { ...base, status: 'NOT_CONNECTED', ageHours: null, reason: 'No connected source provides this metric. Connect a source under Data Sources.' };
  }
  const healthy = active.filter((c) => {
    if (!c.lastSuccessfulSyncAt) return false;
    return hoursBetween(c.lastSuccessfulSyncAt, input.now) <= c.expectedSyncIntervalHours;
  });
  const erroring = active.filter((c) => c.lastSyncStatus === 'ERROR' || ['EXPIRED', 'REVOKED', 'ERROR'].includes(c.status));
  if (healthy.length === 0 && erroring.length > 0) {
    const c = erroring[0]!;
    const detail = c.lastError ? ` (${c.lastError})` : '';
    return {
      ...base,
      status: 'SYNC_ERROR',
      ageHours: input.latestMeasuredAt ? hoursBetween(input.latestMeasuredAt, input.now) : null,
      reason: `${c.displayName} sync is failing${detail}. Reconnect or refresh the source; data shown is from before the failure.`,
    };
  }
  if (!input.latestMeasuredAt) {
    return { ...base, status: 'INSUFFICIENT_DATA', ageHours: null, reason: 'Connected, but no observations have been received for this metric yet.' };
  }
  const age = hoursBetween(input.latestMeasuredAt, input.now);
  const status: FreshnessStatus =
    age <= t.currentWithinHours
      ? 'CURRENT'
      : age <= t.recentWithinHours
        ? 'RECENT'
        : age <= t.staleAfterHours && healthy.length > 0
          ? 'SOURCE_DELAYED'
          : 'STALE';
  let reason: string;
  switch (status) {
    case 'CURRENT':
      reason = `Measured ${fmtHours(age)} ago (expected latency ≈ ${fmtHours(t.expectedLatencyHours)}).`;
      break;
    case 'RECENT':
      reason = `Measured ${fmtHours(age)} ago; newer data may still be syncing from the source.`;
      break;
    case 'SOURCE_DELAYED': {
      const c = healthy[0]!;
      const syncedAgo = c.lastSuccessfulSyncAt ? fmtHours(hoursBetween(c.lastSuccessfulSyncAt, input.now)) : 'unknown';
      reason = `Our last sync with ${c.displayName} succeeded ${syncedAgo} ago but the source has not produced anything newer than ${fmtHours(age)} ago. Check that the device has synced to its app.`;
      break;
    }
    default: {
      const c = active[0]!;
      const syncedAgo = c.lastSuccessfulSyncAt ? `${fmtHours(hoursBetween(c.lastSuccessfulSyncAt, input.now))} ago` : 'never';
      reason = healthy.length > 0
        ? `No measurement for ${fmtHours(age)}; sync is healthy, so the device simply has not recorded anything. Take a new measurement if this metric matters today.`
        : `Last measurement ${fmtHours(age)} ago and the last successful ${c.displayName} sync was ${syncedAgo} (expected every ${fmtHours(c.expectedSyncIntervalHours)}). Refresh or reconnect the source.`;
    }
  }
  return { ...base, status, ageHours: age, reason };
}
