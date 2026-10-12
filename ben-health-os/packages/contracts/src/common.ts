import { z } from 'zod';

/** ISO-8601 timestamp with offset or Z. Stored as timestamptz; the original zone offset is preserved separately. */
export const IsoDateTimeSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO-8601 date-time');
/** Calendar date YYYY-MM-DD in the user's local zone. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
/** Zone offset like +02:00 / -05:00 / Z as reported by the source. */
export const ZoneOffsetSchema = z.string().regex(/^([+-]\d{2}:\d{2}|Z)$/, 'expected ±HH:MM or Z');
/** IANA time zone id. */
export const TimeZoneIdSchema = z.string().min(1).max(64);

export const UuidSchema = z.string().uuid();

export const DeviceSchema = z.object({
  type: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
