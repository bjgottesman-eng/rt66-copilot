import { z } from 'zod';
import { DeviceSchema, IsoDateTimeSchema, TimeZoneIdSchema, ZoneOffsetSchema } from './common.js';
import { HealthConnectRecordTypeSchema, RecordingMethodSchema } from './enums.js';

const num = z.number().finite();
const nonNeg = z.number().finite().min(0);

/** Per-record-type payloads. Units are the canonical units in docs/data-model.md. */
export const HealthConnectPayloadSchemas = {
  Steps: z.object({ count: z.number().int().min(0) }),
  Distance: z.object({ meters: nonNeg }),
  HeartRate: z.object({ samples: z.array(z.object({ time: IsoDateTimeSchema, bpm: z.number().int().min(1).max(300) })).min(1) }),
  RestingHeartRate: z.object({ bpm: z.number().int().min(1).max(300) }),
  HeartRateVariabilityRmssd: z.object({ rmssdMs: num.min(0) }),
  SleepSession: z.object({
    title: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    stages: z
      .array(z.object({ startTime: IsoDateTimeSchema, endTime: IsoDateTimeSchema, stage: z.number().int().min(0).max(7) }))
      .default([]),
  }),
  BloodPressure: z.object({
    systolicMmHg: num.min(20).max(300),
    diastolicMmHg: num.min(10).max(200),
    bodyPosition: z.number().int().nullable().optional(),
    measurementLocation: z.number().int().nullable().optional(),
  }),
  Weight: z.object({ kg: num.min(1).max(500) }),
  BodyFat: z.object({ percentage: num.min(0).max(100) }),
  LeanBodyMass: z.object({ kg: num.min(1).max(400) }),
  Height: z.object({ meters: num.min(0.3).max(3) }),
  BloodGlucose: z.object({
    mgPerDl: num.min(5).max(1000),
    mmolPerL: num.optional(),
    specimenSource: z.number().int().nullable().optional(),
    mealType: z.number().int().nullable().optional(),
    relationToMeal: z.number().int().nullable().optional(),
  }),
  Nutrition: z.object({
    name: z.string().nullable().optional(),
    mealType: z.number().int().nullable().optional(),
    energyKcal: nonNeg.nullable().optional(),
    proteinG: nonNeg.nullable().optional(),
    carbsG: nonNeg.nullable().optional(),
    totalFatG: nonNeg.nullable().optional(),
    saturatedFatG: nonNeg.nullable().optional(),
    fiberG: nonNeg.nullable().optional(),
    sodiumMg: nonNeg.nullable().optional(),
    potassiumMg: nonNeg.nullable().optional(),
    sugarG: nonNeg.nullable().optional(),
    extraNutrients: z.record(z.string(), num).optional(),
  }),
  Hydration: z.object({ liters: nonNeg }),
  ExerciseSession: z.object({
    exerciseType: z.number().int(),
    exerciseTypeName: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    segments: z.array(z.object({ startTime: IsoDateTimeSchema, endTime: IsoDateTimeSchema, segmentType: z.number().int(), repetitions: z.number().int().optional() })).optional(),
  }),
  RespiratoryRate: z.object({ rate: num.min(1).max(80) }),
  OxygenSaturation: z.object({ percentage: num.min(30).max(100) }),
  Vo2Max: z.object({ mlPerKgPerMin: num.min(5).max(120), measurementMethod: z.number().int().nullable().optional() }),
  ActiveCaloriesBurned: z.object({ kcal: nonNeg }),
  TotalCaloriesBurned: z.object({ kcal: nonNeg }),
  BodyTemperature: z.object({ celsius: num.min(25).max(45), measurementLocation: z.number().int().nullable().optional() }),
  SkinTemperature: z.object({ deltaCelsius: num.min(-10).max(10).nullable().optional(), baselineCelsius: num.nullable().optional() }),
} as const;

