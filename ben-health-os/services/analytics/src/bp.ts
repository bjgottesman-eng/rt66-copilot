/**
 * Blood-pressure helpers: session grouping and transparent averaging, morning/evening split.
 * No rule here diagnoses anything; targets are configurable and labelled with their source.
 */
import { localTimeOf } from './time.js';
import { mean } from './stats.js';

export interface BpReadingLike {
  id: string;
  measuredAt: string;
  zoneOffset?: string | null;
  systolic: number;
  diastolic: number;
  pulse?: number | null;
  sessionId?: string | null;
  canonical?: boolean;
}

export type AveragingRule = 'MEAN_OF_ALL' | 'DROP_FIRST_IF_3_PLUS';

export interface BpSessionSummary {
  sessionId: string | null;
  startedAt: string;
  n: number;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  rule: string;
  readingIds: string[];
}

/** Groups readings taken within `gapMinutes` of the previous reading (or sharing a sessionId). */
export function groupSessions(readings: BpReadingLike[], gapMinutes = 30): BpReadingLike[][] {
  const sorted = [...readings].filter((r) => r.canonical !== false).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const groups: BpReadingLike[][] = [];
  for (const r of sorted) {
    const last = groups[groups.length - 1];
    if (last) {
      const prev = last[last.length - 1]!;
      const sameSession = r.sessionId && prev.sessionId && r.sessionId === prev.sessionId;
      const close = (new Date(r.measuredAt).getTime() - new Date(prev.measuredAt).getTime()) / 60_000 <= gapMinutes;
      if (sameSession || (close && !r.sessionId && !prev.sessionId)) {
        last.push(r);
        continue;
      }
    }
    groups.push([r]);
  }
  return groups;
}

export function summarizeSession(group: BpReadingLike[], rule: AveragingRule = 'MEAN_OF_ALL'): BpSessionSummary {
  const used = rule === 'DROP_FIRST_IF_3_PLUS' && group.length >= 3 ? group.slice(1) : group;
  const pulses = used.map((r) => r.pulse).filter((p): p is number => typeof p === 'number');
  return {
    sessionId: group[0]!.sessionId ?? null,
    startedAt: group[0]!.measuredAt,
    n: used.length,
    systolic: mean(used.map((r) => r.systolic))!,
    diastolic: mean(used.map((r) => r.diastolic))!,
    pulse: pulses.length ? mean(pulses) : null,
    rule: rule === 'DROP_FIRST_IF_3_PLUS' && group.length >= 3 ? 'mean of readings 2..n (first reading discarded)' : `mean of ${used.length} reading${used.length === 1 ? '' : 's'}`,
    readingIds: used.map((r) => r.id),
  };
}

export function morningEveningSplit(readings: BpReadingLike[], timeZone: string): { morning: BpReadingLike[]; evening: BpReadingLike[]; other: BpReadingLike[] } {
  const morning: BpReadingLike[] = [];
  const evening: BpReadingLike[] = [];
  const other: BpReadingLike[] = [];
  for (const r of readings) {
    if (r.canonical === false) continue;
    const { hour } = localTimeOf(r.measuredAt, r.zoneOffset ?? null, timeZone);
    if (hour >= 4 && hour < 12) morning.push(r);
    else if (hour >= 17 && hour < 24) evening.push(r);
    else other.push(r);
  }
  return { morning, evening, other };
}

export function averageBp(readings: BpReadingLike[]): { systolic: number; diastolic: number; pulse: number | null; n: number } | null {
  const used = readings.filter((r) => r.canonical !== false);
  if (used.length === 0) return null;
  const pulses = used.map((r) => r.pulse).filter((p): p is number => typeof p === 'number');
  return { systolic: mean(used.map((r) => r.systolic))!, diastolic: mean(used.map((r) => r.diastolic))!, pulse: pulses.length ? mean(pulses) : null, n: used.length };
}
