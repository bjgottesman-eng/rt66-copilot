/**
 * Heart-rate zones (Phase 3). Zone 2 = 60–70 % of maximum heart rate. Max HR comes from the user's
 * profile (measured/clinician value preferred) or the Tanaka estimate 208 − 0.7 × age when a birth
 * date is known. Without either, Zone 2 is INSUFFICIENT_DATA — never guessed.
 */
export interface HeartRateSample {
  time: string;
  bpm: number;
}

export function estimateMaxHeartRate(opts: { maxHeartRate?: number | null; birthDate?: string | null; asOf?: string }): { value: number; source: 'profile' | 'tanaka_estimate' } | null {
  if (opts.maxHeartRate && opts.maxHeartRate >= 100 && opts.maxHeartRate <= 230) return { value: opts.maxHeartRate, source: 'profile' };
  if (opts.birthDate) {
    const birth = new Date(opts.birthDate);
    const asOf = new Date(opts.asOf ?? new Date().toISOString());
    if (!Number.isNaN(birth.getTime())) {
      const age = (asOf.getTime() - birth.getTime()) / (365.25 * 86_400_000);
      if (age >= 10 && age <= 110) return { value: Math.round(208 - 0.7 * age), source: 'tanaka_estimate' };
    }
  }
  return null;
}

export function zoneBounds(maxHr: number): { zone2: [number, number]; vigorous: [number, number] } {
  return { zone2: [Math.round(maxHr * 0.6), Math.round(maxHr * 0.7)], vigorous: [Math.round(maxHr * 0.77), maxHr] };
}

/**
 * Estimates minutes inside Zone 2 for a workout from heart-rate samples within its window:
 * fraction of samples in zone × workout duration. Requires at least `minSamples` samples spanning
 * at least half the workout; otherwise returns null (not zero).
 */
export function estimateZoneMinutes(workout: { startAt: string; endAt: string }, samples: HeartRateSample[], maxHr: number, zone: 'zone2' | 'vigorous' = 'zone2', minSamples = 3): { minutes: number; samples: number; fraction: number; coverage: number } | null {
  const start = new Date(workout.startAt).getTime();
  const end = new Date(workout.endAt).getTime();
  const durationMin = (end - start) / 60_000;
  if (durationMin <= 0) return null;
  const inside = samples.filter((s) => {
    const t = new Date(s.time).getTime();
    return t >= start && t <= end;
  });
  if (inside.length < minSamples) return null;
  const times = inside.map((s) => new Date(s.time).getTime()).sort((a, b) => a - b);
  const spanCoverage = (times[times.length - 1]! - times[0]!) / Math.max(1, end - start);
  if (spanCoverage < 0.5) return null;
  const [lo, hi] = zoneBounds(maxHr)[zone];
  const inZone = inside.filter((s) => s.bpm >= lo && s.bpm <= hi).length;
  const fraction = inZone / inside.length;
  return { minutes: Math.round(fraction * durationMin * 10) / 10, samples: inside.length, fraction, coverage: spanCoverage };
}

export function confidenceFromCoverage(coverage: number, n: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (coverage >= 0.8 && n >= 5) return 'HIGH';
  if (coverage >= 0.5 && n >= 3) return 'MEDIUM';
  return 'LOW';
}