export const HealthConnectRecordSchema = z
  .object({
    recordType: HealthConnectRecordTypeSchema,
    /** Health Connect record UID (Metadata.id). */
    hcId: z.string().min(1).max(200),
    /** Android package that wrote the record (Metadata.dataOrigin.packageName). */
    dataOrigin: z.string().min(1).max(200),
    lastModifiedTime: IsoDateTimeSchema,
    clientRecordId: z.string().max(200).nullable().optional(),
    clientRecordVersion: z.number().int().nullable().optional(),
    device: DeviceSchema.nullable().optional(),
    recordingMethod: RecordingMethodSchema.default('UNKNOWN'),
    /** Interval records */
    startTime: IsoDateTimeSchema.optional(),
    startZoneOffset: ZoneOffsetSchema.nullable().optional(),
    endTime: IsoDateTimeSchema.optional(),
    endZoneOffset: ZoneOffsetSchema.nullable().optional(),
    /** Instant records */
    time: IsoDateTimeSchema.optional(),
    zoneOffset: ZoneOffsetSchema.nullable().optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((r, ctx) => {
    const hasInterval = r.startTime !== undefined && r.endTime !== undefined;
    const hasInstant = r.time !== undefined;
    if (!hasInterval && !hasInstant) {
      ctx.addIssue({ code: 'custom', message: 'record needs either time or startTime+endTime' });
    }
    if (hasInterval && Date.parse(r.endTime!) < Date.parse(r.startTime!)) {
      ctx.addIssue({ code: 'custom', message: 'endTime precedes startTime' });
    }
    const payloadSchema = HealthConnectPayloadSchemas[r.recordType];
    const parsed = payloadSchema.safeParse(r.payload);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: `invalid ${r.recordType} payload: ${parsed.error.issues.map((i) => i.message).join('; ')}` });
    }
  });
export type HealthConnectRecord = z.infer<typeof HealthConnectRecordSchema>;

export const HealthConnectDeletionSchema = z.object({
  hcId: z.string().min(1),
  recordType: HealthConnectRecordTypeSchema.optional(),
});

export const PermissionStateSchema = z.object({
  permission: z.string(),
  granted: z.boolean(),
});

export const HealthConnectIngestBatchSchema = z.object({
  source: z.literal('health_connect'),
  /** Stable per-install identifier generated by the app (not a hardware id). */
  deviceInstanceId: z.string().min(8).max(100),
  deviceLabel: z.string().max(120).optional(),
  appVersion: z.string().max(40),
  /** Time zone of the device at upload time. */
  timeZone: TimeZoneIdSchema,
  clientTime: IsoDateTimeSchema,
  /** Which sync mode produced this batch. */
  mode: z.enum(['INITIAL_BACKFILL', 'HISTORY_BACKFILL', 'CHANGES', 'MANUAL_REFRESH', 'DEMO']),
  /** Change-token bookkeeping per record type (opaque to the server; persisted for the device). */
  changeTokens: z.record(z.string(), z.string()).optional(),
  permissions: z.array(PermissionStateSchema).optional(),
  records: z.array(HealthConnectRecordSchema).max(2000),
  deletions: z.array(HealthConnectDeletionSchema).max(2000).default([]),
});
export type HealthConnectIngestBatch = z.infer<typeof HealthConnectIngestBatchSchema>;

export const IngestResultSchema = z.object({
  batchId: z.string(),
  serverTime: IsoDateTimeSchema,
  received: z.number().int(),
  inserted: z.number().int(),
  updated: z.number().int(),
  unchangedDuplicates: z.number().int(),
  crossSourceDuplicates: z.number().int(),
  deleted: z.number().int(),
  rejected: z.array(z.object({ index: z.number().int(), hcId: z.string().optional(), reason: z.string() })),
  /** Observation counts after this batch, by metric id (used by the app for the local cache summary). */
  observationCounts: z.record(z.string(), z.number().int()),
});
export type IngestResult = z.infer<typeof IngestResultSchema>;
