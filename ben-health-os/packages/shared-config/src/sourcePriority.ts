/**
 * Source priority: when two sources report the same measurement, which one is canonical.
 * Entries are matched in order. A key is either a connector id ("withings") or
 * "health_connect:<android package>" ("health_connect:com.withings.wiscale2"); "health_connect:*"
 * matches any Health Connect origin. Lower index = higher priority.
 *
 * Rules (docs/source-priority.md):
 *  - Raw records from every source are retained; priority only decides which record is canonical.
 *  - Step counts from different origins are NEVER summed; the highest-priority origin with data for
 *    the local day is used, others are linked as duplicates.
 *  - Manual entry always ranks below device-captured sources for the same measurement.
 */
export const SOURCE_PRIORITY: Record<string, string[]> = {
  blood_pressure: ['withings', 'health_connect:com.withings.wiscale2', 'health_connect:*', 'manual'],
  pulse: ['withings', 'health_connect:com.withings.wiscale2', 'health_connect:*', 'manual'],
  weight: ['withings', 'health_connect:com.withings.wiscale2', 'health_connect:*', 'manual'],
  body_fat_pct: ['withings', 'health_connect:com.withings.wiscale2', 'health_connect:*', 'manual'],
  sleep: ['oura', 'health_connect:com.ouraring.oura', 'health_connect:com.sec.android.app.shealth', 'health_connect:*', 'manual'],
  resting_heart_rate: ['oura', 'health_connect:com.ouraring.oura', 'health_connect:*'],
  hrv_rmssd: ['oura', 'health_connect:com.ouraring.oura', 'health_connect:*'],
  respiratory_rate: ['oura', 'health_connect:com.ouraring.oura', 'health_connect:*'],
  spo2: ['oura', 'health_connect:com.ouraring.oura', 'health_connect:*'],
  heart_rate: ['health_connect:com.ouraring.oura', 'oura', 'health_connect:com.sec.android.app.shealth', 'health_connect:*'],
  steps: ['health_connect:com.sec.android.app.shealth', 'health_connect:com.ouraring.oura', 'oura', 'health_connect:*', 'manual'],
  distance_m: ['health_connect:com.sec.android.app.shealth', 'health_connect:*'],
  workout: ['health_connect:com.sec.android.app.shealth', 'health_connect:com.ouraring.oura', 'oura', 'health_connect:*', 'manual'],
  blood_glucose: ['health_connect:com.dexcom.stelo', 'stelo', 'health_connect:*', 'file_import', 'manual'],
  nutrition: ['cronometer', 'health_connect:com.cronometer.android.gold', 'health_connect:*', 'manual'],
  vo2_max: ['oura', 'health_connect:*', 'manual'],
  lab_result: ['clinical_fhir', 'function_health', 'file_import', 'manual'],
};

/** Returns priority rank (lower is better). Unknown sources rank last. */
export function priorityRank(metricClass: string, connectorId: string, dataOrigin?: string | null): number {
  const list = SOURCE_PRIORITY[metricClass] ?? [];
  const keys: string[] = [connectorId];
  if (connectorId === 'health_connect') {
    if (dataOrigin) keys.unshift(`health_connect:${dataOrigin}`);
    keys.push('health_connect:*');
  }
  let best = Number.POSITIVE_INFINITY;
  for (const k of keys) {
    const idx = list.indexOf(k);
    if (idx >= 0 && idx < best) best = idx;
  }
  return best === Number.POSITIVE_INFINITY ? list.length + 1 : best;
}
