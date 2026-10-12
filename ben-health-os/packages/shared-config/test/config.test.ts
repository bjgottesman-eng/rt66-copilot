import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildConfigBundle } from '../src/bundle.js';
import { METRIC_CATALOG, CONNECTORS, SOURCE_PRIORITY, FRESHNESS_BY_METRIC, DEDUP_WINDOWS, priorityRank, thresholdsFor } from '../src/index.js';

describe('shared-config integrity', () => {
  it('generated JSON in ./config matches the TypeScript source (no drift)', () => {
    for (const [file, content] of Object.entries(buildConfigBundle())) {
      const onDisk = JSON.parse(readFileSync(join(__dirname, '..', 'config', file), 'utf8'));
      expect(onDisk, `${file} is stale — run pnpm --filter @bho/shared-config build`).toEqual(JSON.parse(JSON.stringify(content)));
    }
  });

  it('metric ids are unique and freshness overrides reference real metrics', () => {
    const ids = METRIC_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const key of Object.keys(FRESHNESS_BY_METRIC)) expect(ids, `freshness key ${key}`).toContain(key);
  });

  it('connector metric lists reference catalog metrics', () => {
    const ids = new Set(METRIC_CATALOG.map((m) => m.id));
    for (const c of CONNECTORS) for (const m of c.metrics) expect(ids.has(m), `${c.id} -> ${m}`).toBe(true);
  });

  it('every metric class used by the catalog has a source priority list or is a documented exception', () => {
    const classes = new Set(METRIC_CATALOG.map((m) => m.metricClass));
    const documentedWithoutPriority = new Set(['oura_score', 'temperature']);
    for (const cls of classes) {
      if (documentedWithoutPriority.has(cls)) continue;
      expect(SOURCE_PRIORITY[cls], `priority for ${cls}`).toBeDefined();
    }
    for (const cls of Object.keys(DEDUP_WINDOWS)) expect(DEDUP_WINDOWS[cls]!.windowSeconds).toBeGreaterThanOrEqual(0);
  });

  it('priorityRank prefers Withings API over Health Connect over manual for blood pressure', () => {
    const api = priorityRank('blood_pressure', 'withings');
    const hcWithings = priorityRank('blood_pressure', 'health_connect', 'com.withings.wiscale2');
    const hcOther = priorityRank('blood_pressure', 'health_connect', 'com.example.other');
    const manual = priorityRank('blood_pressure', 'manual');
    const unknown = priorityRank('blood_pressure', 'file_import');
    expect(api).toBeLessThan(hcWithings);
    expect(hcWithings).toBeLessThan(hcOther);
    expect(hcOther).toBeLessThan(manual);
    expect(manual).toBeLessThan(unknown);
  });

  it('thresholdsFor falls back to defaults and keeps monotonic ordering', () => {
    for (const m of METRIC_CATALOG) {
      const t = thresholdsFor(m.id);
      expect(t.currentWithinHours).toBeLessThanOrEqual(t.recentWithinHours);
      expect(t.recentWithinHours).toBeLessThanOrEqual(t.staleAfterHours);
    }
  });
});
