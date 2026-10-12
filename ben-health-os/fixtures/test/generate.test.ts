import { describe, expect, it } from 'vitest';
import { HealthConnectIngestBatchSchema } from '@bho/contracts';
import { generateDemoDataset } from '../src/generate.js';

describe('synthetic demo dataset', () => {
  it('is deterministic for a seed and validates against the ingest contract', () => {
    const a = generateDemoDataset({ days: 20, detailedDays: 5, glucoseDays: 3 });
    const b = generateDemoDataset({ days: 20, detailedDays: 5, glucoseDays: 3 });
    expect(JSON.stringify(a.batches)).toBe(JSON.stringify(b.batches));
    for (const batch of a.batches) expect(() => HealthConnectIngestBatchSchema.parse(batch)).not.toThrow();
    expect(a.summary.total_records).toBeGreaterThan(500);
  });
  it('contains the deliberate scenario features', () => {
    const ds = generateDemoDataset({ days: 60, detailedDays: 10, glucoseDays: 7 });
    const types = new Map<string, number>();
    for (const b of ds.batches) for (const r of b.records) types.set(r.recordType, (types.get(r.recordType) ?? 0) + 1);
    expect(types.get('SleepSession')).toBeGreaterThan(50);
    expect(types.get('BloodPressure')).toBeGreaterThan(60);
    expect(types.get('BloodGlucose')).toBe(5 * 96 + 1); // 7 days minus 2-day gap, plus one future-dated sample
    expect(ds.summary.implausible_values).toBe(1);
    expect(ds.manualBloodPressure.length).toBeGreaterThan(0);
    // ring-off days produce no RHR
    const rhrDates = new Set(ds.batches.flatMap((b) => b.records.filter((r) => r.recordType === 'RestingHeartRate').map((r) => r.hcId)));
    expect(rhrDates.size).toBe(60 - 4);
  });
});
