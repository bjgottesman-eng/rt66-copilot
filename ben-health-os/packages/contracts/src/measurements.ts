import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common.js';
import { ConnectorIdSchema } from './enums.js';

export const ArmSchema = z.enum(['LEFT', 'RIGHT', 'UNKNOWN']);
export const PostureSchema = z.enum(['SEATED', 'STANDING', 'LYING', 'RECLINING', 'UNKNOWN']);

/** Manual entry is optional; the normal workflow is Withings cuff → cloud → backend. */
export const ManualBloodPressureInputSchema = z.object({
  systolic: z.number().int().min(50).max(260),
  diastolic: z.number().int().min(30).max(160),
  pulse: z.number().int().min(25).max(220).nullable().optional(),
  measuredAt: IsoDateTimeSchema,
  arm: ArmSchema.default('UNKNOWN'),
  posture: PostureSchema.default('SEATED'),
  seatedRestMinutes: z.number().int().min(0).max(60).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  /** Group multiple readings into one session; server creates one when absent. */
  sessionId: UuidSchema.nullable().optional(),
  /** Idempotency key supplied by the client so retries never create duplicates. */
  clientEntryId: z.string().min(8).max(100),
}).superRefine((v, ctx) => {
  if (v.diastolic >= v.systolic) ctx.addIssue({ code: 'custom', message: 'diastolic must be lower than systolic' });
});
export type ManualBloodPressureInput = z.infer<typeof ManualBloodPressureInputSchema>;

export const BloodPressureReadingSchema = z.object({
  id: UuidSchema,
  sessionId: UuidSchema.nullable(),
  measuredAt: IsoDateTimeSchema,
  systolic: z.number(),
  diastolic: z.number(),
  pulse: z.number().nullable(),
  arm: ArmSchema,
  posture: PostureSchema,
  seatedRestMinutes: z.number().nullable(),
  notes: z.string().nullable(),
  connector: ConnectorIdSchema,
  dataOrigin: z.string().nullable(),
  deviceLabel: z.string().nullable(),
  canonical: z.boolean(),
  duplicateOf: UuidSchema.nullable(),
});
export type BloodPressureReading = z.infer<typeof BloodPressureReadingSchema>;

export const ManualBodyMeasurementInputSchema = z.object({
  metricId: z.enum(['weight', 'body_fat_pct', 'waist_cm', 'lean_mass_kg']),
  value: z.number().finite(),
  measuredAt: IsoDateTimeSchema,
  notes: z.string().max(500).nullable().optional(),
  clientEntryId: z.string().min(8).max(100),
});
export type ManualBodyMeasurementInput = z.infer<typeof ManualBodyMeasurementInputSchema>;

export const BloodPressureSummarySchema = z.object({
  latest: BloodPressureReadingSchema.nullable(),
  lastSyncAt: IsoDateTimeSchema.nullable(),
  avg7d: z.object({ systolic: z.number(), diastolic: z.number(), pulse: z.number().nullable(), n: z.number().int() }).nullable(),
  avg30d: z.object({ systolic: z.number(), diastolic: z.number(), pulse: z.number().nullable(), n: z.number().int() }).nullable(),
  morning: z.object({ systolic: z.number(), diastolic: z.number(), n: z.number().int() }).nullable(),
  evening: z.object({ systolic: z.number(), diastolic: z.number(), n: z.number().int() }).nullable(),
  sessions: z.array(z.object({ sessionId: UuidSchema.nullable(), startedAt: IsoDateTimeSchema, n: z.number().int(), systolic: z.number(), diastolic: z.number(), pulse: z.number().nullable(), rule: z.string() })),
  readings: z.array(BloodPressureReadingSchema),
  targets: z.object({ systolicMax: z.number(), diastolicMax: z.number(), source: z.string(), clinicianConfigured: z.boolean() }),
  notes: z.array(z.string()),
});
export type BloodPressureSummary = z.infer<typeof BloodPressureSummarySchema>;
