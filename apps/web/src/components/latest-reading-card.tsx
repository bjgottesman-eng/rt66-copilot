import type { BpReadingDto, FreshnessDto } from '@benhealth/shared';
import { FreshnessPill } from './freshness-pill';
import { SourceBadge } from './source-badge';
import { formatMeasuredAt, relativeAge } from '@/lib/format';
import { freshnessExplanation } from '@/lib/freshness-ui';

/**
 * Latest-reading card: large systolic/diastolic, pulse, source + device,
 * measurement time (primary, in the reading's timezone), ingestion time
 * (secondary), and the freshness pill.
 */
export function LatestReadingCard({
  reading,
  freshness,
  now,
}: {
  reading: BpReadingDto | null;
  freshness: FreshnessDto;
  now: Date;
}) {
  if (reading === null) {
    return (
      <section className="card" aria-labelledby="latest-title">
        <h2 className="card-title" id="latest-title">
          Latest reading
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FreshnessPill freshness={freshness} />
        </div>
        <p className="meta-line">No blood pressure readings yet.</p>
        <p className="card-note">{freshnessExplanation(freshness)}</p>
      </section>
    );
  }

  const measuredAbs = formatMeasuredAt(reading.measuredAt, reading.measuredTz);
  const measuredRel = relativeAge(reading.measuredAt, now);
  const ingestedRel = relativeAge(reading.ingestedAt, now);

  return (
    <section className="card" aria-labelledby="latest-title">
      <h2 className="card-title" id="latest-title">
        Latest reading
      </h2>
      <div className="bp-hero">
        <span className="bp-hero-value">
          {reading.systolic}
          <span style={{ color: 'var(--muted)' }}>/</span>
          {reading.diastolic}
        </span>
        <span className="bp-hero-unit">mmHg</span>
        {reading.pulse !== null ? (
          <span className="bp-hero-pulse">{reading.pulse} bpm</span>
        ) : (
          <span className="bp-hero-pulse" style={{ color: 'var(--muted)' }}>
            pulse not recorded
          </span>
        )}
        <FreshnessPill freshness={freshness} />
      </div>
      <p className="meta-line">
        <time dateTime={reading.measuredAt} title={reading.measuredAt}>
          Measured {measuredRel} · {measuredAbs}
        </time>
      </p>
      <p className="meta-line-secondary">
        <SourceBadge source={reading.source} />{' '}
        {reading.sourceDevice !== null ? <>{reading.sourceDevice} · </> : null}
        <time dateTime={reading.ingestedAt} title={reading.ingestedAt}>
          ingested {ingestedRel}
        </time>
        {reading.arm !== 'unknown' ? <> · {reading.arm} arm</> : null}
        {reading.bodyPosition !== 'unknown' ? <> · {reading.bodyPosition}</> : null}
      </p>
      {reading.note !== null && reading.note !== '' ? (
        <p className="meta-line-secondary">Note: {reading.note}</p>
      ) : null}
    </section>
  );
}
