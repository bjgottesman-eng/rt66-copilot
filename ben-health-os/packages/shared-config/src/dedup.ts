/**
 * Cross-source duplicate matching windows. Exact external ids and payload hashes are always checked
 * first; these windows govern the conservative value+time matching used across sources
 * (e.g. a Withings API reading vs the same reading surfaced through Health Connect).
 */
export interface DedupWindow {
  /** Max distance between measurement timestamps, seconds. */
  windowSeconds: number;
  /** Max absolute difference between values for them to be considered the same measurement. */
  valueTolerance: number;
  /** For interval records: minimum overlap fraction of the shorter interval. */
  minOverlapFraction?: number;
}

export const DEDUP_WINDOWS: Record<string, DedupWindow> = {
  blood_pressure: { windowSeconds: 180, valueTolerance: 0 },
  pulse: { windowSeconds: 180, valueTolerance: 1 },
  weight: { windowSeconds: 600, valueTolerance: 0.1 },
  body_fat_pct: { windowSeconds: 600, valueTolerance: 0.2 },
  blood_glucose: { windowSeconds: 90, valueTolerance: 1 },
  resting_heart_rate: { windowSeconds: 3600 * 6, valueTolerance: 1 },
  hrv_rmssd: { windowSeconds: 3600 * 6, valueTolerance: 1 },
  sleep: { windowSeconds: 1800, valueTolerance: 0, minOverlapFraction: 0.8 },
  workout: { windowSeconds: 300, valueTolerance: 0, minOverlapFraction: 0.7 },
  steps: { windowSeconds: 0, valueTolerance: 0 },
};
