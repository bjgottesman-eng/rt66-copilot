import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CronometerImportResultSchema, GlucoseDayResponseSchema, NutritionDaysResponseSchema, RepeatedMealsResponseSchema, AnnotationSchema } from '@bho/contracts';
import { login, testApp, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await testApp();
});
afterAll(async () => {
  await app.close();
});

const NOW = new Date();
const hcBatch = (records: unknown[], timeZone: string) => ({ source: 'health_connect', deviceInstanceId: 'test-device-00000004', appVersion: 't', timeZone, clientTime: NOW.toISOString(), mode: 'CHANGES', records, deletions: [] });

describe('Phase 4: Cronometer CSV import and nutrition days', () => {
  it('reviews, imports idempotently, supersedes changed days, dedups against Health Connect Cronometer meals and rolls up days', async () => {
    const { auth } = await login(app, uniqueEmail('nutrition'));
    await app.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { timeZone: 'America/New_York', nutritionTargets: { protein_g: 150, fiber_g: 30, sodium_mg_max: 2300, source: 'Set by the user for testing' } } });
    const D = '2026-10-05';
    const D2 = '2026-10-06';
    // The Cronometer app shared the same lunch through Health Connect (12:00 local, UTC-4)
    const hcMeal = { recordType: 'Nutrition', hcId: 'hc-meal-lunch', dataOrigin: 'com.cronometer.android.gold', lastModifiedTime: `${D}T17:00:00Z`, recordingMethod: 'MANUAL_ENTRY', startTime: `${D}T16:00:00Z`, endTime: `${D}T16:20:00Z`, startZoneOffset: '-04:00', endZoneOffset: '-04:00', payload: { name: 'Lunch', mealType: 2, energyKcal: 600, proteinG: 40 } };
    const ing = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: hcBatch([hcMeal], 'America/New_York') });
    expect(ing.statusCode).toBe(200);
    const before = NutritionDaysResponseSchema.parse((await app.inject({ method: 'GET', url: `/v1/nutrition/days?from=${D}&to=${D2}`, headers: auth })).json());
    expect(before.days).toHaveLength(1);
    expect(before.days[0]!.totals.calories).toBe(600);
    expect(before.days[0]!.sources).toEqual(['health_connect:com.cronometer.android.gold']);

    const csv = [
      'Day,Time,Group,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g),Fiber (g),Sodium (mg),Potassium (mg),Vitamin C (mg)',
      `${D},08:10,Breakfast,Oats,80 g,300,10,54,6,8,150,300,0`,
      `${D},08:10,Breakfast,Greek yogurt,170 g,150,17,8,5,0,60,240,0`,
      `${D},7:30 PM,Dinner,Salmon,200 g,410,46,0,24,0,120,700,2`,
      `${D2},12:30,Lunch,Chicken salad,1 bowl,520,42,20,28,6,900,800,30`,
    ].join('\n');
    // Dry run: mapping for review, nothing written
    const dry = CronometerImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/cronometer', headers: auth, payload: { csv, fileName: 'servings.csv', dryRun: true } })).json());
    expect(dry.dryRun).toBe(true);
    expect(dry.mapping.format).toBe('SERVINGS');
    expect(dry.mapping.metricColumns).toMatchObject({ calories: 'Energy (kcal)', protein_g: 'Protein (g)', fiber_g: 'Fiber (g)' });
    expect(dry.mapping.extraNutrientColumns).toEqual(['Vitamin C (mg)']);
    expect(dry).toMatchObject({ rows: 4, meals: 3, days: 2, firstDay: D, lastDay: D2, ingest: null });
    const stillOne = NutritionDaysResponseSchema.parse((await app.inject({ method: 'GET', url: `/v1/nutrition/days?from=${D}&to=${D2}`, headers: auth })).json());
    expect(stillOne.days).toHaveLength(1);

    // Real import: 3 meals inserted, the Health Connect lunch is linked (not summed)
    const first = CronometerImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/cronometer', headers: auth, payload: { csv, fileName: 'servings.csv' } })).json());
    expect(first.ingest).toMatchObject({ inserted: 3, updated: 0, unchangedDuplicates: 0, rejected: [] });
    expect(first.healthConnectDuplicatesLinked).toBe(1);
    const days = NutritionDaysResponseSchema.parse((await app.inject({ method: 'GET', url: `/v1/nutrition/days?from=${D}&to=${D2}`, headers: auth })).json());
    expect(days.days.map((d) => d.date)).toEqual([D, D2]);
    const d1 = days.days[0]!;
    expect(d1.totals.calories).toBe(860);
    expect(d1.totals.protein_g).toBe(73);
    expect(d1.mealsCount).toBe(2);
    expect(d1.sources).toEqual(['cronometer']);
    expect(d1.meals.find((m) => m.source.startsWith('health_connect'))!.canonical).toBe(false);
    expect(d1.meals.filter((m) => m.canonical).map((m) => m.name)).toEqual(['Breakfast', 'Dinner']);
    expect(new Date(d1.meals.find((m) => m.name === 'Dinner')!.eatenAt).toISOString()).toBe(`${D}T23:30:00.000Z`); // 7:30 PM EDT
    expect(days.days[1]!.totals.calories).toBe(520);
    expect(days.targets).toMatchObject({ protein_g: 150, sodium_mg_max: 2300 });
    expect(days.mean7d.calories).toBe(690);
    expect(days.daysWithData7d).toBe(2);

    // Same file again: nothing changes
    const again = CronometerImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/cronometer', headers: auth, payload: { csv } })).json());
    expect(again.ingest).toMatchObject({ inserted: 0, updated: 0, unchangedDuplicates: 3 });
    expect(again.healthConnectDuplicatesLinked).toBe(0);

    // A newer export with a corrected dinner supersedes that meal only
    const updated = CronometerImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/cronometer', headers: auth, payload: { csv: csv.replace('410,46,0,24', '450,46,0,28') } })).json());
    expect(updated.ingest).toMatchObject({ inserted: 0, updated: 1, unchangedDuplicates: 2 });
    const after = NutritionDaysResponseSchema.parse((await app.inject({ method: 'GET', url: `/v1/nutrition/days?from=${D}&to=${D}`, headers: auth })).json());
    expect(after.days[0]!.totals.calories).toBe(900);

    // A daily-summary export for the same day is linked to the itemised meals, not added
    const daily = `Date,Energy (kcal),Protein (g),Carbs (g),Completed\n${D},1000,80,100,true`;
    const summary = CronometerImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/cronometer', headers: auth, payload: { csv: daily } })).json());
    expect(summary.mapping.format).toBe('DAILY_SUMMARY');
    expect(summary.ingest!.inserted).toBe(1);
    const withSummary = NutritionDaysResponseSchema.parse((await app.inject({ method: 'GET', url: `/v1/nutrition/days?from=${D}&to=${D}`, headers: auth })).json());
    expect(withSummary.days[0]!.totals.calories).toBe(900);
    expect(withSummary.days[0]!.meals.find((m) => m.mealType === 'DAILY_SUMMARY')!.canonical).toBe(false);

    // The import connector is reported honestly and the dashboard uses the deduplicated daily total
    const sources = (await app.inject({ method: 'GET', url: '/v1/sources', headers: auth })).json() as { sources: Array<{ connectorId: string; connectionStatus: string }> };
    expect(sources.sources.find((s) => s.connectorId === 'cronometer')!.connectionStatus).toBe('CONNECTED');
    const today = (await app.inject({ method: 'GET', url: '/v1/dashboard/today', headers: auth })).json() as { domains: Array<{ metrics: Array<{ metricId: string; latest: { value: number } | null }> }> };
    const calories = today.domains.flatMap((d) => d.metrics).find((m) => m.metricId === 'calories');
    if (calories?.latest) expect(calories.latest.value).toBe(520);

    // Unrecognised layouts are refused without side effects; garbage is rejected by the schema
    const unknown = CronometerImportResultSchema.parse((await app.inject({ method: 'POST', url: '/v1/imports/cronometer', headers: auth, payload: { csv: 'foo,bar\n1,2' } })).json());
    expect(unknown.mapping.format).toBe('UNKNOWN');
    expect(unknown.ingest).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/v1/imports/cronometer', headers: auth, payload: { nope: true } })).statusCode).toBe(400);
  });
});

