import type { BpReadingDto } from '@benhealth/shared';
import { SourceBadge } from './source-badge';
import { formatClock, formatShortDate, relativeAge } from '@/lib/format';

const MAX_ROWS = 40;

/**
 * Reading history: every reading in the window including non-canonical
 * duplicates (dedup marks and links, never deletes — the table shows both).
 * Measurement time is primary (with tz); ingestion time is secondary.
 */
export function ReadingHistory({ readings, now }: { readings: BpReadingDto[]; now: Date }) {
  const newestFirst = [...readings].sort(
    (a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime(),
  );
  const shown = newestFirst.slice(0, MAX_ROWS);

  return (
    <section className="card" aria-labelledby="history-title">
      <h2 className="card-title" id="history-title">
        Reading history (last 30 days, duplicates included)
      </h2>
      {shown.length === 0 ? (
        <p className="card-note">No readings in the last 30 days.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Measured</th>
                <th scope="col">Reading</th>
                <th scope="col">Pulse</th>
                <th scope="col">Source</th>
                <th scope="col">Device</th>
                <th scope="col">Ingested</th>
                <th scope="col">Dedup</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((reading) => (
                <tr key={reading.id} style={reading.canonical ? undefined : { opacity: 0.62 }}>
                  <td>
                    <time dateTime={reading.measuredAt} title={reading.measuredAt}>
                      {formatShortDate(reading.measuredAt, reading.measuredTz)},{' '}
                      {formatClock(reading.measuredAt, reading.measuredTz)}
                    </time>
                  </td>
                  <td className="num">
                    {reading.systolic}/{reading.diastolic}{' '}
                    <span className="cell-secondary">mmHg</span>
                  </td>
                  <td className="num">{reading.pulse ?? '—'}</td>
                  <td>
                    <SourceBadge source={reading.source} />
                  </td>
                  <td className="cell-secondary">{reading.sourceDevice ?? '—'}</td>
                  <td>
                    <time dateTime={reading.ingestedAt} title={reading.ingestedAt}>
                      {relativeAge(reading.ingestedAt, now)}
                    </time>
                  </td>
                  <td>
                    {reading.canonical ? (
                      <span className="cell-secondary">canonical</span>
                    ) : (
                      <span className="pill pill-muted" title={`duplicate of ${reading.duplicateOf ?? 'unknown'}`}>
                        duplicate
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {newestFirst.length > MAX_ROWS ? (
            <p className="card-note" style={{ marginTop: 8 }}>
              Showing the latest {MAX_ROWS} of {newestFirst.length} readings.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
