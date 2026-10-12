import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common.js';

// ---------------------------------------------------------------------------------------------
// N-of-1 experiments
// ---------------------------------------------------------------------------------------------
export const ExperimentDesignSchema = z.enum(['BEFORE_AFTER', 'ALTERNATING', 'RANDOMIZED_BLOCKS']);
export const ExperimentStatusSchema = z.enum(['DRAFT', 'BASELINE', 'INTERVENTION', 'WASHOUT', 'ANALYSIS', 'COMPLETED', 'ABANDONED']);
export const ExperimentDecisionSchema = z.enum(['ADOPT', 'REJECT', 'RETEST', 'INCONCLUSIVE']);
export const ExperimentVerdictSchema = z.enum(['ADOPT', 'REJECT', 'RETEST', 'INCONCLUSIVE', 'INSUFFICIENT_EVIDENCE']);
export const PhaseKindSchema = z.enum(['BASELINE', 'INTERVENTION', 'WASHOUT']);

export const ExperimentInputSchema = z.object({
  title: z.string().min(1).max(200),
  researchQuestion: z.string().min(1).max(1000),
  hypothesis: z.string().min(1).max(1000),
  intervention: z.string().min(1).max(1000),
  /** Catalog metric id, or `checkin:<dimension>` for a subjective outcome. */
  primaryOutcomeMetric: z.string().min(1),
  secondaryOutcomeMetrics: z.array(z.string().min(1)).max(5).default([]),
  adherenceMeasure: z.string().max(300).nullable().optional(),
  confounders: z.array(z.string().max(200)).max(10).default([]),
  exclusionCriteria: z.array(z.string().max(200)).max(10).default([]),
  design: ExperimentDesignSchema.default('BEFORE_AFTER'),
  plannedBaselineDays: z.number().int().min(3).max(90).default(14),
  plannedInterventionDays: z.number().int().min(3).max(90).default(14),
  plannedBlocks: z.number().int().min(1).max(6).default(1),
  plannedWashoutDays: z.number().int().min(0).max(30).default(0),
  /** Local date the baseline starts; omit to create a draft without dates. */
  startDate: IsoDateSchema.optional(),
  sourceRecommendationId: UuidSchema.optional(),
});
export type ExperimentInput = z.infer<typeof ExperimentInputSchema>;

