/**
 * Deduplication (spec §13). Order of checks:
 *  1. exact external id (same connector) — handled by database unique constraints; a different payload
 *     hash for the same id is an UPDATE, an identical hash is an idempotent no-op
 *  2. payload hash — identical content from the same connector under a new id
 *  3. conservative cross-source matching — same metric class, different source, within the dedup
 *     window and value tolerance (or interval overlap); the higher-priority source stays canonical
 * Raw records are always retained; duplicates are marked, never deleted.
 */
import { createHash } from 'node:crypto';
import { DEDUP_WINDOWS } from '@bho/shared-config';
import { preferSource, sourceKey } from './priority.js';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export interface PointLike {
  id: string;
  connector: string;
  dataOrigin?: string | null;
  measuredAt: string; // ISO
  value: number;
  /** Companion values that must also match (e.g. diastolic for a BP reading). */
  companions?: Record<string, number>;
}

export interface IntervalLike {
  id: string;
  connector: string;
  dataOrigin?: string | null;
  startAt: string;
  endAt: string;
}

export interface DuplicateDecision<T> {
  match: T;
  /** The record that remains canonical. */
  canonical: T;
  /** The record marked as a duplicate of `canonical`. */
  duplicate: T;
  reason: string;
}

function sameSource(a: { connector: string; dataOrigin?: string | null }, b: { connector: string; dataOrigin?: string | null }): boolean {
  return sourceKey(a.connector, a.dataOrigin) === sourceKey(b.connector, b.dataOrigin);
}

/** Finds a cross-source duplicate for a point measurement among existing canonical points. */
export function findPointDuplicate<T extends PointLike>(candidate: T, existing: T[], metricClass: string): DuplicateDecision<T> | null {
  const w = DEDUP_WINDOWS[metricClass];
  if (!w) return null;
  const t = new Date(candidate.measuredAt).getTime();
  for (const e of existing) {
    if (e.id === candidate.id || sameSource(candidate, e)) continue;
    const dt = Math.abs(new Date(e.measuredAt).getTime() - t) / 1000;
    if (dt > w.windowSeconds) continue;
    if (Math.abs(e.value - candidate.value) > w.valueTolerance) continue;
    if (candidate.companions) {
      // The candidate decides which companion values must agree (e.g. diastolic for a BP reading).
      const keys = Object.keys(candidate.companions);
      let ok = true;
      for (const k of keys) {
        const a = candidate.companions?.[k];
        const b = e.companions?.[k];
        if (a === undefined || b === undefined || Math.abs(a - b) > w.valueTolerance) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    const candidateWins = preferSource(metricClass, candidate, e) && !preferSource(metricClass, e, candidate);
    const canonical = candidateWins ? candidate : e;
    const duplicate = candidateWins ? e : candidate;
    return {
      match: e,
      canonical,
      duplicate,
      reason: `cross-source match within ${Math.round(dt)}s (${sourceKey(duplicate.connector, duplicate.dataOrigin)} duplicates ${sourceKey(canonical.connector, canonical.dataOrigin)})`,
    };
  }
  return null;
}

export function overlapFraction(a: IntervalLike, b: IntervalLike): number {
  const as = new Date(a.startAt).getTime();
  const ae = new Date(a.endAt).getTime();
  const bs = new Date(b.startAt).getTime();
  const be = new Date(b.endAt).getTime();
  const overlap = Math.max(0, Math.min(ae, be) - Math.max(as, bs));
  const shorter = Math.max(1, Math.min(ae - as, be - bs));
  return overlap / shorter;
}

/** Finds a cross-source duplicate for an interval record (sleep session, workout). */
export function findIntervalDuplicate<T extends IntervalLike>(candidate: T, existing: T[], metricClass: string): DuplicateDecision<T> | null {
  const w = DEDUP_WINDOWS[metricClass];
  if (!w) return null;
  const minOverlap = w.minOverlapFraction ?? 0.8;
  for (const e of existing) {
    if (e.id === candidate.id || sameSource(candidate, e)) continue;
    const startDelta = Math.abs(new Date(e.startAt).getTime() - new Date(candidate.startAt).getTime()) / 1000;
    const frac = overlapFraction(candidate, e);
    if (frac < minOverlap && startDelta > w.windowSeconds) continue;
    if (frac < minOverlap) continue;
    const candidateWins = preferSource(metricClass, candidate, e) && !preferSource(metricClass, e, candidate);
    const canonical = candidateWins ? candidate : e;
    const duplicate = candidateWins ? e : candidate;
    return {
      match: e,
      canonical,
      duplicate,
      reason: `interval overlap ${(frac * 100).toFixed(0)}% (${sourceKey(duplicate.connector, duplicate.dataOrigin)} duplicates ${sourceKey(canonical.connector, canonical.dataOrigin)})`,
    };
  }
  return null;
}

/**
 * Steps are never summed across origins. Given per-origin totals for one local day, returns the
 * highest-priority origin with data and its total; other origins are reported as linked duplicates.
 */
export function resolveDailySteps(totals: Array<{ connector: string; dataOrigin?: string | null; steps: number }>): { steps: number; source: string; alternates: Array<{ source: string; steps: number }> } | null {
  const withData = totals.filter((t) => t.steps > 0 || totals.length === 1);
  if (withData.length === 0) return null;
  const sorted = [...withData].sort((a, b) => (preferSource('steps', a, b) ? -1 : 1));
  const best = sorted[0]!;
  return {
    steps: best.steps,
    source: sourceKey(best.connector, best.dataOrigin),
    alternates: sorted.slice(1).map((t) => ({ source: sourceKey(t.connector, t.dataOrigin), steps: t.steps })),
  };
}
