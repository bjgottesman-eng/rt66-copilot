import { z } from 'zod';
import { CONNECTOR_IDS, DOMAINS, FRESHNESS_STATUSES, IMPLEMENTATION_STATUSES, INTEGRATION_CLASSES } from '@bho/shared-config';

export const FreshnessStatusSchema = z.enum(FRESHNESS_STATUSES);
export type FreshnessStatus = z.infer<typeof FreshnessStatusSchema>;

export const IntegrationClassSchema = z.enum(INTEGRATION_CLASSES);
export type IntegrationClass = z.infer<typeof IntegrationClassSchema>;

export const ConnectorIdSchema = z.enum(CONNECTOR_IDS);
export type ConnectorId = z.infer<typeof ConnectorIdSchema>;

export const DomainSchema = z.enum(DOMAINS);
export type Domain = z.infer<typeof DomainSchema>;

/** Connection lifecycle. CONNECTED is only set after auth AND data retrieval both succeeded. */
export const ConnectionStatusSchema = z.enum([
  'NOT_CONFIGURED',
  'PENDING_AUTH',
  'CONNECTED',
  'PARTIAL',
  'EXPIRED',
  'REVOKED',
  'ERROR',
  'DISCONNECTED',
  'UNSUPPORTED',
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const SyncStatusSchema = z.enum(['NEVER', 'RUNNING', 'SUCCESS', 'PARTIAL', 'ERROR']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

/** Mirrors Health Connect Metadata.recordingMethod (0..3). */
export const RecordingMethodSchema = z.enum(['UNKNOWN', 'ACTIVELY_RECORDED', 'AUTOMATICALLY_RECORDED', 'MANUAL_ENTRY']);
export type RecordingMethod = z.infer<typeof RecordingMethodSchema>;

/** Domain-level status shown on the Today screen. There is deliberately no composite score. */
export const DomainStatusSchema = z.enum(['STEADY', 'IMPROVING', 'WATCH', 'ATTENTION', 'INSUFFICIENT_DATA', 'NOT_CONNECTED']);
export type DomainStatus = z.infer<typeof DomainStatusSchema>;

/** Classification of a change between the 7-day window and the preceding 28-day baseline. */
export const ChangeClassSchema = z.enum(['MEANINGFUL', 'DIRECTIONAL', 'NOISE', 'INSUFFICIENT_EVIDENCE']);
export type ChangeClass = z.infer<typeof ChangeClassSchema>;

/** Health Connect record types supported by the ingest endpoint (androidx.health.connect 1.1.0 names). */
export const HealthConnectRecordTypeSchema = z.enum([
  'Steps',
  'Distance',
  'HeartRate',
  'RestingHeartRate',
  'HeartRateVariabilityRmssd',
  'SleepSession',
  'BloodPressure',
  'Weight',
  'BodyFat',
  'LeanBodyMass',
  'Height',
  'BloodGlucose',
  'Nutrition',
  'Hydration',
  'ExerciseSession',
  'RespiratoryRate',
  'OxygenSaturation',
  'Vo2Max',
  'ActiveCaloriesBurned',
  'TotalCaloriesBurned',
  'BodyTemperature',
  'SkinTemperature',
]);
export type HealthConnectRecordType = z.infer<typeof HealthConnectRecordTypeSchema>;

/** Implementation status labels used in docs, status endpoints and the Data Sources screen. */
export const ImplementationStatusSchema = z.enum(IMPLEMENTATION_STATUSES);
export type ImplementationStatus = z.infer<typeof ImplementationStatusSchema>;
