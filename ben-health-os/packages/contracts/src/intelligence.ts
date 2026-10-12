import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common.js';

export const ClaimTypeSchema = z.enum(['MEASURED_FACT', 'DERIVED_TREND', 'HYPOTHESIS', 'RECOMMENDATION']);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;
export const ConfidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

// ---------------------------------------------------------------------------------------------
// Analysis packet (what an AI provider may see; also the input of the rules engine and reports)
// ---------------------------------------------------------------------------------------------
export const PacketItemSchema = z.object({
  /** Stable citation id, e.g. trend:sleep_duration:7v28, lab:<uuid>, signal:3, bp:30d, source:oura */
  id: z.string(),
  claimType: z.enum(['MEASURED_FACT', 'DERIVED_TREND']),
  domain: z.string(),
  kind: z.string(),
  text: z.string(),
  data: z.record(z.string(), z.unknown()),
  sources: z.array(z.string()),
  asOf: z.string().nullable(),
});
export type PacketItem = z.infer<typeof PacketItemSchema>;

export const AnalysisPacketSchema = z.object({
  packetVersion: z.literal(1),
  generatedAt: IsoDateTimeSchema,
  kind: z.enum(['weekly', 'monthly', 'adhoc']),
  period: z.object({ from: IsoDateSchema, to: IsoDateSchema, baselineFrom: IsoDateSchema.nullable(), baselineTo: IsoDateSchema.nullable() }),
  timeZone: z.string(),
  subject: z.object({ ageYears: z.number().int().nullable(), sexAtBirth: z.string().nullable() }),
  sharing: z.object({ enabled: z.boolean(), excludedConnectors: z.array(z.string()), droppedItems: z.number().int() }),
  items: z.array(PacketItemSchema),
  domainStatuses: z.array(z.object({ domain: z.string(), status: z.string(), evidence: z.array(z.string()) })),
  dataQuality: z.object({ connectedSources: z.number().int(), staleSources: z.number().int(), observations30d: z.number().int(), notes: z.array(z.string()) }),
  instructions: z.array(z.string()),
  hash: z.string(),
});
export type AnalysisPacket = z.infer<typeof AnalysisPacketSchema>;

// ---------------------------------------------------------------------------------------------
// AI responses
// ---------------------------------------------------------------------------------------------
export const AiFindingSchema = z.object({
  claimType: z.enum(['DERIVED_TREND', 'HYPOTHESIS', 'RECOMMENDATION']),
  title: z.string().min(1).max(200),
  text: z.string().min(1).max(2000),
  citations: z.array(z.string()).min(1).max(20),
  confidence: ConfidenceSchema,
  category: z.string().min(1).max(60),
  proposedAction: z.string().max(600).nullable().optional(),
  expectedBenefit: z.string().max(400).nullable().optional(),
  limitations: z.string().max(600).nullable().optional(),
  clinicianReview: z.boolean().default(false),
});
export type AiFinding = z.infer<typeof AiFindingSchema>;
export const AiResponseSchema = z.object({
  summary: z.string().max(4000),
  findings: z.array(AiFindingSchema).max(20),
  physicianQuestions: z.array(z.string().min(1).max(300)).max(10).default([]),
  providerMeta: z.record(z.string(), z.unknown()).default({}),
});
export type AiResponse = z.infer<typeof AiResponseSchema>;
export const AiNarrativeSchema = z.object({
  status: z.enum(['DISABLED', 'BLOCKED_BY_CREDENTIALS', 'OK', 'FAILED', 'MOCK']),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  summary: z.string().nullable(),
  findings: z.array(AiFindingSchema),
  physicianQuestions: z.array(z.string()),
  rejected: z.array(z.object({ title: z.string(), reason: z.string() })),
  packetHash: z.string().nullable(),
  note: z.string(),
});
export type AiNarrative = z.infer<typeof AiNarrativeSchema>;

