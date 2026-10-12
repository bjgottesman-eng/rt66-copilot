/**
 * Freshness thresholds (hours). Every metric shows: measured at, source last updated, ingested at,
 * expected latency, and a status computed by the analytics engine (services/analytics) using these
 * thresholds. The Android app reads the generated JSON copy for offline display.
 *
 * Status semantics (see docs/architecture.md § Freshness):
 *  CURRENT          age(latest measurement) <= currentWithinHours
 *  RECENT           age <= recentWithinHours
 *  SOURCE_DELAYED   age <= staleAfterHours AND our last successful sync is within the connector's expected
 *                   sync interval — i.e. we are syncing fine but the upstream source has produced nothing newer
 *  STALE            otherwise (our sync is overdue, or no measurement for longer than staleAfterHours)
 *  SYNC_ERROR       the providing connection's last sync failed and it has not succeeded within its expected interval
 *  NOT_CONNECTED    no connected source can provide the metric
 *  INSUFFICIENT_DATA connected, but no observations exist for the metric
 */
export const FRESHNESS_STATUSES = [
  'CURRENT',
  'RECENT',
  'SOURCE_DELAYED',
  'STALE',
  'SYNC_ERROR',
  'NOT_CONNECTED',
  'INSUFFICIENT_DATA',
] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export interface MetricFreshnessThresholds {
  /** Typical delay between the physiological event and cloud/Health Connect availability. */
  expectedLatencyHours: number;
  currentWithinHours: number;
  recentWithinHours: number;
  staleAfterHours: number;
}

export const FRESHNESS_DEFAULTS: MetricFreshnessThresholds = {
  expectedLatencyHours: 6,
  currentWithinHours: 12,
  recentWithinHours: 36,
  staleAfterHours: 168,
};

/** Per-metric overrides. Keys are metric ids from the metric catalog. */
export const FRESHNESS_BY_METRIC: Record<string, Partial<MetricFreshnessThresholds>> = {
  steps: { expectedLatencyHours: 1, currentWithinHours: 4, recentWithinHours: 24, staleAfterHours: 72 },
  heart_rate: { expectedLatencyHours: 1, currentWithinHours: 4, recentWithinHours: 24, staleAfterHours: 72 },
  resting_heart_rate: { expectedLatencyHours: 12, currentWithinHours: 30, recentWithinHours: 54, staleAfterHours: 120 },
  hrv_rmssd: { expectedLatencyHours: 12, currentWithinHours: 30, recentWithinHours: 54, staleAfterHours: 120 },
  sleep_duration: { expectedLatencyHours: 12, currentWithinHours: 30, recentWithinHours: 54, staleAfterHours: 120 },
  respiratory_rate: { expectedLatencyHours: 12, currentWithinHours: 30, recentWithinHours: 54, staleAfterHours: 120 },
  spo2: { expectedLatencyHours: 12, currentWithinHours: 30, recentWithinHours: 54, staleAfterHours: 120 },
  readiness_score: { expectedLatencyHours: 12, currentWithinHours: 30, recentWithinHours: 54, staleAfterHours: 120 },
  sleep_score: { expectedLatencyHours: 12, currentWithinHours: 30, recentWithinHours: 54, staleAfterHours: 120 },
  activity_score: { expectedLatencyHours: 12, currentWithinHours: 30, recentWithinHours: 54, staleAfterHours: 120 },
  blood_pressure_systolic: { expectedLatencyHours: 2, currentWithinHours: 36, recentWithinHours: 96, staleAfterHours: 336 },
  blood_pressure_diastolic: { expectedLatencyHours: 2, currentWithinHours: 36, recentWithinHours: 96, staleAfterHours: 336 },
  pulse: { expectedLatencyHours: 2, currentWithinHours: 36, recentWithinHours: 96, staleAfterHours: 336 },
  weight: { expectedLatencyHours: 2, currentWithinHours: 48, recentWithinHours: 168, staleAfterHours: 504 },
  body_fat_pct: { expectedLatencyHours: 2, currentWithinHours: 48, recentWithinHours: 168, staleAfterHours: 504 },
  blood_glucose: { expectedLatencyHours: 3, currentWithinHours: 6, recentWithinHours: 24, staleAfterHours: 96 },
  exercise_minutes: { expectedLatencyHours: 2, currentWithinHours: 48, recentWithinHours: 96, staleAfterHours: 240 },
  resistance_sessions: { expectedLatencyHours: 2, currentWithinHours: 72, recentWithinHours: 120, staleAfterHours: 336 },
  zone2_minutes: { expectedLatencyHours: 2, currentWithinHours: 48, recentWithinHours: 96, staleAfterHours: 240 },
  calories: { expectedLatencyHours: 12, currentWithinHours: 36, recentWithinHours: 72, staleAfterHours: 240 },
  protein_g: { expectedLatencyHours: 12, currentWithinHours: 36, recentWithinHours: 72, staleAfterHours: 240 },
  vo2_max: { expectedLatencyHours: 24, currentWithinHours: 336, recentWithinHours: 720, staleAfterHours: 2160 },
  lab_result: { expectedLatencyHours: 72, currentWithinHours: 2160, recentWithinHours: 4320, staleAfterHours: 8760 },
};

export function thresholdsFor(metricId: string): MetricFreshnessThresholds {
  return { ...FRESHNESS_DEFAULTS, ...(FRESHNESS_BY_METRIC[metricId] ?? {}) };
}