describe('Phase 4: glucose day analytics and annotations', () => {
  const G = '2026-10-04';
  const G0 = '2026-10-03';
  function glucoseRecords(day: string, prefix: string): unknown[] {
    const out: unknown[] = [];
    for (let i = 0; i < 96; i++) {
      const h = Math.floor(i / 4);
      const m = (i % 4) * 15;
      let v = 95;
      if (h < 6) v = 88;
      if (h >= 13 && h < 15) v = 95 + 40 * Math.exp(-((h + m / 60 - 14) ** 2) / 0.15);
      if (i === 70) v = 150;
      const t = `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
      out.push({ recordType: 'BloodGlucose', hcId: `${prefix}-${i}`, dataOrigin: 'com.dexcom.stelo', lastModifiedTime: t, recordingMethod: 'AUTOMATICALLY_RECORDED', time: t, zoneOffset: 'Z', payload: { mgPerDl: Math.round(v), specimenSource: 1, relationToMeal: 0 } });
    }
    out.push({ recordType: 'Nutrition', hcId: `${prefix}-lunch`, dataOrigin: 'com.cronometer.android.gold', lastModifiedTime: `${day}T13:30:00Z`, recordingMethod: 'MANUAL_ENTRY', startTime: `${day}T13:00:00Z`, endTime: `${day}T13:20:00Z`, startZoneOffset: 'Z', endZoneOffset: 'Z', payload: { name: 'Lunch', mealType: 2, energyKcal: 650, proteinG: 45 } });
    return out;
  }

  it('computes day statistics, time in range, excursions around meals, honours annotations and surfaces Stelo latency', async () => {
    const { auth } = await login(app, uniqueEmail('glucose'));
    await app.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { timeZone: 'UTC', glucoseRange: { lowMgDl: 70, highMgDl: 140, source: 'Range set with clinician (test)' } } });
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: auth })).json() as { glucoseRange?: { lowMgDl: number; source?: string } };
    expect(me.glucoseRange).toMatchObject({ lowMgDl: 70, source: 'Range set with clinician (test)' });
    const records = [
      ...glucoseRecords(G, 'g'),
      { recordType: 'BloodGlucose', hcId: 'g-implausible', dataOrigin: 'com.dexcom.stelo', lastModifiedTime: `${G}T10:00:00Z`, recordingMethod: 'AUTOMATICALLY_RECORDED', time: `${G}T10:07:00Z`, zoneOffset: 'Z', payload: { mgPerDl: 900, specimenSource: 1, relationToMeal: 0 } },
      { recordType: 'ExerciseSession', hcId: 'g-run', dataOrigin: 'com.sec.android.app.shealth', lastModifiedTime: `${G}T18:00:00Z`, recordingMethod: 'ACTIVELY_RECORDED', startTime: `${G}T17:00:00Z`, endTime: `${G}T17:45:00Z`, startZoneOffset: 'Z', endZoneOffset: 'Z', payload: { exerciseType: 56, exerciseTypeName: 'RUNNING', title: 'Evening run', notes: null } },
    ];
    const ing = await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: hcBatch(records, 'UTC') });
    expect(ing.statusCode).toBe(200);
    expect(ing.json().rejected).toEqual([]);

    const day = GlucoseDayResponseSchema.parse((await app.inject({ method: 'GET', url: `/v1/glucose/day?date=${G}`, headers: auth })).json());
    expect(day.range).toMatchObject({ lowMgDl: 70, highMgDl: 140 });
    expect(day.stats.n).toBe(96); // the implausible 900 mg/dL sample is excluded, not silently averaged
    expect(day.stats.overnightMean).toBe(88);
    expect(day.stats.timeInRangePct).toBeGreaterThan(95);
    expect(day.stats.timeAbovePct).toBeGreaterThan(0);
    expect(day.stats.intervalMinutes).toBe(15);
    expect(day.meals).toHaveLength(1);
    expect(day.excursions[0]).toMatchObject({ label: 'Lunch', baselineMgDl: 95, minutesToPeak: 60, confidence: 'HIGH' });
    expect(day.excursions[0]!.peakDeltaMgDl).toBe(40);
    expect(day.workouts).toEqual([{ startAt: `${G}T17:00:00.000Z`, endAt: `${G}T17:45:00.000Z`, label: 'Evening run' }]);
    expect(day.freshness.expectedSourceLatencyHours).toBe(3);
    expect(day.freshness.latestSampleAt).toBe(`${G}T23:45:00.000Z`);
    expect(day.freshness.note).toMatch(/beyond the expected 3 h/);
    expect(day.datesWithData).toEqual([G]);
    expect(day.disclaimer).toMatch(/not a diagnosis/);

    // Default day = latest day with samples
    const latest = GlucoseDayResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/glucose/day', headers: auth })).json());
    expect(latest.date).toBe(G);
    // A day without samples is reported empty, not zero
    const empty = GlucoseDayResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/glucose/day?date=2026-01-01', headers: auth })).json());
    expect(empty.stats.n).toBe(0);
    expect(empty.stats.mean).toBeNull();

    // Annotations: a late meal adds an excursion; validation and deletion
    const created = await app.inject({ method: 'POST', url: '/v1/annotations', headers: auth, payload: { kind: 'MEAL', at: `${G}T19:00:00Z`, label: 'Pizza' } });
    expect(created.statusCode).toBe(201);
    const ann = AnnotationSchema.parse(created.json());
    expect(ann.localDate).toBe(G);
    expect((await app.inject({ method: 'POST', url: '/v1/annotations', headers: auth, payload: { kind: 'EXERCISE', at: `${G}T19:00:00Z`, endAt: `${G}T18:00:00Z`, label: 'bad' } })).statusCode).toBe(400);
    const withAnn = GlucoseDayResponseSchema.parse((await app.inject({ method: 'GET', url: `/v1/glucose/day?date=${G}`, headers: auth })).json());
    expect(withAnn.annotations).toHaveLength(1);
    expect(withAnn.meals.map((m) => m.label)).toEqual(['Lunch', 'Pizza']);
    expect(withAnn.excursions).toHaveLength(2);
    const listed = (await app.inject({ method: 'GET', url: `/v1/annotations?from=${G}&to=${G}`, headers: auth })).json() as { annotations: unknown[] };
    expect(listed.annotations).toHaveLength(1);

    // Repeated meals across days
    await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: hcBatch(glucoseRecords(G0, 'h'), 'UTC') });
    const rep = RepeatedMealsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/glucose/repeated-meals?days=90', headers: auth })).json());
    expect(rep.meals[0]).toMatchObject({ label: 'lunch', occurrences: 2 });
    expect(rep.meals[0]!.days.sort()).toEqual([G0, G]);
    expect(rep.meals[0]!.meanPeakDelta).toBe(40);

    expect((await app.inject({ method: 'DELETE', url: `/v1/annotations/${ann.id}`, headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/v1/annotations/${ann.id}`, headers: auth })).statusCode).toBe(404);
    // Another user cannot see or delete these rows
    const other = await login(app, uniqueEmail('glucose-other'));
    expect(GlucoseDayResponseSchema.parse((await app.inject({ method: 'GET', url: `/v1/glucose/day?date=${G}`, headers: other.auth })).json()).stats.n).toBe(0);
  });
});
