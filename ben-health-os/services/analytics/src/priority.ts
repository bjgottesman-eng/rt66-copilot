import { priorityRank } from '@bho/shared-config';

export { priorityRank };

export function sourceKey(connector: string, dataOrigin: string | null | undefined): string {
  return connector === 'health_connect' && dataOrigin ? `health_connect:${dataOrigin}` : connector;
}

/** True when `a` should be canonical over `b` for the metric class (lower rank wins; ties keep `a`). */
export function preferSource(metricClass: string, a: { connector: string; dataOrigin?: string | null }, b: { connector: string; dataOrigin?: string | null }): boolean {
  return priorityRank(metricClass, a.connector, a.dataOrigin) <= priorityRank(metricClass, b.connector, b.dataOrigin);
}
