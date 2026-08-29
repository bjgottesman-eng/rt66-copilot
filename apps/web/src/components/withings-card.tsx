'use client';

import { useState } from 'react';
import type { SourceStatusDto } from '@benhealth/shared';
import { useRouter } from 'next/navigation';
import { apiPost, ApiRequestError } from '@/lib/client-api';
import { FreshnessPill } from './freshness-pill';
import { formatMeasuredAt, relativeAge } from '@/lib/format';

/**
 * Withings connection card: connect (OAuth authorize redirect), on-demand
 * refresh, sync status and last error. `source` is the withings row from
 * GET /sources.
 */
export function WithingsCard({ source, now }: { source: SourceStatusDto | null; now: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'connect' | 'refresh' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const nowDate = new Date(now);
  const connected = source?.connectionStatus === 'connected';

  async function connect() {
    setBusy('connect');
    setMessage(null);
    try {
      const { authorizeUrl } = await apiPost<{ authorizeUrl: string }>(
        '/sources/withings/connect',
      );
      window.location.assign(authorizeUrl);
    } catch (err) {
      setMessage({
        kind: 'err',
        text: err instanceof ApiRequestError ? err.message : 'Could not start the connection.',
      });
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy('refresh');
    setMessage(null);
    try {
      const { imported } = await apiPost<{ imported: number }>('/sources/withings/refresh');
      setMessage({
        kind: 'ok',
        text: `Sync complete — ${imported} measurement group${imported === 1 ? '' : 's'} imported.`,
      });
      router.refresh();
    } catch (err) {
      setMessage({
        kind: 'err',
        text: err instanceof ApiRequestError ? err.message : 'Refresh failed.',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-labelledby="withings-title">
      <h2 className="card-title" id="withings-title">
        Withings
      </h2>
      {source === null ? (
        <p className="card-note">Source status unavailable.</p>
      ) : (
        <>
          <p className="meta-line">
            <span className={`conn-dot conn-dot-${source.connectionStatus}`} aria-hidden />
            {source.connectionStatus.replace('_', ' ')} <FreshnessPill freshness={source.freshness} />
          </p>
          <p className="meta-line-secondary">
            {source.lastSyncAt !== null ? (
              <time dateTime={source.lastSyncAt} title={source.lastSyncAt}>
                Last sync {relativeAge(source.lastSyncAt, nowDate)}
              </time>
            ) : (
              'Never synced'
            )}
            {source.latestMeasuredAt !== null ? (
              <>
                {' · '}
                <time dateTime={source.latestMeasuredAt} title={source.latestMeasuredAt}>
                  newest measurement {formatMeasuredAt(source.latestMeasuredAt, null)}
                </time>
              </>
            ) : null}
          </p>
          {source.problems.length > 0 ? (
            <p className="form-msg form-msg-err">Last error: {source.problems.join('; ')}</p>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {!connected ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => void connect()}
              >
                {busy === 'connect' ? 'Redirecting…' : 'Connect Withings'}
              </button>
            ) : null}
            {connected ? (
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => void refresh()}
              >
                {busy === 'refresh' ? 'Refreshing…' : 'Refresh now'}
              </button>
            ) : null}
          </div>
          {message !== null ? (
            <p
              className={`form-msg ${message.kind === 'ok' ? 'form-msg-ok' : 'form-msg-err'}`}
              role="status"
            >
              {message.text}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
