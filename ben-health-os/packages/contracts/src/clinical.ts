import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common.js';

// ---------------------------------------------------------------------------------------------
// Laboratory results
// ---------------------------------------------------------------------------------------------
export const LabSourceSchema = z.enum(['clinical_fhir', 'function_health', 'file_import', 'manual']);
export type LabSource = z.infer<typeof LabSourceSchema>;
export const VerificationStatusSchema = z.enum(['UNVERIFIED', 'REVIEW', 'CONFIRMED', 'REJECTED']);

export const LabImportRequestSchema = z
  .object({
    csv: z.string().min(1).max(7 * 1024 * 1024).optional(),
    /** PDF bytes, base64. Only the text layer is read; scanned PDFs yield nothing and must be entered manually. */
    pdfBase64: z.string().min(1).max(10 * 1024 * 1024).optional(),
    fileName: z.string().max(200).optional(),
    source: z.enum(['function_health', 'file_import']).default('file_import'),
    laboratory: z.string().max(120).optional(),
    /** Collection date to use when the file does not carry one. */
    collectedAt: IsoDateSchema.optional(),
    dryRun: z.boolean().default(false),
  })
  .refine((r) => Boolean(r.csv) !== Boolean(r.pdfBase64), 'provide exactly one of csv or pdfBase64');
export type LabImportRequest = z.infer<typeof LabImportRequestSchema>;

export const LabResultPreviewSchema = z.object({
  analyteRawName: z.string(),
  analyteId: z.string().nullable(),
  analyteKey: z.string(),
  loinc: z.string().nullable(),
  value: z.number().nullable(),
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
  canonicalValue: z.number().nullable(),
  canonicalUnit: z.string().nullable(),
  referenceLow: z.number().nullable(),
  referenceHigh: z.number().nullable(),
  referenceText: z.string().nullable(),
  abnormalFlag: z.string().nullable(),
  collectedAt: IsoDateSchema.nullable(),
  resultedAt: IsoDateSchema.nullable(),
  laboratory: z.string().nullable(),
  provider: z.string().nullable(),
  panel: z.string().nullable(),
  extractionConfidence: z.number(),
  flags: z.array(z.string()),
});

export const LabImportResultSchema = z.object({
  dryRun: z.boolean(),
  fileHash: z.string(),
  format: z.enum(['CSV', 'PDF_TEXT']),
  source: LabSourceSchema,
  documentId: UuidSchema.nullable(),
  mapping: z.record(z.string(), z.unknown()).nullable(),
  rows: z.number().int(),
  staged: z.number().int(),
  unchanged: z.number().int(),
  collectedAt: IsoDateSchema.nullable(),
  laboratory: z.string().nullable(),
  pageCount: z.number().int().nullable(),
  warnings: z.array(z.string()),
  preview: z.array(LabResultPreviewSchema),
});
export type LabImportResult = z.infer<typeof LabImportResultSchema>;

