import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common.js';
import { IngestResultSchema } from './ingest.js';

export const CronometerImportRequestSchema = z.object({
  csv: z.string().min(1).max(7 * 1024 * 1024),
  fileName: z.string().max(200).optional(),
  /** When true, parse and report the detected mapping without writing anything. */
  dryRun: z.boolean().default(false),
});
export type CronometerImportRequest = z.infer<typeof CronometerImportRequestSchema>;

export const CronometerImportResultSchema = z.object({
  fileHash: z.string(),
  dryRun: z.boolean(),
  mapping: z.object({
    format: z.enum(['DAILY_SUMMARY', 'SERVINGS', 'UNKNOWN']),
    dayColumn: z.string().nullable(),
    timeColumn: z.string().nullable(),
    groupColumn: z.string().nullable(),
    foodColumn: z.string().nullable(),
    amountColumn: z.string().nullable(),
    completedColumn: z.string().nullable(),
    metricColumns: z.record(z.string(), z.string()),
    extraNutrientColumns: z.array(z.string()),
    ignoredColumns: z.array(z.string()),
  }),
  rows: z.number().int(),
  days: z.number().int(),
  meals: z.number().int(),
  firstDay: IsoDateSchema.nullable(),
  lastDay: IsoDateSchema.nullable(),
  warnings: z.array(z.string()),
  ingest: IngestResultSchema.nullable(),
  /** Health Connect nutrition rows from the Cronometer app that were marked as duplicates of CSV days. */
  healthConnectDuplicatesLinked: z.number().int(),
});
export type CronometerImportResult = z.infer<typeof CronometerImportResultSchema>;

export const NutritionTotalsSchema = z.object({
  calories: z.number().nullable(),
  protein_g: z.number().nullable(),
  carbs_g: z.number().nullable(),
  fat_g: z.number().nullable(),
  saturated_fat_g: z.number().nullable(),
  fiber_g: z.number().nullable(),
  sodium_mg: z.number().nullable(),
  potassium_mg: z.number().nullable(),
});

export const NutritionDaySchema = z.object({
  date: IsoDateSchema,
  totals: NutritionTotalsSchema,
  mealsCount: z.number().int(),
  sources: z.array(z.string()),
  meals: z.array(z.object({ id: UuidSchema, eatenAt: IsoDateTimeSchema, name: z.string().nullable(), mealType: z.string().nullable(), calories: z.number().nullable(), protein_g: z.number().nullable(), source: z.string(), canonical: z.boolean() })),
});

export const NutritionTargetsSchema = z.object({
  calories: z.number().positive().optional(),
  protein_g: z.number().positive().optional(),
  carbs_g: z.number().positive().optional(),
  fat_g: z.number().positive().optional(),
  saturated_fat_g_max: z.number().positive().optional(),
  fiber_g: z.number().positive().optional(),
  sodium_mg_max: z.number().positive().optional(),
  potassium_mg: z.number().positive().optional(),
  source: z.string().max(200).optional(),
});
export type NutritionTargets = z.infer<typeof NutritionTargetsSchema>;

export const NutritionDaysResponseSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  days: z.array(NutritionDaySchema),
  mean7d: NutritionTotalsSchema,
  daysWithData7d: z.number().int(),
  targets: NutritionTargetsSchema,
  notes: z.array(z.string()),
});
export type NutritionDaysResponse = z.infer<typeof NutritionDaysResponseSchema>;

export const GlucoseRangeSchema = z.object({ lowMgDl: z.number().min(40).max(200), highMgDl: z.number().min(60).max(400), source: z.string().max(200).optional() }).refine((r) => r.lowMgDl < r.highMgDl, 'low must be below high');

export const GlucoseDayResponseSchema = z.object({
  date: IsoDateSchema,
  timeZone: z.string(),
  range: GlucoseRangeSchema,
  samples: z.array(z.object({ t: IsoDateTimeSchema, mgDl: z.number(), source: z.string() })),
  stats: z.object({
    n: z.number().int(),
    mean: z.number().nullable(),
    sd: z.number().nullable(),
    cvPct: z.number().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    timeInRangePct: z.number().nullable(),
    timeBelowPct: z.number().nullable(),
    timeAbovePct: z.number().nullable(),
    overnightMean: z.number().nullable(),
    coverageHours: z.number(),
    intervalMinutes: z.number().nullable(),
  }),
  meals: z.array(z.object({ at: IsoDateTimeSchema, label: z.string(), source: z.string() })),
  workouts: z.array(z.object({ startAt: IsoDateTimeSchema, endAt: IsoDateTimeSchema, label: z.string() })),
  annotations: z.array(z.object({ id: UuidSchema, kind: z.string(), at: IsoDateTimeSchema, label: z.string() })),
  excursions: z.array(z.object({ mealAt: IsoDateTimeSchema, label: z.string(), baselineMgDl: z.number().nullable(), peakMgDl: z.number().nullable(), peakDeltaMgDl: z.number().nullable(), minutesToPeak: z.number().nullable(), iAuc2h: z.number().nullable(), samplesIn2h: z.number().int(), confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']) })),
  freshness: z.object({ latestSampleAt: IsoDateTimeSchema.nullable(), expectedSourceLatencyHours: z.number(), note: z.string() }),
  datesWithData: z.array(IsoDateSchema),
  disclaimer: z.string(),
});
export type GlucoseDayResponse = z.infer<typeof GlucoseDayResponseSchema>;

export const RepeatedMealsResponseSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  meals: z.array(z.object({ label: z.string(), occurrences: z.number().int(), meanPeakDelta: z.number().nullable(), meanIAuc: z.number().nullable(), days: z.array(IsoDateSchema) })),
  note: z.string(),
});

export const AnnotationInputSchema = z.object({
  kind: z.enum(['MEAL', 'EXERCISE', 'NOTE', 'MEDICATION_TAKEN', 'TAG']),
  at: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema.nullable().optional(),
  label: z.string().min(1).max(200),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type AnnotationInput = z.infer<typeof AnnotationInputSchema>;
export const AnnotationSchema = AnnotationInputSchema.extend({ id: UuidSchema, localDate: IsoDateSchema, createdAt: IsoDateTimeSchema, endAt: IsoDateTimeSchema.nullable(), details: z.record(z.string(), z.unknown()) });
export type Annotation = z.infer<typeof AnnotationSchema>;
export type RepeatedMealsResponse = z.infer<typeof RepeatedMealsResponseSchema>;
export type NutritionDay = z.infer<typeof NutritionDaySchema>;
export type NutritionTotals = z.infer<typeof NutritionTotalsSchema>;
export type GlucoseRange = z.infer<typeof GlucoseRangeSchema>;
