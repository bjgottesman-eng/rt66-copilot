import { describe, expect, it } from 'vitest';
import { HealthConnectIngestBatchSchema } from '@bho/contracts';
import { parseCronometerCsv, parseLabCsv, rowsToMeals } from '@bho/analytics';
import { generateCronometerCsv, generateDemoDataset, generateLabCsv, generateCheckIns, generateTrainingSets } from '../src/generate.js';

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
  it('emits a Cronometer-style servings CSV that maps back to the same meals as the Health Connect diary', () => {
    const ds = generateDemoDataset({ days: 20, detailedDays: 5, glucoseDays: 3 });
    const csv = generateCronometerCsv(ds);
    const { mapping, rows, warnings } = parseCronometerCsv(csv);
    expect(mapping.format).toBe('SERVINGS');
    expect(mapping.metricColumns).toMatchObject({ calories: 'Energy (kcal)', protein_g: 'Protein (g)', sodium_mg: 'Sodium (mg)' });
    expect(warnings).toEqual([]);
    const meals = rowsToMeals(rows, mapping);
    expect(meals.length).toBe(ds.summary.meals_cronometer);
    expect(meals.every((m) => m.time !== null && m.foodItems.length >= 2)).toBe(true);
  });
  it('emits a synthetic Function-style lab export whose rows all map to catalog analytes with lab-reported flags', () => {
    const ds = generateDemoDataset({ days: 20, detailedDays: 5, glucoseDays: 3, endDate: '2026-10-11' });
    const { mapping, rows, warnings } = parseLabCsv(generateLabCsv(ds));
    expect(mapping.usable).toBe(true);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(36);
    expect(rows.every((r) => r.analyteId !== null && r.collectedAt !== null)).toBe(true);
    expect(rows.filter((r) => r.abnormalFlag === 'H' || r.abnormalFlag === 'L').length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.collectedAt)).size).toBe(3);
  });

  it('derives deterministic training sets and check-ins from the same dataset', () => {
    const ds = generateDemoDataset({ days: 60, seed: 3, endDate: '2026-10-11', timeZone: 'America/New_York' });
    const sets = generateTrainingSets(ds);
    const dates = [...new Set(sets.map((s) => s.localDate))];
    expect(dates.length).toBeGreaterThan(20); // Mon/Wed/Fri over 60 days
    expect(sets.length).toBe(dates.length * 9);
    expect(sets.every((s) => s.reps === 5 && s.loadKg >= 60 && s.setIndex >= 1 && s.setIndex <= 3)).toBe(true);
    expect(generateTrainingSets(ds)).toEqual(sets);
    const squatLoads = sets.filter((s) => s.exercise === 'Back squat' && s.setIndex === 1).map((s) => s.loadKg);
    expect(squatLoads[squatLoads.length - 1]!).toBeGreaterThan(squatLoads[0]!);
    const checkIns = generateCheckIns(ds);
    expect(checkIns).toHaveLength(28);
    expect(checkIns.every((c) => c.energy >= 1 && c.energy <= 10 && c.pain === 0)).toBe(true);
    expect(checkIns[checkIns.length - 1]!.at.startsWith('2026-10-11T07:30:00')).toBe(true);
  });
});
