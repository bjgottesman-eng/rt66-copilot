import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, TimeZoneIdSchema } from './common.js';
import { ChangeClassSchema, ConnectorIdSchema, DomainSchema, DomainStatusSchema, FreshnessStatusSchema } from './enums.js';

export const FreshnessInfoSchema = z.object({
  status: FreshnessStatusSchema,
  /** Human-readable explanation of the status (why a source is stale, what to do). */
  reason: z.string(),
  measuredAt: IsoDateTimeSchema.nullable(),
  sourceUpdatedAt: IsoDateTimeSchema.nullable(),
  ingestedAt: IsoDateTimeSchema.nullable(),
  expectedLatencyHours: z.number(),
  ageHours: z.number().nullable(),
});
export type FreshnessInfo = z.infer<typeof FreshnessInfoSchema>;

export const WindowStatsSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  /** Number of local days with at least one observation. */
  daysWithData: z.number().int(),
  days: z.number().int(),
  coverage: z.number().min(0).max(1),
  n: z.number().int(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  sd: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  /** Least-squares slope per day across daily values. */
  slopePerDay: z.number().nullable(),
});
export type WindowStats = z.infer<typeof WindowStatsSchema>;

export const BaselineComparisonSchema = z.object({
  current7d: WindowStatsSchema,
  baseline28d: WindowStatsSchema,
  delta: z.number().nullable(),
  deltaPct: z.number().nullable(),
  /** Effect size (Cohen's d against baseline SD) where computable. */
  effectSize: z.number().nullable(),
  changeClass: ChangeClassSchema,
  explanation: z.string(),
});
export type BaselineComparison = z.infer<typeof BaselineComparisonSchema>;

export const SparkPointSchema = z.object({ date: IsoDateSchema, value: z.number().nullable() });

export const LatestValueSchema = z.object({
  value: z.number(),
  unit: z.string(),
  measuredAt: IsoDateTimeSchema,
  connector: ConnectorIdSchema,
  dataOrigin: z.string().nullable(),
  sourceLabel: z.string(),
  deviceLabel: z.string().nullable(),
  /** For blood pressure the companion diastolic value / pulse etc. */
  companions: z.record(z.string(), z.number()).optional(),
});

export const MetricCardSchema = z.object({
  metricId: z.string(),
  label: z.string(),
  unit: z.string(),
  domain: DomainSchema,
  latest: LatestValueSchema.nullable(),
  freshness: FreshnessInfoSchema,
  comparison: BaselineComparisonSchema.nullable(),
  sparkline: z.array(SparkPointSchema),
  qualityFlags: z.array(z.string()),
});
export type MetricCard = z.infer<typeof MetricCardSchema>;

export const DomainCardSchema = z.object({
  domain: DomainSchema,
  label: z.string(),
  status: DomainStatusSchema,
  summary: z.string(),
  evidence: z.array(z.string()),
  metrics: z.array(MetricCardSchema),
});
export type DomainCard = z.infer<typeof DomainCardSchema>;

export const DataQualitySummarySchema = z.object({
  connectedSources: z.number().int(),
  staleSources: z.number().int(),
  observations30d: z.number().int(),
  crossSourceDuplicates30d: z.number().int(),
  implausibleValues30d: z.number().int(),
  notes: z.array(z.string()),
});

export const TodayResponseSchema = z.object({
  generatedAt: IsoDateTimeSchema,
  timeZone: TimeZoneIdSchema,
  localDate: IsoDateSchema,
  demoMode: z.boolean(),
  headline: z.string(),
  whatChanged: z.array(z.string()),
  whatMatters: z.array(z.string()),
  doToday: z.array(z.string()),
  domains: z.array(DomainCardSchema),
  dataQuality: DataQualitySummarySchema,
  disclaimer: z.string(),
});
export type TodayResponse = z.infer<typeof TodayResponseSchema>;

export const SeriesPointSchema = z.object({
  t: IsoDateTimeSchema,
  localDate: IsoDateSchema,
  value: z.number(),
  connector: ConnectorIdSchema,
  dataOrigin: z.string().nullable(),
  canonical: z.boolean(),
  companions: z.record(z.string(), z.number()).optional(),
});

export const SeriesResponseSchema = z.object({
  metricId: z.string(),
  unit: z.string(),
  from: IsoDateTimeSchema,
  to: IsoDateTimeSchema,
  bucket: z.enum(['raw', 'day']),
  points: z.array(SeriesPointSchema),
  daily: z.array(z.object({ date: IsoDateSchema, value: z.number().nullable(), n: z.number().int() })),
});
export type SeriesResponse = z.infer<typeof SeriesResponseSchema>;

export const SignalSchema = z.object({
  metricId: z.string(),
  domain: DomainSchema,
  kind: z.enum(['MEANINGFUL_CHANGE', 'DIRECTIONAL_CHANGE', 'NEW_365D_HIGH', 'NEW_365D_LOW', 'LOW_COVERAGE', 'STALE_SOURCE', 'SYNC_ERROR', 'IMPLAUSIBLE_VALUES']),
  direction: z.enum(['favourable', 'unfavourable', 'neutral']).nullable(),
  priority: z.number().int(),
  delta: z.number().nullable(),
  deltaPct: z.number().nullable(),
  effectSize: z.number().nullable(),
  explanation: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  asOfDate: IsoDateSchema,
  algorithmVersion: z.number().int(),
});
export type Signal = z.infer<typeof SignalSchema>;

export const TrendWindowSchema = z.object({
  days: z.number().int(),
  stats: WindowStatsSchema,
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  algorithmVersion: z.number().int(),
  computedAt: IsoDateTimeSchema,
});

export const TrendsResponseSchema = z.object({
  metricId: z.string(),
  label: z.string(),
  unit: z.string(),
  asOfDate: IsoDateSchema,
  windows: z.array(TrendWindowSchema),
  comparison: BaselineComparisonSchema.nullable(),
  /** Percentile of the current 7-day mean within the trailing 365 days of daily values. */
  percentile365: z.number().nullable(),
  daily: z.array(z.object({ date: IsoDateSchema, value: z.number().nullable() })),
  signals: z.array(SignalSchema),
  zone: z.object({ maxHeartRate: z.number().nullable(), source: z.string().nullable(), zone2: z.tuple([z.number(), z.number()]).nullable() }).optional(),
});
export type TrendsResponse = z.infer<typeof TrendsResponseSchema>;

export const DeriveResultSchema = z.object({
  asOfDate: IsoDateSchema,
  metricsComputed: z.number().int(),
  windowsWritten: z.number().int(),
  signals: z.number().int(),
  zone2Workouts: z.number().int(),
  durationMs: z.number(),
});
export type DeriveResult = z.infer<typeof DeriveResultSchema>;
