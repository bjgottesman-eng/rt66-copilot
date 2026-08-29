/**
 * BP summary math (contracts §5 BpSummaryDto): 7d/30d windows, overall +
 * morning/evening splits, daily means.
 *
 * Morning = 04:00–11:59 LOCAL, evening = 17:00–23:59 LOCAL, where "local" is
 * each reading's measured_tz (IANA) with UTC fallback (contracts §5). Local
 * wall time is derived with Intl.DateTimeFormat so DST transitions (e.g.
 * America/New_York, Nov 2 2025) are handled by the tz database, not by a
 * fixed offset.
 */

import type { BpDailySummaryDto, BpMeansDto, BpSummaryDto } from '@benhealth/shared';

export interface SummaryReading {
  measuredAt: Date;
  measuredTz: string | null;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  sessionId: string | null;
}

const WINDOW_DAYS: Record<'7d' | '30d', number> = { '7d': 7, '30d': 30 };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat | null {
  let fmt = formatterCache.get(tz);
  if (fmt === undefined) {
    try {
      fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      });
    } catch {
      return null; // unknown tz -> caller falls back to UTC
    }
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

/** Local calendar date (YYYY-MM-DD) and hour-of-day in `tz` (UTC fallback). */
export function localDateAndHour(at: Date, tz: string | null): { date: string; hour: number } {
  const fmt = tz === null ? null : formatterFor(tz);
  if (fmt === null) {
    return { date: at.toISOString().slice(0, 10), hour: at.getUTCHours() };
  }
  const parts = fmt.formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  // Intl reports hour 24 for midnight in some locales; normalize.
  const hour = Number(get('hour')) % 24;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function meansOf(readings: SummaryReading[]): BpMeansDto {
  if (readings.length === 0) {
    return { meanSystolic: null, meanDiastolic: null, meanPulse: null };
  }
  const pulses = readings.map((r) => r.pulse).filter((p): p is number => p !== null);
  return {
    meanSystolic: round1(readings.reduce((s, r) => s + r.systolic, 0) / readings.length),
    meanDiastolic: round1(readings.reduce((s, r) => s + r.diastolic, 0) / readings.length),
    // Absent pulse is never treated as zero: mean over present values only.
    meanPulse: pulses.length === 0 ? null : round1(pulses.reduce((s, p) => s + p, 0) / pulses.length),
  };
}

export function computeBpSummary(
  readings: SummaryReading[],
  window: '7d' | '30d',
  now: Date,
): BpSummaryDto {
  const to = now;
  const from = new Date(now.getTime() - WINDOW_DAYS[window] * 86400 * 1000);
  const inWindow = readings.filter(
    (r) => r.measuredAt.getTime() > from.getTime() && r.measuredAt.getTime() <= to.getTime(),
  );

  const morning: SummaryReading[] = [];
  const evening: SummaryReading[] = [];
  const byDate = new Map<string, SummaryReading[]>();
  for (const r of inWindow) {
    const { date, hour } = localDateAndHour(r.measuredAt, r.measuredTz);
    if (hour >= 4 && hour <= 11) morning.push(r);
    else if (hour >= 17 && hour <= 23) evening.push(r);
    const bucket = byDate.get(date);
    if (bucket === undefined) byDate.set(date, [r]);
    else bucket.push(r);
  }

  const daily: BpDailySummaryDto[] = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, rs]) => {
      const m = meansOf(rs);
      return {
        date,
        meanSystolic: m.meanSystolic,
        meanDiastolic: m.meanDiastolic,
        sessionCount: new Set(rs.map((r) => r.sessionId).filter((s) => s !== null)).size,
      };
    });

  const overall = meansOf(inWindow);
  return {
    window,
    from: from.toISOString(),
    to: to.toISOString(),
    readingCount: inWindow.length,
    sessionCount: new Set(inWindow.map((r) => r.sessionId).filter((s) => s !== null)).size,
    meanSystolic: overall.meanSystolic,
    meanDiastolic: overall.meanDiastolic,
    meanPulse: overall.meanPulse,
    morning: meansOf(morning),
    evening: meansOf(evening),
    daily,
  };
}
