import type { DomainCard as DomainCardT } from '@bho/contracts';
import { domainTone } from '@/lib/format';
import Link from 'next/link';
import { Card, Chip } from './ui';
import { MetricTile } from './MetricTile';

export function DomainCard({ domain }: { domain: DomainCardT }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" data-testid={`domain-${domain.domain}`}>
          <Link href={`/domains/${domain.domain}`} className="hover:text-accent">{domain.label} →</Link>
        </h2>
        <Chip tone={domainTone(domain.status)}>{domain.status.replace(/_/g, ' ').toLowerCase()}</Chip>
      </div>
      <p className="mt-1 text-sm text-muted">{domain.summary}</p>
      {domain.evidence.length > 0 && domain.status !== 'STEADY' && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer select-none">Evidence</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {domain.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {domain.metrics.map((m) => (
          <MetricTile key={m.metricId} card={m} />
        ))}
      </div>
    </Card>
  );
}
