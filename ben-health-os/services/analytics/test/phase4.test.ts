import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/csv.js';
import { detectCronometerMapping, normalizeDay, parseClockTime, parseCronometerCsv, rowsToMeals } from '../src/nutrition.js';
import { glucoseDayStats, mealExcursion, repeatedMeals } from '../src/glucose.js';

describe('CSV parsing', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });
});

describe('Cronometer mapping', () => {
  const daily = `Date,Energy (kcal),Protein (g),Net Carbs (g),Fat (g),Saturated (g),Fiber (g),Sodium (mg),Potassium (mg),Vitamin C (mg),Completed
2026-10-10,2310,152,220,84,24,31,2550,3300,95,true
2026-10-11,2105,140,198,80,22,28,2400,3100,80,true`;
  it('detects a daily summary and maps nutrient columns by header', () => {
    const { mapping, rows, warnings } = parseCronometerCsv(daily);
    expect(mapping.format).toBe('DAILY_SUMMARY');
    expect(mapping.metricColumns).toMatchObject({ calories: 'Energy (kcal)', protein_g: 'Protein (g)', carbs_g: 'Net Carbs (g)', fat_g: 'Fat (g)', saturated_fat_g: 'Saturated (g)', fiber_g: 'Fiber (g)', sodium_mg: 'Sodium (mg)', potassium_mg: 'Potassium (mg)' });
    expect(mapping.extraNutrientColumns).toEqual(['Vitamin C (mg)']);
    expect(mapping.completedColumn).toBe('Completed');
    expect(mapping.ignoredColumns).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.metrics.calories).toBe(2105);
    expect(rows[1]!.nutrients['Vitamin C (mg)']).toBe(80);
    expect(warnings).toEqual([]);
    const meals = rowsToMeals(rows, mapping);
    expect(meals[0]).toMatchObject({ externalId: 'cronometer-csv:day:2026-10-10', mealType: 'DAILY_SUMMARY', completed: true });
  });
  it('groups servings rows into meals and skips total rows', () => {
    const servings = `Day,Time,Group,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g),Fiber (g)
10/11/2026,08:10,Breakfast,Oats,80 g,300,10,54,6,8
10/11/2026,08:10,Breakfast,Greek yogurt,170 g,150,17,8,5,0
10/11/2026,7:45 PM,Dinner,Salmon,200 g,410,46,0,24,0
10/11/2026,,,Totals,,860,73,62,35,8`;
    const { mapping, rows } = parseCronometerCsv(servings);
    expect(mapping.format).toBe('SERVINGS');
    expect(rows).toHaveLength(3);
    const meals = rowsToMeals(rows, mapping);
    expect(meals).toHaveLength(2);
    expect(meals[0]).toMatchObject({ name: 'Breakfast', mealType: 'BREAKFAST', time: '08:10', metrics: { calories: 450, protein_g: 27 } });
    expect(meals[0]!.foodItems.map((f) => f.name)).toEqual(['Oats', 'Greek yogurt']);
    expect(meals[1]!.externalId).toBe('cronometer-csv:2026-10-11:dinner');
    expect(parseClockTime(meals[1]!.time!)).toEqual({ hour: 19, minute: 45 });
    expect(parseClockTime('12:05 am')).toEqual({ hour: 0, minute: 5 });
    expect(parseClockTime('noon')).toBeNull();
  });
  it('normalises day formats and warns on unknown ones', () => {
    expect(normalizeDay('2026-1-5')).toBe('2026-01-05');
    expect(normalizeDay('10/11/2026')).toBe('2026-10-11');
    expect(normalizeDay('Oct 11, 2026')).toBe('2026-10-11');
    expect(normalizeDay('yesterday')).toBeNull();
    const { rows, warnings } = parseCronometerCsv('Date,Energy (kcal),Protein (g)\nnope,1,2');
    expect(rows).toHaveLength(0);
    expect(warnings[0]).toContain('unrecognised day');
    expect(detectCronometerMapping(['Foo', 'Bar']).format).toBe('UNKNOWN');
  });
});

describe('glucose analytics', () => {
  const day = (hour: number, minute: number) => `2026-10-11T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
  const samples = Array.from({ length: 96 }, (_, i) => {
    const h = Math.floor(i / 4);
    const m = (i % 4) * 15;
    let v = 95;
    if (h < 6) v = 88;
    if (h >= 13 && h < 15) v = 95 + 40 * Math.exp(-(((h + m / 60) - 14) ** 2) / 0.15);
    if (i === 70) v = 150;
    return { t: day(h, m), mgDl: Math.round(v) };
  });
  it('computes day stats with time in range and overnight mean', () => {
    const s = glucoseDayStats(samples, { lowMgDl: 70, highMgDl: 140 });
    expect(s.n).toBe(96);
    expect(s.overnightMean).toBe(88);
    expect(s.timeInRangePct).toBeGreaterThan(95);
    expect(s.timeAbovePct).toBeGreaterThan(0);
    expect(s.intervalMinutes).toBe(15);
    expect(s.coverageHours).toBeCloseTo(23.75);
    expect(glucoseDayStats([], { lowMgDl: 70, highMgDl: 140 }).n).toBe(0);
  });
  it('measures a post-meal excursion against the pre-meal baseline', () => {
    const e = mealExcursion(samples, { at: day(13, 0), label: 'Lunch' });
    expect(e.baselineMgDl).toBe(95);
    expect(e.peakDeltaMgDl).toBeGreaterThan(30);
    expect(e.minutesToPeak).toBe(60);
    expect(e.iAuc2h).toBeGreaterThan(500);
    expect(e.confidence).toBe('HIGH');
    expect(mealExcursion(samples.slice(0, 4), { at: day(13, 0), label: 'x' }).peakMgDl).toBeNull();
    const rep = repeatedMeals([{ ...e, day: '2026-10-11' }, { ...e, day: '2026-10-12', peakDeltaMgDl: 20 }, { ...e, label: 'Dinner', day: '2026-10-11' }]);
    expect(rep).toHaveLength(1);
    expect(rep[0]!.occurrences).toBe(2);
  });
});
