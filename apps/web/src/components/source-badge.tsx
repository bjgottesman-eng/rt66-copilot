import type { BpSource } from '@benhealth/shared';

const LABELS: Record<BpSource, string> = {
  withings_api: 'Withings',
  apple_health: 'Apple Health',
  manual: 'Manual',
};

/** Small chip naming the reading's source system. */
export function SourceBadge({ source }: { source: BpSource }) {
  return <span className="badge">{LABELS[source]}</span>;
}