export const LabResultSchema = z.object({
  id: UuidSchema,
  panelId: UuidSchema.nullable(),
  analyteKey: z.string(),
  analyteId: z.string().nullable(),
  analyteRawName: z.string(),
  loinc: z.string().nullable(),
  value: z.number().nullable(),
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
  canonicalValue: z.number().nullable(),
  canonicalUnit: z.string().nullable(),
  referenceLow: z.number().nullable(),
  referenceHigh: z.number().nullable(),
  referenceText: z.string().nullable(),
  abnormalFlag: z.string().nullable(),
  collectedAt: IsoDateTimeSchema.nullable(),
  resultedAt: IsoDateTimeSchema.nullable(),
  laboratory: z.string().nullable(),
  provider: z.string().nullable(),
  method: z.string().nullable(),
  documentId: UuidSchema.nullable(),
  source: LabSourceSchema,
  externalId: z.string().nullable(),
  extractionConfidence: z.number().nullable(),
  verificationStatus: VerificationStatusSchema,
  canonical: z.boolean(),
  duplicateOf: UuidSchema.nullable(),
  duplicateReason: z.string().nullable(),
  qualityFlags: z.array(z.string()),
  panelName: z.string().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type LabResult = z.infer<typeof LabResultSchema>;

export const LabReviewDecisionSchema = z.object({
  id: UuidSchema,
  action: z.enum(['CONFIRM', 'REJECT']),
  corrections: z
    .object({
      analyteId: z.string().max(60).nullable().optional(),
      value: z.number().nullable().optional(),
      unit: z.string().max(40).nullable().optional(),
      collectedAt: IsoDateSchema.optional(),
      referenceLow: z.number().nullable().optional(),
      referenceHigh: z.number().nullable().optional(),
      abnormalFlag: z.string().max(20).nullable().optional(),
      note: z.string().max(500).optional(),
    })
    .optional(),
});
export const LabReviewRequestSchema = z.object({ decisions: z.array(LabReviewDecisionSchema).min(1).max(500) });
export type LabReviewRequest = z.infer<typeof LabReviewRequestSchema>;
export const LabReviewResultSchema = z.object({ confirmed: z.number().int(), rejected: z.number().int(), duplicatesLinked: z.number().int(), remaining: z.number().int() });

export const ManualLabResultInputSchema = z.object({
  analyteRawName: z.string().min(1).max(120),
  loinc: z.string().max(20).optional(),
  value: z.number().nullable().optional(),
  valueText: z.string().max(60).nullable().optional(),
  unit: z.string().max(40).optional(),
  referenceLow: z.number().nullable().optional(),
  referenceHigh: z.number().nullable().optional(),
  abnormalFlag: z.string().max(20).nullable().optional(),
  collectedAt: IsoDateSchema,
  laboratory: z.string().max(120).optional(),
  provider: z.string().max(120).optional(),
  clientEntryId: z.string().min(8).max(80),
});
export type ManualLabResultInput = z.infer<typeof ManualLabResultInputSchema>;

export const LabHistoryPointSchema = z.object({
  id: UuidSchema,
  collectedAt: IsoDateTimeSchema.nullable(),
  value: z.number().nullable(),
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
  canonicalValue: z.number().nullable(),
  canonicalUnit: z.string().nullable(),
  abnormalFlag: z.string().nullable(),
  referenceText: z.string().nullable(),
  referenceLow: z.number().nullable(),
  referenceHigh: z.number().nullable(),
  source: LabSourceSchema,
  laboratory: z.string().nullable(),
  canonical: z.boolean(),
  verificationStatus: VerificationStatusSchema,
  qualityFlags: z.array(z.string()),
});
export const LabAnalyteSummarySchema = z.object({
  analyteKey: z.string(),
  analyteId: z.string().nullable(),
  label: z.string(),
  loinc: z.string().nullable(),
  canonicalUnit: z.string().nullable(),
  mapped: z.boolean(),
  latest: LabHistoryPointSchema.nullable(),
  previous: LabHistoryPointSchema.nullable(),
  direction: z.enum(['UP', 'DOWN', 'FLAT']).nullable(),
  delta: z.number().nullable(),
  deltaPct: z.number().nullable(),
  count: z.number().int(),
  flaggedLatest: z.boolean(),
  history: z.array(LabHistoryPointSchema),
});
export type LabAnalyteSummary = z.infer<typeof LabAnalyteSummarySchema>;
export const LabDocumentSchema = z.object({
  id: UuidSchema,
  kind: z.string(),
  title: z.string(),
  provider: z.string().nullable(),
  documentDate: IsoDateSchema.nullable(),
  uploadedAt: IsoDateTimeSchema,
  extractionStatus: z.string(),
  pageCount: z.number().int().nullable(),
  sizeBytes: z.number().int().nullable(),
  resultsStaged: z.number().int(),
  resultsConfirmed: z.number().int(),
});
export const LabsOverviewResponseSchema = z.object({
  generatedAt: IsoDateTimeSchema,
  analytes: z.array(LabAnalyteSummarySchema),
  pendingReview: z.number().int(),
  latestCollectedAt: IsoDateTimeSchema.nullable(),
  sources: z.array(z.string()),
  documents: z.array(LabDocumentSchema),
  notes: z.array(z.string()),
});
export type LabsOverviewResponse = z.infer<typeof LabsOverviewResponseSchema>;
export const LabReviewQueueResponseSchema = z.object({ pending: z.array(LabResultSchema), total: z.number().int() });
export type LabReviewQueueResponse = z.infer<typeof LabReviewQueueResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Conditions, clinical events, allergies
// ---------------------------------------------------------------------------------------------
export const ConditionStatusSchema = z.enum(['ACTIVE', 'RESOLVED', 'HISTORICAL', 'UNCERTAIN']);
export const ConditionInputSchema = z.object({
  name: z.string().min(1).max(200),
  codeSystem: z.string().max(80).nullable().optional(),
  code: z.string().max(40).nullable().optional(),
  status: ConditionStatusSchema.default('ACTIVE'),
  onsetDate: IsoDateSchema.nullable().optional(),
  resolvedDate: IsoDateSchema.nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export const ConditionSchema = ConditionInputSchema.extend({
  id: UuidSchema,
  source: z.string(),
  sourceRecord: z.string().nullable(),
  verificationStatus: VerificationStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ClinicalEventSchema = z.object({
  id: UuidSchema,
  kind: z.string(),
  occurredAt: IsoDateTimeSchema,
  provider: z.string().nullable(),
  title: z.string(),
  details: z.record(z.string(), z.unknown()),
  source: z.string(),
  createdAt: IsoDateTimeSchema,
});

export const AllergySeveritySchema = z.enum(['MILD', 'MODERATE', 'SEVERE', 'UNKNOWN']);
export const AllergyInputSchema = z.object({
  substance: z.string().min(1).max(200),
  reaction: z.string().max(300).nullable().optional(),
  severity: AllergySeveritySchema.default('UNKNOWN'),
  recordedAt: IsoDateSchema.nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export const AllergySchema = AllergyInputSchema.extend({ id: UuidSchema, source: z.string(), sourceRecord: z.string().nullable(), createdAt: IsoDateTimeSchema });

export const ClinicalRecordsResponseSchema = z.object({
  conditions: z.array(ConditionSchema),
  events: z.array(ClinicalEventSchema),
  allergies: z.array(AllergySchema),
  notes: z.array(z.string()),
});
export type ClinicalRecordsResponse = z.infer<typeof ClinicalRecordsResponseSchema>;

export const FhirImportResultSchema = z.object({
  organization: z.string(),
  patientId: z.string().nullable(),
  labsStaged: z.number().int(),
  labsUnchanged: z.number().int(),
  conditions: z.number().int(),
  medicationSourceRecords: z.number().int(),
  allergies: z.number().int(),
  events: z.number().int(),
  warnings: z.array(z.string()),
});
export type FhirImportResult = z.infer<typeof FhirImportResultSchema>;

// ---------------------------------------------------------------------------------------------
// Medications and supplements
// ---------------------------------------------------------------------------------------------
export const MedicationStatusSchema = z.enum(['CURRENT', 'AS_NEEDED', 'HISTORICAL', 'UNCERTAIN', 'DUPLICATE']);
export const MedicationInputSchema = z.object({
  name: z.string().min(1).max(200),
  dosage: z.string().max(120).nullable().optional(),
  route: z.string().max(60).nullable().optional(),
  frequency: z.string().max(120).nullable().optional(),
  prescribingClinician: z.string().max(120).nullable().optional(),
  startDate: IsoDateSchema.nullable().optional(),
  stopDate: IsoDateSchema.nullable().optional(),
  indication: z.string().max(300).nullable().optional(),
  status: MedicationStatusSchema.default('UNCERTAIN'),
  refillDate: IsoDateSchema.nullable().optional(),
  sideEffects: z.string().max(1000).nullable().optional(),
  adherenceNotes: z.string().max(1000).nullable().optional(),
  rxnorm: z.string().max(20).nullable().optional(),
});
export type MedicationInput = z.infer<typeof MedicationInputSchema>;
export const MedicationSourceRecordSchema = z.object({
  id: UuidSchema,
  medicationId: UuidSchema.nullable(),
  source: z.string(),
  sourceRecordId: z.string().nullable(),
  name: z.string().nullable(),
  status: z.enum(['UNRECONCILED', 'LINKED', 'IGNORED']),
  recordedAt: IsoDateTimeSchema.nullable(),
  raw: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTimeSchema,
});
export const MedicationSchema = MedicationInputSchema.extend({ id: UuidSchema, source: z.string(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema, sourceRecords: z.array(MedicationSourceRecordSchema) });
export type Medication = z.infer<typeof MedicationSchema>;

export const SupplementStatusSchema = z.enum(['CURRENT', 'AS_NEEDED', 'HISTORICAL', 'UNCERTAIN']);
export const SupplementInputSchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().max(120).nullable().optional(),
  ingredients: z.array(z.object({ name: z.string().min(1).max(120), amount: z.string().max(60).nullable().optional() })).default([]),
  dose: z.string().max(120).nullable().optional(),
  frequency: z.string().max(120).nullable().optional(),
  purpose: z.string().max(300).nullable().optional(),
  startDate: IsoDateSchema.nullable().optional(),
  stopDate: IsoDateSchema.nullable().optional(),
  monthlyCostCents: z.number().int().min(0).nullable().optional(),
  perceivedBenefit: z.string().max(500).nullable().optional(),
  possibleAdverseEffects: z.string().max(500).nullable().optional(),
  status: SupplementStatusSchema.default('CURRENT'),
});
export const SupplementSchema = SupplementInputSchema.extend({ id: UuidSchema, createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema });

export const ReconcileDecisionSchema = z.object({
  sourceRecordId: UuidSchema,
  action: z.enum(['LINK', 'CREATE', 'IGNORE']),
  medicationId: UuidSchema.optional(),
  medication: MedicationInputSchema.optional(),
});
export const ReconcileRequestSchema = z.object({
  performedBy: z.enum(['USER', 'CLINICIAN']).default('USER'),
  summary: z.string().max(500).optional(),
  decisions: z.array(ReconcileDecisionSchema).min(1).max(200),
});
export type ReconcileRequest = z.infer<typeof ReconcileRequestSchema>;
export const MedicationsResponseSchema = z.object({
  medications: z.array(MedicationSchema),
  supplements: z.array(SupplementSchema),
  allergies: z.array(AllergySchema),
  unreconciled: z.array(MedicationSourceRecordSchema),
  reconciliations: z.array(z.object({ id: UuidSchema, performedAt: IsoDateTimeSchema, performedBy: z.string(), summary: z.string().nullable(), decisions: z.array(z.unknown()) })),
  interactionsCheck: z.object({ status: z.literal('NOT_IMPLEMENTED'), note: z.string() }),
  notes: z.array(z.string()),
});
export type MedicationsResponse = z.infer<typeof MedicationsResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Preventive care
// ---------------------------------------------------------------------------------------------
export const PreventiveStatusSchema = z.enum(['DUE', 'DUE_SOON', 'COMPLETED', 'DISCUSS_WITH_CLINICIAN', 'NOT_APPLICABLE']);
export const PreventiveItemInputSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(60),
  guidelineSource: z.string().min(1).max(300),
  guidelineReviewedAt: IsoDateSchema.nullable().optional(),
  intervalMonths: z.number().int().positive().max(600).nullable().optional(),
  lastCompletedAt: IsoDateSchema.nullable().optional(),
  dueAt: IsoDateSchema.nullable().optional(),
  status: PreventiveStatusSchema.default('DISCUSS_WITH_CLINICIAN'),
  notes: z.string().max(1000).nullable().optional(),
});
export type PreventiveItemInput = z.infer<typeof PreventiveItemInputSchema>;
export const PreventiveItemSchema = PreventiveItemInputSchema.extend({
  id: UuidSchema,
  computedStatus: PreventiveStatusSchema,
  computedDueAt: IsoDateSchema.nullable(),
  daysUntilDue: z.number().int().nullable(),
  completionHistory: z.array(z.object({ completedAt: IsoDateSchema, note: z.string().nullable() })),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PreventiveItem = z.infer<typeof PreventiveItemSchema>;
export const PreventiveCompleteSchema = z.object({ completedAt: IsoDateSchema, note: z.string().max(300).optional() });
export const PreventiveResponseSchema = z.object({
  today: IsoDateSchema,
  items: z.array(PreventiveItemSchema),
  counts: z.object({ due: z.number().int(), dueSoon: z.number().int(), completed: z.number().int(), discuss: z.number().int(), notApplicable: z.number().int() }),
  templates: z.array(z.object({ title: z.string(), category: z.string(), guidelineSource: z.string(), intervalMonths: z.number().int().nullable(), note: z.string() })),
  notes: z.array(z.string()),
});
export type PreventiveResponse = z.infer<typeof PreventiveResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Physician brief
// ---------------------------------------------------------------------------------------------
export const PhysicianBriefRequestSchema = z.object({
  reasonForVisit: z.string().min(1).max(500),
  concerns: z.array(z.string().min(1).max(300)).max(20).default([]),
  questions: z.array(z.string().min(1).max(300)).max(30).default([]),
  clinicianName: z.string().max(120).optional(),
  includeAppendix: z.boolean().default(false),
});
export type PhysicianBriefRequest = z.infer<typeof PhysicianBriefRequestSchema>;
export const PhysicianBriefSchema = z.object({
  id: UuidSchema,
  generatedAt: IsoDateTimeSchema,
  reasonForVisit: z.string().nullable(),
  content: z.record(z.string(), z.unknown()),
  pdfPath: z.string(),
});
export type PhysicianBrief = z.infer<typeof PhysicianBriefSchema>;
