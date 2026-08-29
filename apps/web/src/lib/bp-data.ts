/**
 * Pure chart-data helpers for the BP trend charts: local-time classification
 * (morning/evening per contracts §5 — morning 04:00–11:59, evening 17:00–23:59,
 * local to measured_tz with UTC fallback), daily means, and a y-axis domain
 * that is stable and never truncated to exaggerate variation.
 */

import type { BpSessionDto } from '@benhealth/shared';

/** One plotted point = one BP session (its canonical average). */
export interface SessionPoint {
  /** Epoch ms of the session start (measurement time, never ingestion time). */
  t: number;
  sys: number;
  dia: number;
  /** Local hour 0–23 in the session's measured timezone (UTC fallback). */
  localHour: number;
  /** Local calendar date YYYY-MM-DD in the session's measured timezone. */
  localDate: string;
  /** IANA tz of the session's readings, when known. */
  tz: string | null;
  readingCount: number;
}

export type DayPart = 'all' | 'morning' | 'evening';

function tzOrUtc(tz: string | null): string {
  if (tz === null || tz === '') return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Local hour (0–23) of `date` in `tz` (UTC fallback). */
export function localHourOf(date: Date, tz: string | null): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: tzOrUtc(tz),
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return Number.parseInt(s, 10);
}

/** Local calendar date (YYYY-MM-DD) of `date` in `tz` (UTC fallback). */
export function localDateOf(date: Date, tz: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tzOrUtc(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Contracts §5: morning = 04:00–11:59 local, evening = 17:00–23:59 local. */
export function inDayPart(localHour: number, part: DayPart): boolean {
  if (part === 'all') return true;
  if (part === 'morning') return localHour >= 4 && localHour <= 11;
  return localHour >= 17 && localHour <= 23;
}

/** Sessions (with averages) → plottable points. Sessions without averages are skipped. */
export function sessionPoints(sessions: BpSessionDto[]): SessionPoint[] {
  const points: SessionPoint[] = [];
  for (const s of sessions) {
    if (s.avgSystolic === null || s.avgDiastolic === null) continue;
    const tz = s.readings[0]?.measuredTz ?? null;
    const started = new Date(s.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    points.push({
      t: started.getTime(),
      sys: s.avgSystolic,
      dia: s.avgDiastolic,
      localHour: localHourOf(started, tz),
      localDate: localDateOf(started, tz),
      tz,
      readingCount: s.readingCount,
    });
  }
  return points.sort((a, b) => a.t - b.t);
}

export interface DailyMeanPoint {
  /** Local calendar date YYYY-MM-DD. */
  date: string;
  /** Epoch ms used as the x position (local noon of the day, first point's tz). */
  t: number;
  sys: number;
  dia: number;
  sessionCount: number;
}

/**
 * Daily means of session averages (used when the morning/evening filter is on;
 * the unfiltered view uses the server-computed BpSummaryDto.daily). Missing
 * days simply have no point — absent data is never coerced to zero.
 */
export function dailyMeansFromPoints(points: SessionPoint[]): DailyMeanPoint[] {
  const byDate = new Map<string, SessionPoint[]>();
  for (const p of points) {
    const list = byDate.get(p.localDate);
    if (list === undefined) byDate.set(p.localDate, [p]);
    else list.push(p);
  }
  const out: DailyMeanPoint[] = [];
  for (const [date, dayPoints] of byDate) {
    const sys = dayPoints.reduce((acc, p) => acc + p.sys, 0) / dayPoints.length;
    const dia = dayPoints.reduce((acc, p) => acc + p.dia, 0) / dayPoints.length;
    const t = dayPoints.reduce((acc, p) => acc + p.t, 0) / dayPoints.length;
    out.push({
      date,
      t,
      sys: Math.round(sys * 10) / 10,
      dia: Math.round(dia * 10) / 10,
      sessionCount: dayPoints.length,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Y-axis domain for BP charts. Spans at least 60–160 mmHg so ordinary
 * variation is never visually exaggerated, widening (to round decades,
 * with headroom) only when the data itself falls outside that span.
 */
export function bpAxisDomain(values: number[]): [number, number] {
  let lo = 60;
  let hi = 160;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v - 5 < lo) lo = Math.floor((v - 5) / 10) * 10;
    if (v + 5 > hi) hi = Math.ceil((v + 5) / 10) * 10;
  }
  lo = Math.max(0, lo);
  return [lo, hi];
}

/** Ticks every 20 mmHg across a domain (clean numbers, tabular axis). */
export function bpAxisTicks([lo, hi]: [number, number]): number[] {
  const ticks: number[] = [];
  const start = Math.ceil(lo / 20) * 20;
  for (let v = start; v <= hi; v += 20) ticks.push(v);
  return ticks;
}