export const AiStatusSchema = z.object({
  provider: z.enum(['none', 'mock', 'anthropic']),
  model: z.string().nullable(),
  status: z.enum(['DISABLED', 'NOT_CONFIGURED', 'BLOCKED_BY_CREDENTIALS', 'MOCK', 'CONFIGURED']),
  sharingEnabled: z.boolean(),
  excludedConnectors: z.array(z.string()),
  note: z.string(),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

// ---------------------------------------------------------------------------------------------
// Recommendations and evidence
// ---------------------------------------------------------------------------------------------
export const RecommendationStatusSchema = z.enum(['NEW', 'ACCEPTED', 'IN_PROGRESS', 'SNOOZED', 'DISMISSED', 'COMPLETED', 'DISCUSS_WITH_CLINICIAN']);
export type RecommendationStatus = z.infer<typeof RecommendationStatusSchema>;
export const ClinicianReviewStatusSchema = z.enum(['NOT_REQUIRED', 'RECOMMENDED', 'REQUESTED', 'REVIEWED']);
export const EvidenceTypeSchema = z.enum(['OBSERVATION', 'DERIVED_METRIC', 'LAB_RESULT', 'GUIDELINE', 'STUDY', 'CLINICIAN_NOTE', 'USER_REPORT']);

export const EvidenceInputSchema = z.object({
  evidenceType: EvidenceTypeSchema,
  refTable: z.string().nullable().optional(),
  refId: UuidSchema.nullable().optional(),
  citation: z.string().max(500).nullable().optional(),
  publicationDate: IsoDateSchema.nullable().optional(),
  population: z.string().max(300).nullable().optional(),
  strength: z.string().max(120).nullable().optional(),
  applicability: z.string().max(300).nullable().optional(),
  limitations: z.string().max(400).nullable().optional(),
  lastVerifiedAt: IsoDateTimeSchema.nullable().optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;
export const RecommendationEvidenceSchema = EvidenceInputSchema.extend({ id: UuidSchema });

export const CandidateRecommendationSchema = z.object({
  ruleKey: z.string(),
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(60),
  observation: z.string().min(1),
  interpretation: z.string().nullable(),
  reason: z.string().min(1),
  proposedAction: z.string().min(1),
  expectedBenefit: z.string().nullable(),
  requiredEffort: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(),
  estimatedCost: z.string().nullable(),
  confidence: ConfidenceSchema,
  claimType: ClaimTypeSchema,
  limitations: z.string().nullable(),
  clinicianReviewStatus: ClinicianReviewStatusSchema,
  initialStatus: RecommendationStatusSchema,
  priority: z.number().int().min(1).max(3).nullable(),
  outcomeMetric: z.string().nullable(),
  expiresInDays: z.number().int().positive(),
  evidence: z.array(EvidenceInputSchema),
  packetItemIds: z.array(z.string()),
  /** Evidence date: a dismissed recommendation with the same rule is only re-raised when this is newer than the dismissal. */
  evidenceAsOf: IsoDateSchema,
});
export type CandidateRecommendation = z.infer<typeof CandidateRecommendationSchema>;

export const RecommendationSchema = z.object({
  id: UuidSchema,
  ruleKey: z.string().nullable(),
  title: z.string(),
  category: z.string(),
  observation: z.string(),
  interpretation: z.string().nullable(),
  reason: z.string(),
  proposedAction: z.string(),
  expectedBenefit: z.string().nullable(),
  requiredEffort: z.string().nullable(),
  estimatedCost: z.string().nullable(),
  confidence: ConfidenceSchema,
  claimType: ClaimTypeSchema,
  limitations: z.string().nullable(),
  clinicianReviewStatus: ClinicianReviewStatusSchema,
  status: RecommendationStatusSchema,
  priority: z.number().int().nullable(),
  generatedBy: z.string(),
  sourceReportId: UuidSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  outcomeMetric: z.string().nullable(),
  outcome: z.record(z.string(), z.unknown()).nullable(),
  snoozedUntil: IsoDateTimeSchema.nullable(),
  dismissReason: z.string().nullable(),
  acceptedAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  packetItemIds: z.array(z.string()),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  evidence: z.array(RecommendationEvidenceSchema),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;
export const RecommendationUpdateSchema = z.object({
  status: RecommendationStatusSchema,
  snoozedUntil: IsoDateSchema.optional(),
  dismissReason: z.string().max(300).optional(),
});
export const RecommendationsResponseSchema = z.object({
  recommendations: z.array(RecommendationSchema),
  counts: z.record(z.string(), z.number().int()),
  notes: z.array(z.string()),
});
export type RecommendationsResponse = z.infer<typeof RecommendationsResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Alerts and notification preferences
// ---------------------------------------------------------------------------------------------
export const ALERT_KINDS = ['REPORT_READY', 'LABS_IMPORTED', 'CONNECTION_EXPIRED', 'SYNC_STALE', 'PERMISSIONS_REVOKED', 'EXPERIMENT_COMPLETED', 'FOLLOW_UP_DUE', 'MEDICATION_REVIEW_DUE'] as const;
export const AlertKindSchema = z.enum(ALERT_KINDS);
export const AlertSchema = z.object({
  id: UuidSchema,
  kind: AlertKindSchema,
  severity: z.enum(['INFO', 'ATTENTION', 'URGENT']),
  /** Safe for a lock screen: never contains measurement values. */
  title: z.string(),
  body: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
  deliveredAt: IsoDateTimeSchema.nullable(),
  readAt: IsoDateTimeSchema.nullable(),
  dismissedAt: IsoDateTimeSchema.nullable(),
});
export type Alert = z.infer<typeof AlertSchema>;
export const AlertsResponseSchema = z.object({ alerts: z.array(AlertSchema), unread: z.number().int() });
export const NotificationPrefsSchema = z.object({
  pushEnabled: z.boolean().default(true),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().default('22:00'),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().default('07:00'),
  enabledKinds: z.array(AlertKindSchema).default([...ALERT_KINDS]),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------
export const ReportSectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  claimType: ClaimTypeSchema.nullable(),
  lines: z.array(z.string()),
  items: z.array(z.record(z.string(), z.unknown())).default([]),
  insufficient: z.boolean().default(false),
});
export type ReportSection = z.infer<typeof ReportSectionSchema>;
export const ReportPrioritySchema = z.object({ rank: z.number().int(), title: z.string(), text: z.string(), recommendationId: UuidSchema.nullable(), insufficient: z.boolean() });
export const WeeklyReportContentSchema = z.object({
  algorithm: z.literal('weekly_health_ceo'),
  version: z.number().int(),
  dataThrough: IsoDateSchema,
  executiveSummary: z.array(z.string()),
  sections: z.array(ReportSectionSchema),
  priorities: z.array(ReportPrioritySchema),
  physicianFollowUp: z.array(z.string()),
  aiNarrative: AiNarrativeSchema,
  packetHash: z.string(),
});
export const MonthlyReportContentSchema = z.object({
  algorithm: z.literal('monthly_health_board'),
  version: z.number().int(),
  dataThrough: IsoDateSchema,
  executiveSummary: z.array(z.string()),
  sections: z.array(ReportSectionSchema),
  priorities: z.array(ReportPrioritySchema),
  aiNarrative: AiNarrativeSchema,
  packetHash: z.string(),
});
export const ReportSchema = z.object({
  id: UuidSchema,
  kind: z.enum(['weekly', 'monthly']),
  periodFrom: IsoDateSchema,
  periodTo: IsoDateSchema,
  baselineFrom: IsoDateSchema.nullable(),
  baselineTo: IsoDateSchema.nullable(),
  generatedAt: IsoDateTimeSchema,
  generator: z.record(z.string(), z.unknown()),
  status: z.enum(['GENERATING', 'READY', 'FAILED']),
  content: z.union([WeeklyReportContentSchema, MonthlyReportContentSchema]),
});
export type Report = z.infer<typeof ReportSchema>;
export const ReportListResponseSchema = z.object({ reports: z.array(z.object({ id: UuidSchema, kind: z.enum(['weekly', 'monthly']), periodFrom: IsoDateSchema, periodTo: IsoDateSchema, generatedAt: IsoDateTimeSchema, status: z.string() })) });
export type ReportListResponse = z.infer<typeof ReportListResponseSchema>;
export const ReportGenerateRequestSchema = z.object({ periodTo: IsoDateSchema.optional(), force: z.boolean().default(false) });

// ---------------------------------------------------------------------------------------------
// Health memory
// ---------------------------------------------------------------------------------------------
export const MemoryCategorySchema = z.enum(['GOAL', 'BASELINE', 'INTERVENTION', 'DIAGNOSIS', 'MEDICATION', 'ALLERGY', 'FAMILY_HISTORY', 'PREFERENCE', 'CLINICAL_EVENT', 'RECOMMENDATION', 'EXPERIMENT', 'CLINICIAN_INSTRUCTION', 'PRIORITY']);
export const MemoryOriginSchema = z.enum(['CLINICIAN_DOCUMENTED', 'DEVICE_MEASUREMENT', 'USER_REPORTED', 'DERIVED_CALCULATION', 'AI_HYPOTHESIS']);
export const HealthMemorySchema = z.object({
  id: UuidSchema,
  category: MemoryCategorySchema,
  statement: z.string(),
  origin: MemoryOriginSchema,
  sourceRef: z.string().nullable(),
  confidence: ConfidenceSchema,
  verificationStatus: z.enum(['UNVERIFIED', 'USER_CONFIRMED', 'CLINICIAN_CONFIRMED', 'ARCHIVED', 'DELETED']),
  recordedAt: IsoDateTimeSchema,
  lastReviewedAt: IsoDateTimeSchema.nullable(),
  archivedAt: IsoDateTimeSchema.nullable(),
});
export type HealthMemory = z.infer<typeof HealthMemorySchema>;
export const HealthMemoryInputSchema = z.object({
  category: MemoryCategorySchema,
  statement: z.string().min(1).max(1000),
  origin: MemoryOriginSchema.default('USER_REPORTED'),
  confidence: ConfidenceSchema.default('MEDIUM'),
  sourceRef: z.string().max(200).nullable().optional(),
});
export const HealthMemoryUpdateSchema = z.object({
  statement: z.string().min(1).max(1000).optional(),
  verificationStatus: z.enum(['UNVERIFIED', 'USER_CONFIRMED', 'CLINICIAN_CONFIRMED', 'ARCHIVED']).optional(),
});
export const HealthMemoriesResponseSchema = z.object({ memories: z.array(HealthMemorySchema), notes: z.array(z.string()) });
