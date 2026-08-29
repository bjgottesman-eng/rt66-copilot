/**
 * Time formatting helpers. Pure functions (explicit `now`) so they are
 * table-testable. Measurement time is always primary and shown in the
 * reading's own timezone; ingestion time is secondary (contracts + CLAUDE.md).
 */

const FALLBACK_TZ = 'UTC';

/** True when `tz` is a usable IANA timezone for Intl. */
function usableTz(tz: string | null | undefined): string {
  if (tz === null || tz === undefined || tz === '') return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

/** "Aug 28, 2026, 9:15 PM EDT" — full measurement timestamp in its own tz. */
export function formatMeasuredAt(iso: string | Date, tz: string | null): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return 'unknown time';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: usableTz(tz),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

/** "9:15 PM" — clock time in the reading's tz (session rows, tooltips). */
export function formatClock(iso: string | Date, tz: string | null): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: usableTz(tz),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** "Aug 28" — short date in the reading's tz (axis ticks, table rows). */
export function formatShortDate(iso: string | Date, tz: string | null): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: usableTz(tz),
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Relative age: "just now", "5 min ago", "2 h ago", "3 d ago".
 * Future timestamps (clock skew) degrade to "just now" rather than lying.
 */
export function relativeAge(iso: string | Date, now: Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return 'unknown';
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

/** Same, from whole seconds of age (FreshnessDto.ageSeconds). */
export function relativeAgeFromSeconds(ageSeconds: number): string {
  if (ageSeconds < 0) return 'just now';
  const ref = new Date(0);
  return relativeAge(new Date(-ageSeconds * 1000), ref);
}

/** Humanize a latency in seconds: "45 s", "5 min", "2 h", "26 h". */
export function formatLatency(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.round(minutes / 60)} h`;
}
