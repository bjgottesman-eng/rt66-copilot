import type { SourceStatusDto } from '@benhealth/shared';
import { redirect } from 'next/navigation';
import { ErrorPanel } from '@/components/error-panel';
import { FreshnessPill } from '@/components/freshness-pill';
import { formatLatency, formatMeasuredAt, relativeAge } from '@/lib/format';
import { platformGet } from '@/lib/platform-server';

export const metadata = { title: 'Sources' };

/** Sources table per contracts SourceStatusDto — one row per provider, NOT_CONNECTED included. */
export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const justConnected = params.connected === 'withings';

  const res = await platformGet<{ sources: SourceStatusDto[] }>('/sources');
  if (!res.ok) {
    if (res.kind === 'unauthorized') redirect('/login?expired=1');
    return <ErrorPanel title="Couldn't load sources" message={res.message} />;
  }
  const now = new Date();

  return (
    <>
      <div>
        <h1 className="page-title">Data sources</h1>
        <p className="page-subtitle">
          Connection, sync and freshness status for every provider — including ones not yet
          connected.
        </p>
      </div>
      {justConnected ? (
        <p className="form-msg form-msg-ok" role="status">
          Withings connected.
        </p>
      ) : null}
      <section className="card">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Connection</th>
                <th scope="col">Last Sync</th>
                <th scope="col">Latest Measurement</th>
                <th scope="col">Expected Latency</th>
                <th scope="col">Freshness</th>
                <th scope="col">Problems</th>
              </tr>
            </thead>
            <tbody>
              {res.data.sources.map((source) => (
                <tr key={source.provider}>
                  <td>
                    {source.displayName}
                    {source.coverageNote !== null ? (
                      <div className="cell-secondary">{source.coverageNote}</div>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`conn-dot conn-dot-${source.connectionStatus === 'revoked' ? 'revoked' : source.connectionStatus}`}
                      aria-hidden
                    />
                    {source.connectionStatus.replace('_', ' ')}
                  </td>
                  <td>
                    {source.lastSyncAt !== null ? (
                      <time dateTime={source.lastSyncAt} title={source.lastSyncAt}>
                        {relativeAge(source.lastSyncAt, now)}
                      </time>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {source.latestMeasuredAt !== null ? (
                      <time dateTime={source.latestMeasuredAt} title={source.latestMeasuredAt}>
                        {formatMeasuredAt(source.latestMeasuredAt, null)}
                      </time>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{formatLatency(source.freshness.expectedLatencySeconds)}</td>
                  <td>
                    <FreshnessPill freshness={source.freshness} />
                  </td>
                  <td className="cell-secondary">
                    {source.problems.length > 0 ? source.problems.join('; ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