export const ExperimentPhaseSchema = z.object({
  id: UuidSchema,
  phase: PhaseKindSchema,
  sequence: z.number().int(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema.nullable(),
  adherence: z.array(z.object({ date: IsoDateSchema, adhered: z.boolean(), note: z.string().nullable().optional() })),
  notes: z.string().nullable(),
});
export type ExperimentPhase = z.infer<typeof ExperimentPhaseSchema>;

export const WindowStatsLiteSchema = z.object({ from: IsoDateSchema, to: IsoDateSchema, days: z.number().int(), daysWithData: z.number().int(), coverage: z.number(), n: z.number().int(), mean: z.number().nullable(), median: z.number().nullable(), sd: z.number().nullable(), min: z.number().nullable(), max: z.number().nullable(), slopePerDay: z.number().nullable() });
export const ExperimentEvaluationSchema = z.object({
  algorithm: z.literal('experiment_evaluation'),
  version: z.number().int(),
  evaluatedAt: IsoDateTimeSchema,
  asOfDate: IsoDateSchema,
  design: ExperimentDesignSchema,
  metricId: z.string(),
  label: z.string(),
  unit: z.string(),
  phases: z.array(z.object({ phase: PhaseKindSchema, sequence: z.number().int(), from: IsoDateSchema, to: IsoDateSchema, complete: z.boolean(), stats: WindowStatsLiteSchema, adherenceRate: z.number().nullable(), adherenceDays: z.number().int() })),
  baseline: WindowStatsLiteSchema.nullable(),
  intervention: WindowStatsLiteSchema.nullable(),
  washout: WindowStatsLiteSchema.nullable(),
  delta: z.number().nullable(),
  deltaPct: z.number().nullable(),
  effectSize: z.number().nullable(),
  changeClass: z.enum(['MEANINGFUL', 'DIRECTIONAL', 'NOISE', 'INSUFFICIENT_EVIDENCE']),
  favourable: z.boolean().nullable(),
  consistency: z.number().nullable(),
  adherenceRate: z.number().nullable(),
  complete: z.boolean(),
  preliminary: z.boolean(),
  verdict: ExperimentVerdictSchema,
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  reasons: z.array(z.string()),
  limitations: z.array(z.string()),
  secondary: z.array(z.object({ metricId: z.string(), label: z.string(), unit: z.string(), baselineMean: z.number().nullable(), interventionMean: z.number().nullable(), delta: z.number().nullable(), deltaPct: z.number().nullable(), changeClass: z.enum(['MEANINGFUL', 'DIRECTIONAL', 'NOISE', 'INSUFFICIENT_EVIDENCE']), favourable: z.boolean().nullable() })),
  summary: z.string(),
});
export type ExperimentEvaluation = z.infer<typeof ExperimentEvaluationSchema>;

export const ExperimentSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  researchQuestion: z.string(),
  hypothesis: z.string(),
  intervention: z.string(),
  primaryOutcomeMetric: z.string(),
  primaryOutcomeLabel: z.string(),
  secondaryOutcomeMetrics: z.array(z.string()),
  adherenceMeasure: z.string().nullable(),
  confounders: z.array(z.string()),
  exclusionCriteria: z.array(z.string()),
  design: ExperimentDesignSchema,
  status: ExperimentStatusSchema,
  decision: ExperimentDecisionSchema.nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
  confidence: z.string().nullable(),
  plannedBaselineDays: z.number().int().nullable(),
  plannedInterventionDays: z.number().int().nullable(),
  plannedBlocks: z.number().int(),
  plannedWashoutDays: z.number().int(),
  startDate: IsoDateSchema.nullable(),
  endDate: IsoDateSchema.nullable(),
  sourceRecommendationId: UuidSchema.nullable(),
  phases: z.array(ExperimentPhaseSchema),
  evaluation: ExperimentEvaluationSchema.nullable(),
  evaluatedAt: IsoDateTimeSchema.nullable(),
  /** Daily values of the primary outcome across the experiment window, for charts. */
  daily: z.array(z.object({ date: IsoDateSchema, value: z.number().nullable(), phase: PhaseKindSchema.nullable() })),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Experiment = z.infer<typeof ExperimentSchema>;
export const ExperimentsResponseSchema = z.object({
  experiments: z.array(ExperimentSchema),
  outcomeMetrics: z.array(z.object({ id: z.string(), label: z.string(), unit: z.string(), kind: z.enum(['metric', 'checkin']) })),
  notes: z.array(z.string()),
});
export type ExperimentsResponse = z.infer<typeof ExperimentsResponseSchema>;
export const ExperimentUpdateSchema = z.object({
  action: z.enum(['start', 'abandon', 'decide', 'extend_intervention']),
  startDate: IsoDateSchema.optional(),
  decision: ExperimentDecisionSchema.optional(),
  decisionNote: z.string().max(1000).optional(),
  extraDays: z.number().int().min(1).max(60).optional(),
});
export type ExperimentUpdate = z.infer<typeof ExperimentUpdateSchema>;
export const AdherenceInputSchema = z.object({ date: IsoDateSchema, adhered: z.boolean(), note: z.string().max(300).nullable().optional() });
export type AdherenceInput = z.infer<typeof AdherenceInputSchema>;

// ---------------------------------------------------------------------------------------------
// Strength training
// ---------------------------------------------------------------------------------------------
export const TrainingSetInputSchema = z.object({
  localDate: IsoDateSchema,
  exercise: z.string().min(1).max(100),
  setIndex: z.number().int().min(1).max(50),
  reps: z.number().int().min(1).max(200),
  loadKg: z.number().min(0).max(1000),
  rpe: z.number().min(1).max(10).nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
  workoutId: UuidSchema.nullable().optional(),
});
export type TrainingSetInput = z.infer<typeof TrainingSetInputSchema>;
export const TrainingSetsInputSchema = z.object({ sets: z.array(TrainingSetInputSchema).min(1).max(100) });
export const TrainingSetSchema = TrainingSetInputSchema.extend({ id: UuidSchema, source: z.string(), createdAt: IsoDateTimeSchema });
export type TrainingSet = z.infer<typeof TrainingSetSchema>;
export const TrainingOverviewSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  summary: z.object({
    algorithm: z.literal('training_summary'),
    version: z.number().int(),
    from: IsoDateSchema,
    to: IsoDateSchema,
    weeks: z.array(z.object({ weekStart: IsoDateSchema, weekEnd: IsoDateSchema, sessions: z.number().int(), loggedSets: z.number().int(), volumeKg: z.number(), minutes: z.number() })),
    sessionsPerWeek: z.number().nullable(),
    weeksWithoutSession: z.number().int(),
    progression: z.array(z.object({ exercise: z.string(), sessions: z.array(z.object({ date: IsoDateSchema, sets: z.number().int(), reps: z.number().int(), volumeKg: z.number(), topSetKg: z.number(), topSetReps: z.number().int(), estimatedOneRepMaxKg: z.number().nullable() })), bestEstimatedOneRepMaxKg: z.number().nullable(), recentMeanKg: z.number().nullable(), priorMeanKg: z.number().nullable(), deltaPct: z.number().nullable(), status: z.enum(['PROGRESSING', 'MAINTAINING', 'REGRESSING', 'INSUFFICIENT_EVIDENCE']), note: z.string() })),
    notes: z.array(z.string()),
  }),
  sessions: z.array(z.object({ id: UuidSchema, localDate: IsoDateSchema, startAt: IsoDateTimeSchema, durationMin: z.number(), title: z.string().nullable(), category: z.string(), source: z.string(), avgHeartRate: z.number().nullable() })),
  recentSets: z.array(TrainingSetSchema),
  zone2: z.object({ minutes7d: z.number().nullable(), minutes28dMean: z.number().nullable(), note: z.string() }),
  recovery: z.object({ hrv7d: z.number().nullable(), restingHr7d: z.number().nullable(), sleep7d: z.number().nullable(), note: z.string() }),
  notes: z.array(z.string()),
});
export type TrainingOverview = z.infer<typeof TrainingOverviewSchema>;

