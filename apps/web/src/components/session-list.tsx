import type { BpSessionDto } from '@benhealth/shared';
import { formatClock, formatShortDate, relativeAge } from '@/lib/format';

const MAX_ROWS = 20;

function gapLabel(seconds: number): string {
  if (seconds < 120) return `+${Math.round(seconds)} s`;
  return `+${Math.round(seconds / 60)} min`;
}

function methodLabel(session: BpSessionDto): string {
  return session.averagingMethod === 'mean_excluding_first'
    ? 'avg excludes first reading'
    : 'avg of all readings';
}

/**
 * Expandable session rows: average, method, per-reading detail with
 * inter-reading spacing and the first-excluded marker. Native
 * <details>/<summary> so it works without JS and stays keyboard-accessible.
 */
export function SessionList({ sessions, now }: { sessions: BpSessionDto[]; now: Date }) {
  const newestFirst = [...sessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  const shown = newestFirst.slice(0, MAX_ROWS);

  return (
    <section className="card" aria-labelledby="sessions-title">
      <h2 className="card-title" id="sessions-title">
        Sessions (last 30 days)
      </h2>
      {shown.length === 0 ? (
        <p className="card-note">No sessions in the last 30 days.</p>
      ) : (
        <div>
          {shown.map((session) => {
            const tz = session.readings[0]?.measuredTz ?? null;
            const avg =
              session.avgSystolic !== null && session.avgDiastolic !== null
                ? `${session.avgSystolic}/${session.avgDiastolic}`
                : '—';
            return (
              <details className="session-row" key={session.id}>
                <summary>
                  <span className="session-caret" aria-hidden>
                    ▶
                  </span>
                  <span>
                    <time dateTime={session.startedAt} title={session.startedAt}>
                      {formatShortDate(session.startedAt, tz)},{' '}
                      {formatClock(session.startedAt, tz)}
                    </time>{' '}
                    <span className="cell-secondary">({relativeAge(session.startedAt, now)})</span>
                  </span>
                  <span className="session-avg">
                    {avg} <span className="cell-secondary">mmHg</span>
                  </span>
                  <span className="session-col-hide">
                    {session.readingCount} reading{session.readingCount === 1 ? '' : 's'}
                  </span>
                  <span className="session-col-hide cell-secondary">
                    {methodLabel(session)}
                    {session.avgPulse !== null ? <> · pulse {session.avgPulse}</> : null}
                  </span>
                </summary>
                <div className="session-detail">
                  <div className="table-scroll">
                    <table className="data">
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col">Time</th>
                          <th scope="col">Reading</th>
                          <th scope="col">Pulse</th>
                          <th scope="col">Spacing</th>
                          <th scope="col"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.readings.map((reading, index) => {
                          const prev = session.readings[index - 1];
                          const gapSeconds =
                            prev === undefined
                              ? null
                              : (new Date(reading.measuredAt).getTime() -
                                  new Date(prev.measuredAt).getTime()) /
                                1000;
                          const excluded = session.firstReadingExcluded && index === 0;
                          return (
                            <tr key={reading.id}>
                              <td className="num">{index + 1}</td>
                              <td>
                                <time dateTime={reading.measuredAt} title={reading.measuredAt}>
                                  {formatClock(reading.measuredAt, reading.measuredTz)}
                                </time>
                              </td>
                              <td className="num">
                                {reading.systolic}/{reading.diastolic}{' '}
                                <span className="cell-secondary">mmHg</span>
                              </td>
                              <td className="num">{reading.pulse ?? '—'}</td>
                              <td className="num">
                                {gapSeconds === null ? '—' : gapLabel(gapSeconds)}
                              </td>
                              <td>
                                {excluded ? (
                                  <span className="pill pill-muted">excluded from avg</span>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            );
          })}
          {newestFirst.length > MAX_ROWS ? (
            <p className="card-note" style={{ marginTop: 8 }}>
              Showing the latest {MAX_ROWS} of {newestFirst.length} sessions.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
