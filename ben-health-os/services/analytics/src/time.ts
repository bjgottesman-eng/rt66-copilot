/**
 * Time-zone aware helpers. Health data arrives as instants plus (when the source provides it) the
 * zone offset at measurement time. Local-day bucketing prefers the record's own offset and falls
 * back to the user's IANA zone, so travel days and DST changes bucket the way the device did.
 */
const DAY_MS = 86_400_000;

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(instantMs: number, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

/** UTC offset in minutes for the zone at the given instant (e.g. New York in July = -240). */
export function offsetMinutes(instantMs: number, timeZone: string): number {
  const p = zonedParts(instantMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60_000);
}

export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'Z';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function parseOffset(offset: string): number | null {
  if (offset === 'Z') return 0;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Local calendar date for an instant. Uses the record's zone offset when present (what the device
 * knew), else the user's IANA zone.
 */
export function localDateOf(instant: string | number | Date, zoneOffset: string | null | undefined, timeZone: string): string {
  const ms = typeof instant === 'number' ? instant : new Date(instant).getTime();
  if (Number.isNaN(ms)) throw new Error(`invalid instant: ${String(instant)}`);
  const off = zoneOffset ? parseOffset(zoneOffset) : null;
  if (off !== null) {
    const shifted = new Date(ms + off * 60_000);
    return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  }
  const p = zonedParts(ms, timeZone);
  return isoDate(p.year, p.month, p.day);
}

export function localTimeOf(instant: string | number | Date, zoneOffset: string | null | undefined, timeZone: string): { hour: number; minute: number } {
  const ms = typeof instant === 'number' ? instant : new Date(instant).getTime();
  const off = zoneOffset ? parseOffset(zoneOffset) : null;
  if (off !== null) {
    const shifted = new Date(ms + off * 60_000);
    return { hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
  }
  const p = zonedParts(ms, timeZone);
  return { hour: p.hour, minute: p.minute };
}

/** Instant (ms) of local midnight starting the given local date in the zone; DST-safe. */
export function dayStartMs(localDate: string, timeZone: string): number {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = naive - offsetMinutes(naive, timeZone) * 60_000;
  const off2 = offsetMinutes(guess, timeZone);
  const guess2 = naive - off2 * 60_000;
  if (guess2 !== guess) guess = guess2;
  return guess;
}

/** [start, end) instants for a local date; the day may be 23 or 25 hours long on DST days. */
export function dayRange(localDate: string, timeZone: string): { startMs: number; endMs: number; hours: number } {
  const startMs = dayStartMs(localDate, timeZone);
  const endMs = dayStartMs(addDays(localDate, 1), timeZone);
  return { startMs, endMs, hours: (endMs - startMs) / 3_600_000 };
}

export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * DAY_MS;
  const dt = new Date(t);
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysBetween(fromDate: string, toDate: string): number {
  const [y1, m1, d1] = fromDate.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = toDate.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

export function enumerateDays(fromDate: string, toDate: string): string[] {
  const n = daysBetween(fromDate, toDate);
  const out: string[] = [];
  for (let i = 0; i <= n; i++) out.push(addDays(fromDate, i));
  return out;
}

export function hoursBetween(a: string | number | Date, b: string | number | Date): number {
  const ams = typeof a === 'number' ? a : new Date(a).getTime();
  const bms = typeof b === 'number' ? b : new Date(b).getTime();
  return (bms - ams) / 3_600_000;
}
