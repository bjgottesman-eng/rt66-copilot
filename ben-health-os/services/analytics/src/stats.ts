/** Small, dependency-free statistics used by the window and baseline engine. */
export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Sample standard deviation (n-1). Null for fewer than 2 values. */
export function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function variance(xs: number[]): number | null {
  const s = sd(xs);
  return s === null ? null : s * s;
}

export function min(xs: number[]): number | null {
  return xs.length ? Math.min(...xs) : null;
}

export function max(xs: number[]): number | null {
  return xs.length ? Math.max(...xs) : null;
}

/** Ordinary least squares slope of y over x. Null with fewer than 3 points or zero x-variance. */
export function slope(points: Array<{ x: number; y: number }>): number | null {
  if (points.length < 3) return null;
  const mx = mean(points.map((p) => p.x))!;
  const my = mean(points.map((p) => p.y))!;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** Percentile rank (0..100) of value within the reference sample. */
export function percentileRank(value: number, reference: number[]): number | null {
  if (reference.length === 0) return null;
  const below = reference.filter((r) => r < value).length;
  const equal = reference.filter((r) => r === value).length;
  return ((below + 0.5 * equal) / reference.length) * 100;
}

/** Cohen's d of a difference against a reference SD. */
export function effectSize(delta: number, referenceSd: number | null): number | null {
  if (referenceSd === null || referenceSd === 0) return null;
  return delta / referenceSd;
}

/** Coefficient of variation in percent (used for glucose variability). */
export function coefficientOfVariationPct(xs: number[]): number | null {
  const m = mean(xs);
  const s = sd(xs);
  if (m === null || s === null || m === 0) return null;
  return (s / m) * 100;
}