// ---------------------------------------------------------------------------------------------
// Subjective check-ins
// ---------------------------------------------------------------------------------------------
const rating = z.number().int().min(1).max(10).nullable().optional();
export const CheckInInputSchema = z.object({
  at: IsoDateTimeSchema.optional(),
  energy: rating,
  mood: rating,
  stress: rating,
  soreness: rating,
  fatigue: rating,
  focus: rating,
  pain: z.number().int().min(0).max(10).nullable().optional(),
  perceivedSleepQuality: rating,
  subjectiveRecovery: rating,
  illnessSymptoms: z.array(z.string().max(60)).max(20).default([]),
  note: z.string().max(1000).nullable().optional(),
});
export type CheckInInput = z.infer<typeof CheckInInputSchema>;
export const CheckInSchema = CheckInInputSchema.extend({ id: UuidSchema, at: IsoDateTimeSchema, localDate: IsoDateSchema, createdAt: IsoDateTimeSchema });
export type CheckIn = z.infer<typeof CheckInSchema>;
export const CheckInsResponseSchema = z.object({
  checkIns: z.array(CheckInSchema),
  summary: z.object({
    algorithm: z.literal('checkin_summary'),
    version: z.number().int(),
    asOfDate: IsoDateSchema,
    daysLogged7d: z.number().int(),
    dimensions: z.array(z.object({ dimension: z.string(), label: z.string(), direction: z.enum(['higher_better', 'lower_better']), mean7d: z.number().nullable(), daysWithData7d: z.number().int(), mean28d: z.number().nullable(), daysWithData28d: z.number().int(), delta: z.number().nullable(), changeClass: z.enum(['MEANINGFUL', 'DIRECTIONAL', 'NOISE', 'INSUFFICIENT_EVIDENCE']), favourable: z.boolean().nullable() })),
    notes: z.array(z.string()),
  }),
  notes: z.array(z.string()),
});
export type CheckInsResponse = z.infer<typeof CheckInsResponseSchema>;
