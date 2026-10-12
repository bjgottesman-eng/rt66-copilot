import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';
import { ConnectionStatusSchema, ConnectorIdSchema, ImplementationStatusSchema, IntegrationClassSchema, SyncStatusSchema } from './enums.js';

export const SourceDeviceSchema = z.object({
  id: z.string(),
  label: z.string(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  lastSeenAt: IsoDateTimeSchema.nullable(),
});

export const SourceStatusSchema = z.object({
  connectorId: ConnectorIdSchema,
  displayName: z.string(),
  integrationClass: IntegrationClassSchema,
  implementationStatus: ImplementationStatusSchema,
  connectionStatus: ConnectionStatusSchema,
  lastSuccessfulSyncAt: IsoDateTimeSchema.nullable(),
  lastSyncAttemptAt: IsoDateTimeSchema.nullable(),
  lastSyncStatus: SyncStatusSchema,
  lastError: z.string().nullable(),
  expectedSyncIntervalHours: z.number(),
  actualLatencyHours: z.number().nullable(),
  latestObservationAt: IsoDateTimeSchema.nullable(),
  observationCount: z.number().int(),
  coverageDays30: z.number().int(),
  availableMetrics: z.array(z.string()),
  missingPermissions: z.array(z.string()),
  grantedPermissions: z.array(z.string()),
  devices: z.array(SourceDeviceSchema),
  actions: z.array(z.enum(['connect', 'reconnect', 'refresh', 'disconnect', 'export', 'delete'])),
  notes: z.array(z.string()),
});
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SourcesResponseSchema = z.object({
  generatedAt: IsoDateTimeSchema,
  sources: z.array(SourceStatusSchema),
});
export type SourcesResponse = z.infer<typeof SourcesResponseSchema>;

/** Posted by the Android app after each Health Connect sync attempt (success or failure). */
export const HealthConnectSyncReportSchema = z.object({
  deviceInstanceId: z.string().min(8).max(100),
  deviceLabel: z.string().max(120).optional(),
  appVersion: z.string().max(40),
  attemptedAt: IsoDateTimeSchema,
  status: SyncStatusSchema,
  sdkStatus: z.enum(['SDK_AVAILABLE', 'SDK_UNAVAILABLE', 'SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED', 'UNKNOWN']),
  grantedPermissions: z.array(z.string()),
  requestedPermissions: z.array(z.string()),
  backgroundReadGranted: z.boolean().nullable(),
  historyReadGranted: z.boolean().nullable(),
  error: z.string().max(2000).nullable().optional(),
  recordsRead: z.number().int().min(0),
});
export type HealthConnectSyncReport = z.infer<typeof HealthConnectSyncReportSchema>;
