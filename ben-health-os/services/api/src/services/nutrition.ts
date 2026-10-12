/**
 * Cronometer CSV import (Phase 4). The file is parsed with header mapping, reviewed (dry run), then
 * persisted through the generic ingest pipeline: immutable raw events (one per meal), typed meal rows
 * with food items, nutrition observations, same-day dedup against the Cronometer app's Health Connect
 * records, and nutrition_days rollups. External ids are per day (+ diary group), so re-importing an
 * updated export supersedes changed days and leaves unchanged days untouched.
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { addDays, dayStartMs, defaultMealHour, formatOffset, mean, offsetMinutes, parseClockTime, parseCronometerCsv, plausibilityFlags, rowsToMeals, type CronometerFormat, type MealInput } from '@bho/analytics';
import { NutritionTargetsSchema, type CronometerImportRequest, type CronometerImportResult, type ExternalRecordInput, type NutritionDaysResponse, type NutritionTotals } from '@bho/contracts';
import { metricById } from '@bho/shared-config';
import { withUser } from '../db/pool.js';
import { ingestConnectorRecords } from './ingest.js';

export const CRONOMETER_CONNECTOR = 'cronometer';
const TOTAL_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'saturated_fat_g', 'fiber_g', 'sodium_mg', 'potassium_mg'] as const;

export function fileHashOf(csv: string): string {
  return createHash('sha256').update(csv).digest('hex').slice(0, 24);
}

function mealToRecord(meal: MealInput, format: CronometerFormat, timeZone: string): ExternalRecordInput {
  const clock = meal.time ? parseClockTime(meal.time) : null;
  const hour = clock?.hour ?? defaultMealHour(meal.mealType);
  const minute = clock?.minute ?? 0;
  const ms = dayStartMs(meal.day, timeZone) + (hour * 60 + minute) * 60_000;
  const eatenAt = new Date(ms).toISOString();
  const zoneOffset = formatOffset(offsetMinutes(ms, timeZone));
  const observations: ExternalRecordInput['normalized']['observations'] = [];
  for (const [metricId, value] of Object.entries(meal.metrics)) {
    const def = metricById(metricId);
    if (!def) continue;
    observations.push({ metricId, value, unit: def.unit, measuredAt: eatenAt, startAt: null, endAt: null, localDate: meal.day, zoneOffset, externalId: meal.externalId, qualityFlags: plausibilityFlags(metricId, value) });
  }
  const flags: string[] = [];
  if (meal.completed === true) flags.push('DAY_MARKED_COMPLETE');
  if (!clock && format !== 'DAILY_SUMMARY') flags.push('MEAL_TIME_ASSUMED');
  const m = meal.metrics;
  return {
    externalId: meal.externalId,
    recordType: format === 'DAILY_SUMMARY' ? 'CronometerDailySummary' : 'CronometerMeal',
    dataOrigin: null,
    recordingMethod: 'MANUAL_ENTRY',
    sourceModifiedAt: null,
    originalTime: eatenAt,
    originalZoneOffset: zoneOffset,
    // The payload is the CSV content for this meal only (no file hash, no row numbers) so an unchanged
    // day in a newer export hashes identically and is recognised as unchanged.
    rawPayload: { kind: 'cronometer_csv', format, day: meal.day, time: meal.time, group: meal.name, mealType: meal.mealType, completed: meal.completed, metrics: meal.metrics, nutrients: meal.nutrients, foodItems: meal.foodItems },
    normalized: {
      observations,
      meal: {
        externalId: meal.externalId,
        eatenAt,
        endAt: null,
        localDate: meal.day,
        mealType: meal.mealType,
        name: meal.name,
        energyKcal: m.calories ?? null,
        proteinG: m.protein_g ?? null,
        carbsG: m.carbs_g ?? null,
        fatG: m.fat_g ?? null,
        saturatedFatG: m.saturated_fat_g ?? null,
        fiberG: m.fiber_g ?? null,
        sodiumMg: m.sodium_mg ?? null,
        potassiumMg: m.potassium_mg ?? null,
        sugarG: m.sugar_g ?? null,
        nutrients: meal.nutrients,
        foodItems: meal.foodItems,
        qualityFlags: flags,
      },
      notes: [],
    },
  };
}

export async function importCronometerCsv(pool: pg.Pool, userId: string, req: CronometerImportRequest, now: Date = new Date()): Promise<CronometerImportResult> {
  const fileHash = fileHashOf(req.csv);
  const { mapping, rows, warnings } = parseCronometerCsv(req.csv);
  const meals = mapping.format === 'UNKNOWN' ? [] : rowsToMeals(rows, mapping);
  const days = [...new Set(meals.map((m) => m.day))].sort();
  const base: CronometerImportResult = {
    fileHash,
    dryRun: req.dryRun,
    mapping: { format: mapping.format, dayColumn: mapping.dayColumn, timeColumn: mapping.timeColumn, groupColumn: mapping.groupColumn, foodColumn: mapping.foodColumn, amountColumn: mapping.amountColumn, completedColumn: mapping.completedColumn, metricColumns: mapping.metricColumns, extraNutrientColumns: mapping.extraNutrientColumns, ignoredColumns: mapping.ignoredColumns },
    rows: rows.length,
    days: days.length,
    meals: meals.length,
    firstDay: days[0] ?? null,
    lastDay: days[days.length - 1] ?? null,
    warnings: [...warnings],
    ingest: null,
    healthConnectDuplicatesLinked: 0,
  };
  if (mapping.format === 'UNKNOWN') {
    base.warnings.push('Unrecognised layout: expected a Day/Date column plus nutrient columns (daily summary export) or a Food Name column (servings/diary export). Nothing was imported.');
    return base;
  }
  if (Object.keys(mapping.metricColumns).length === 0) base.warnings.push('No nutrient columns recognised (energy, protein, carbs, fat, fiber, sodium, potassium); meals would import without totals.');
  if (req.dryRun || meals.length === 0) return base;

  const timeZone = await withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ time_zone: string }>('select time_zone from public.profiles where id = $1', [userId]);
    return r.rows[0]?.time_zone ?? 'UTC';
  });
  const records = meals.map((m) => mealToRecord(m, mapping.format, timeZone));
  const beforeLinked = await countLinkedHcMeals(pool, userId, days);
  const ingest = await ingestConnectorRecords(
    pool,
    userId,
    CRONOMETER_CONNECTOR,
    {
      mode: 'FILE_IMPORT',
      records,
      cursors: { 'cronometer:last_file_hash': fileHash },
      runDetails: { fileName: req.fileName ?? null, fileHash, format: mapping.format, mapping: base.mapping, warnings: warnings.slice(0, 20), days: days.length },
    },
    now,
  );
  const afterLinked = await countLinkedHcMeals(pool, userId, days);
  return { ...base, ingest, healthConnectDuplicatesLinked: Math.max(0, afterLinked - beforeLinked) };
}

async function countLinkedHcMeals(pool: pg.Pool, userId: string, days: string[]): Promise<number> {
  if (days.length === 0) return 0;
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ n: number }>(`select count(*)::int as n from public.meals where user_id = $1 and connector <> $2 and not canonical and deleted_at is null and local_date = any($3::date[])`, [userId, CRONOMETER_CONNECTOR, days]);
    return Number(r.rows[0]?.n ?? 0);
  });
}

function emptyTotals(): NutritionTotals {
  return { calories: null, protein_g: null, carbs_g: null, fat_g: null, saturated_fat_g: null, fiber_g: null, sodium_mg: null, potassium_mg: null };
}

export async function nutritionDays(pool: pg.Pool, userId: string, from: string, to: string): Promise<NutritionDaysResponse> {
  return withUser(pool, userId, async (tx) => {
    const prof = await tx.query<{ nutrition_targets: unknown }>('select nutrition_targets from public.profiles where id = $1', [userId]);
    const parsedTargets = NutritionTargetsSchema.safeParse(prof.rows[0]?.nutrition_targets ?? {});
    const targets = parsedTargets.success ? parsedTargets.data : {};
    const dayRows = await tx.query<{ date: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; saturated_fat_g: number | null; fiber_g: number | null; sodium_mg: number | null; potassium_mg: number | null; meals_count: number; source: string | null }>(
      `select local_date::text as date, energy_kcal::float8 as calories, protein_g::float8 as protein_g, carbs_g::float8 as carbs_g, fat_g::float8 as fat_g, saturated_fat_g::float8 as saturated_fat_g, fiber_g::float8 as fiber_g,
              sodium_mg::float8 as sodium_mg, potassium_mg::float8 as potassium_mg, meals_count, source
       from public.nutrition_days where user_id = $1 and local_date between $2 and $3 order by local_date`,
      [userId, from, to],
    );
    const mealRows = await tx.query<{ id: string; eaten_at: Date; date: string; name: string | null; meal_type: string | null; calories: number | null; protein_g: number | null; connector: string; data_origin: string | null; canonical: boolean }>(
      `select id, eaten_at, local_date::text as date, name, meal_type, energy_kcal::float8 as calories, protein_g::float8 as protein_g, connector, data_origin, canonical
       from public.meals where user_id = $1 and deleted_at is null and local_date between $2 and $3 order by eaten_at`,
      [userId, from, to],
    );
    const mealsByDate = new Map<string, NutritionDaysResponse['days'][number]['meals']>();
    for (const m of mealRows.rows) {
      const list = mealsByDate.get(m.date) ?? [];
      list.push({ id: m.id, eatenAt: new Date(m.eaten_at).toISOString(), name: m.name, mealType: m.meal_type, calories: m.calories, protein_g: m.protein_g, source: m.connector + (m.data_origin ? `:${m.data_origin}` : ''), canonical: m.canonical });
      mealsByDate.set(m.date, list);
    }
    const days = dayRows.rows.map((r) => ({
      date: r.date,
      totals: { calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, saturated_fat_g: r.saturated_fat_g, fiber_g: r.fiber_g, sodium_mg: r.sodium_mg, potassium_mg: r.potassium_mg },
      mealsCount: r.meals_count,
      sources: (r.source ?? '').split(',').filter(Boolean),
      meals: mealsByDate.get(r.date) ?? [],
    }));
    const last7from = addDays(to, -6);
    const recent = days.filter((d) => d.date >= last7from);
    const mean7d = emptyTotals();
    for (const k of TOTAL_KEYS) mean7d[k] = mean(recent.map((d) => d.totals[k]).filter((v): v is number => v != null));
    const notes = [
      'Day totals sum canonical meals only. When the Cronometer CSV and the Cronometer app (via Health Connect) both cover a day, the CSV is canonical and the Health Connect meals are linked as duplicates, never added.',
      'Days without logged meals are missing, not zero; 7-day means use only days with data.',
      targets.source ? `Targets: ${targets.source}` : 'No targets set. Targets are yours or your clinician’s; none are suggested by the app.',
    ];
    return { from, to, days, mean7d, daysWithData7d: recent.length, targets, notes };
  });
}
