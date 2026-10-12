import { FRESHNESS_DEFAULTS, FRESHNESS_BY_METRIC, FRESHNESS_STATUSES } from './freshness.js';
import { CONNECTORS, HEALTH_CONNECT_ORIGINS, INTEGRATION_CLASSES } from './connectors.js';
import { SOURCE_PRIORITY } from './sourcePriority.js';
import { DEDUP_WINDOWS } from './dedup.js';
import { METRIC_CATALOG, LAB_ANALYTES, DOMAINS, DOMAIN_LABELS } from './metricCatalog.js';

/** Bump when the shape of the generated JSON changes; the Android app checks this at startup. */
export const SHARED_CONFIG_VERSION = 1;

export function buildConfigBundle(): Record<string, unknown> {
  return {
    'freshness.json': {
      version: SHARED_CONFIG_VERSION,
      statuses: FRESHNESS_STATUSES,
      defaults: FRESHNESS_DEFAULTS,
      metrics: FRESHNESS_BY_METRIC,
    },
    'connectors.json': {
      version: SHARED_CONFIG_VERSION,
      integrationClasses: INTEGRATION_CLASSES,
      connectors: CONNECTORS,
      healthConnectOrigins: HEALTH_CONNECT_ORIGINS,
    },
    'source-priority.json': { version: SHARED_CONFIG_VERSION, priority: SOURCE_PRIORITY },
    'dedup.json': { version: SHARED_CONFIG_VERSION, windows: DEDUP_WINDOWS },
    'metric-catalog.json': {
      version: SHARED_CONFIG_VERSION,
      domains: DOMAINS,
      domainLabels: DOMAIN_LABELS,
      metrics: METRIC_CATALOG,
      labAnalytes: LAB_ANALYTES,
    },
  };
}
