/**
 * Phase 7: N-of-1 experiments. The database holds the design and the phases; `@bho/analytics`
 * evaluates them from the same daily series as the trend engine. Nothing here claims causation.
 */
import type pg from 'pg';
import { addDays, checkInDaily, checkInMetric, evaluateExperiment, experimentStatusFor, localDateOf, planPhases, CHECKIN_DIMENSIONS, type CheckInDimension, type DailyPoint, type ExperimentPhaseInput } from '@bho/analytics';
import type { AdherenceInput, Experiment, ExperimentEvaluation, ExperimentInput, ExperimentUpdate, ExperimentsResponse } from '@bho/contracts';
import { METRIC_CATALOG, metricById, type MetricDefinition } from '@bho/shared-config';
import { withUser, type Tx } from '../db/pool.js';
import { audit } from './audit.js';
import { loadDaily } from './dashboard.js';

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const ACTIVE = ['DRAFT', 'BASELINE', 'INTERVENTION', 'WASHOUT', 'ANALYSIS'];

export function outcomeMetricDef(id: string): MetricDefinition | null {
  if (id.startsWith('checkin:')) {
    const dim = id.slice('checkin:'.length) as CheckInDimension;
    return (CHECKIN_DIMENSIONS as readonly string[]).includes(dim) ? checkInMetric(dim) : null;
  }
  const def = metricById(id);
  return def && def.id !== 'lab_result' ? def : null;
}

export const OUTCOME_METRICS = [
  ...METRIC_CATALOG.filter((m) => m.id !== 'lab_result').map((m) => ({ id: m.id, label: m.label, unit: m.unit, kind: 'metric' as const })),
  ...CHECKIN_DIMENSIONS.map((d) => ({ id: `checkin:${d}`, label: `${checkInMetric(d).label} (check-in)`, unit: '/10', kind: 'checkin' as const })),
];

async function outcomeDaily(tx: Tx, userId: string, metricId: string, from: string, to: string): Promise<DailyPoint[]> {
  if (metricId.startsWith('checkin:')) {
    const dim = metricId.slice('checkin:'.length) as CheckInDimension;
    const rows = await tx.query<Record<string, unknown>>(`select local_date::text as "localDate", energy, mood, stress, soreness, fatigue, focus, pain, perceived_sleep_quality as "perceivedSleepQuality", subjective_recovery as "subjectiveRecovery" from public.symptoms where user_id = $1 and local_date between $2 and $3`, [userId, from, to]);
    return checkInDaily(rows.rows as never, dim);
  }
  return (await loadDaily(tx, userId, metricId, from, to)).daily;
}

async function profileTz(tx: Tx, userId: string): Promise<string> {
  return (await tx.query<{ time_zone: string }>('select time_zone from public.profiles where id = $1', [userId])).rows[0]?.time_zone ?? 'UTC';
}

interface ExpRow { id: string; title: string; research_question: string; hypothesis: string; intervention: string; primary_outcome_metric: string; secondary_outcome_metrics: string[]; adherence_measure: string | null; confounders: string[]; exclusion_criteria: string[]; design: Experiment['design']; status: Experiment['status']; decision: Experiment['decision']; decision_note: string | null; decided_at: Date | null; confidence: string | null; planned_baseline_days: number | null; planned_intervention_days: number | null; planned_blocks: number; planned_washout_days: number; start_date: Date | null; source_recommendation_id: string | null; evaluation: ExperimentEvaluation | null; evaluated_at: Date | null; created_at: Date; updated_at: Date }
interface PhaseRow { id: string; experiment_id: string; phase: 'BASELINE' | 'INTERVENTION' | 'WASHOUT'; sequence: number; start_date: Date; end_date: Date | null; adherence: Array<{ date: string; adhered: boolean; note?: string | null }>; notes: string | null }
const EXP_COLS = 'id, title, research_question, hypothesis, intervention, primary_outcome_metric, secondary_outcome_metrics, adherence_measure, confounders, exclusion_criteria, design, status, decision, decision_note, decided_at, confidence, planned_baseline_days, planned_intervention_days, planned_blocks, planned_washout_days, start_date, source_recommendation_id, evaluation, evaluated_at, created_at, updated_at';

function phaseInputs(phases: PhaseRow[]): ExperimentPhaseInput[] {
  return phases.map((p) => ({ phase: p.phase, sequence: p.sequence, startDate: day(p.start_date)!, endDate: day(p.end_date), adherence: p.adherence ?? [] }));
}

async function toDto(tx: Tx, userId: string, row: ExpRow, phases: PhaseRow[], today: string): Promise<Experiment> {
  const inputs = phaseInputs(phases);
  const status = row.status === 'COMPLETED' || row.status === 'ABANDONED' ? row.status : experimentStatusFor(inputs, today);
  const from = inputs[0]?.startDate ?? null;
  const to = inputs.length ? (inputs.every((p) => p.endDate !== null) ? inputs.map((p) => p.endDate!).sort().at(-1)! : today) : null;
  const dailyRaw = from && to ? await outcomeDaily(tx, userId, row.primary_outcome_metric, from, to < today ? to : today) : [];
  const byDate = new Map(dailyRaw.map((d) => [d.localDate, d.value]));
  const daily: Experiment['daily'] = [];
  if (from && to) {
    const last = to < today ? to : today;
    for (let d = from; d <= last; d = addDays(d, 1)) {
      const phase = inputs.find((p) => d >= p.startDate && (p.endDate === null || d <= p.endDate))?.phase ?? null;
      daily.push({ date: d, value: byDate.get(d) ?? null, phase });
    }
  }
  return {
    id: row.id, title: row.title, researchQuestion: row.research_question, hypothesis: row.hypothesis, intervention: row.intervention, primaryOutcomeMetric: row.primary_outcome_metric, primaryOutcomeLabel: outcomeMetricDef(row.primary_outcome_metric)?.label ?? row.primary_outcome_metric, secondaryOutcomeMetrics: row.secondary_outcome_metrics ?? [], adherenceMeasure: row.adherence_measure, confounders: row.confounders ?? [], exclusionCriteria: row.exclusion_criteria ?? [], design: row.design, status, decision: row.decision, decisionNote: row.decision_note, decidedAt: iso(row.decided_at), confidence: row.confidence, plannedBaselineDays: row.planned_baseline_days, plannedInterventionDays: row.planned_intervention_days, plannedBlocks: row.planned_blocks, plannedWashoutDays: row.planned_washout_days, startDate: day(row.start_date), endDate: inputs.length && inputs.every((p) => p.endDate) ? inputs.map((p) => p.endDate!).sort().at(-1)! : null, sourceRecommendationId: row.source_recommendation_id,
    phases: phases.map((p) => ({ id: p.id, phase: p.phase, sequence: p.sequence, startDate: day(p.start_date)!, endDate: day(p.end_date), adherence: p.adherence ?? [], notes: p.notes })),
    evaluation: row.evaluation, evaluatedAt: iso(row.evaluated_at), daily, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
  };
}

async function loadOne(tx: Tx, userId: string, id: string, today: string): Promise<Experiment | null> {
  const r = await tx.query<ExpRow>(`select ${EXP_COLS} from public.health_experiments where user_id = $1 and id = $2`, [userId, id]);
  if (!r.rows[0]) return null;
  const phases = await tx.query<PhaseRow>('select * from public.experiment_phases where user_id = $1 and experiment_id = $2 order by sequence', [userId, id]);
  return toDto(tx, userId, r.rows[0], phases.rows, today);
}

const NOTES = [
  'An experiment compares your own baseline days with your own intervention days using the same change classifier and coverage gates as the trend engine. Verdicts are ADOPT / REJECT / RETEST / INCONCLUSIVE, or INSUFFICIENT EVIDENCE when the data cannot carry one.',
  'A before/after design cannot prove causation; alternating designs are stronger. Nothing here diagnoses or changes a medication; medication experiments are out of scope.',
  'Log adherence on intervention days: below 60% the result is not attributed to the intervention.',
];

export async function listExperiments(pool: pg.Pool, userId: string, now: Date = new Date()): Promise<ExperimentsResponse> {
  return withUser(pool, userId, async (tx) => {
    const today = localDateOf(now.toISOString(), null, await profileTz(tx, userId));
    const rows = await tx.query<ExpRow>(`select ${EXP_COLS} from public.health_experiments where user_id = $1 order by case status when 'COMPLETED' then 1 when 'ABANDONED' then 2 else 0 end, created_at desc`, [userId]);
    const phases = await tx.query<PhaseRow>('select * from public.experiment_phases where user_id = $1 order by sequence', [userId]);
    const experiments: Experiment[] = [];
    for (const r of rows.rows) experiments.push(await toDto(tx, userId, r, phases.rows.filter((p) => p.experiment_id === r.id), today));
    return { experiments, outcomeMetrics: OUTCOME_METRICS, notes: NOTES };
  });
}

export async function getExperiment(pool: pg.Pool, userId: string, id: string, now: Date = new Date()): Promise<Experiment | null> {
  return withUser(pool, userId, async (tx) => loadOne(tx, userId, id, localDateOf(now.toISOString(), null, await profileTz(tx, userId))));
}

async function writePhases(tx: Tx, userId: string, experimentId: string, design: Experiment['design'], startDate: string, baselineDays: number, interventionDays: number, blocks: number, washoutDays: number): Promise<void> {
  await tx.query('delete from public.experiment_phases where user_id = $1 and experiment_id = $2', [userId, experimentId]);
  for (const p of planPhases(design, startDate, baselineDays, interventionDays, blocks, washoutDays)) {
    await tx.query('insert into public.experiment_phases (user_id, experiment_id, phase, sequence, start_date, end_date) values ($1, $2, $3, $4, $5, $6)', [userId, experimentId, p.phase, p.sequence, p.startDate, p.endDate]);
  }
}

export async function createExperiment(pool: pg.Pool, userId: string, input: ExperimentInput, now: Date = new Date()): Promise<Experiment> {
  if (!outcomeMetricDef(input.primaryOutcomeMetric)) throw Object.assign(new Error(`unknown outcome metric ${input.primaryOutcomeMetric}`), { statusCode: 400 });
  for (const s of input.secondaryOutcomeMetrics) if (!outcomeMetricDef(s)) throw Object.assign(new Error(`unknown secondary metric ${s}`), { statusCode: 400 });
  const out = await withUser(pool, userId, async (tx) => {
    const today = localDateOf(now.toISOString(), null, await profileTz(tx, userId));
    const r = await tx.query<{ id: string }>(
      `insert into public.health_experiments (user_id, title, research_question, hypothesis, intervention, primary_outcome_metric, secondary_outcome_metrics, adherence_measure, confounders, exclusion_criteria, design, status, planned_baseline_days, planned_intervention_days, planned_blocks, planned_washout_days, start_date, source_recommendation_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12, $13, $14, $15, $16, $17) returning id`,
      [userId, input.title, input.researchQuestion, input.hypothesis, input.intervention, input.primaryOutcomeMetric, input.secondaryOutcomeMetrics, input.adherenceMeasure ?? null, input.confounders, input.exclusionCriteria, input.design, input.plannedBaselineDays, input.plannedInterventionDays, input.plannedBlocks, input.plannedWashoutDays, input.startDate ?? null, input.sourceRecommendationId ?? null],
    );
    const id = r.rows[0]!.id;
    if (input.startDate) {
      await writePhases(tx, userId, id, input.design, input.startDate, input.plannedBaselineDays, input.plannedInterventionDays, input.plannedBlocks, input.plannedWashoutDays);
      const phases = await tx.query<PhaseRow>('select * from public.experiment_phases where user_id = $1 and experiment_id = $2 order by sequence', [userId, id]);
      await tx.query('update public.health_experiments set status = $3 where user_id = $1 and id = $2', [userId, id, experimentStatusFor(phaseInputs(phases.rows), today)]);
    }
    if (input.sourceRecommendationId) await tx.query(`update public.recommendations set status = case when status = 'NEW' then 'ACCEPTED' else status end, accepted_at = coalesce(accepted_at, now()), updated_at = now() where user_id = $1 and id = $2`, [userId, input.sourceRecommendationId]);
    return (await loadOne(tx, userId, id, today))!;
  });
  await audit(pool, { userId, actor: 'user', action: 'EXPERIMENT_CREATE', entity: 'health_experiments', entityId: out.id, details: { design: input.design, metric: input.primaryOutcomeMetric } });
  return out;
}

export async function updateExperiment(pool: pg.Pool, userId: string, id: string, update: ExperimentUpdate, now: Date = new Date()): Promise<Experiment | null> {
  const out = await withUser(pool, userId, async (tx) => {
    const today = localDateOf(now.toISOString(), null, await profileTz(tx, userId));
    const r = await tx.query<ExpRow>(`select ${EXP_COLS} from public.health_experiments where user_id = $1 and id = $2`, [userId, id]);
    const row = r.rows[0];
    if (!row) return null;
    if (update.action === 'start') {
      if (row.status !== 'DRAFT') throw Object.assign(new Error('only a draft can be started'), { statusCode: 409 });
      const start = update.startDate ?? today;
      await writePhases(tx, userId, id, row.design, start, row.planned_baseline_days ?? 14, row.planned_intervention_days ?? 14, row.planned_blocks, row.planned_washout_days);
      const phases = await tx.query<PhaseRow>('select * from public.experiment_phases where user_id = $1 and experiment_id = $2 order by sequence', [userId, id]);
      await tx.query('update public.health_experiments set start_date = $3, status = $4, updated_at = now() where user_id = $1 and id = $2', [userId, id, start, experimentStatusFor(phaseInputs(phases.rows), today)]);
    } else if (update.action === 'abandon') {
      await tx.query(`update public.health_experiments set status = 'ABANDONED', decision_note = coalesce($3, decision_note), updated_at = now() where user_id = $1 and id = $2`, [userId, id, update.decisionNote ?? null]);
    } else if (update.action === 'extend_intervention') {
      const last = await tx.query<PhaseRow>(`select * from public.experiment_phases where user_id = $1 and experiment_id = $2 and phase = 'INTERVENTION' order by sequence desc limit 1`, [userId, id]);
      if (!last.rows[0]) throw Object.assign(new Error('no intervention phase to extend'), { statusCode: 409 });
      const end = day(last.rows[0].end_date) ?? today;
      await tx.query('update public.experiment_phases set end_date = $3 where user_id = $1 and id = $2', [userId, last.rows[0].id, addDays(end, update.extraDays ?? 7)]);
      const phases = await tx.query<PhaseRow>('select * from public.experiment_phases where user_id = $1 and experiment_id = $2 order by sequence', [userId, id]);
      await tx.query('update public.health_experiments set status = $3, updated_at = now() where user_id = $1 and id = $2', [userId, id, experimentStatusFor(phaseInputs(phases.rows), today)]);
    } else if (update.action === 'decide') {
      if (!update.decision) throw Object.assign(new Error('decision is required'), { statusCode: 400 });
      const evaluation = await evaluateTx(tx, userId, id, today, now);
      await tx.query(
        `update public.health_experiments set status = 'COMPLETED', decision = $3, decision_note = $4, decided_at = now(), confidence = $5, result = $6, updated_at = now() where user_id = $1 and id = $2`,
        [userId, id, update.decision, update.decisionNote ?? null, evaluation?.confidence ?? null, JSON.stringify({ evaluation, decision: update.decision, decidedAt: now.toISOString() })],
      );
      await tx.query(
        `insert into public.health_memories (user_id, category, statement, origin, source_ref, confidence, verification_status) values ($1, 'EXPERIMENT', $2, 'DERIVED_CALCULATION', $3, $4, 'USER_CONFIRMED')`,
        [userId, `Experiment “${row.title}” (${row.intervention}): verdict ${evaluation?.verdict ?? 'not evaluated'}, decision ${update.decision}${update.decisionNote ? ` — ${update.decisionNote}` : ''}.`, `experiment:${id}`, evaluation?.confidence ?? 'LOW'],
      );
    }
    return loadOne(tx, userId, id, today);
  });
  if (out) await audit(pool, { userId, actor: 'user', action: `EXPERIMENT_${update.action.toUpperCase()}`, entity: 'health_experiments', entityId: id, details: { decision: update.decision ?? null } });
  return out;
}

export async function recordAdherence(pool: pg.Pool, userId: string, id: string, input: AdherenceInput, now: Date = new Date()): Promise<Experiment | null> {
  return withUser(pool, userId, async (tx) => {
    const today = localDateOf(now.toISOString(), null, await profileTz(tx, userId));
    const phases = await tx.query<PhaseRow>('select * from public.experiment_phases where user_id = $1 and experiment_id = $2 order by sequence', [userId, id]);
    if (!phases.rows.length) return null;
    const target = phases.rows.find((p) => p.phase === 'INTERVENTION' && day(p.start_date)! <= input.date && (p.end_date === null || day(p.end_date)! >= input.date)) ?? phases.rows.find((p) => day(p.start_date)! <= input.date && (p.end_date === null || day(p.end_date)! >= input.date));
    if (!target) throw Object.assign(new Error('date is outside every phase of this experiment'), { statusCode: 400 });
    const adherence = [...(target.adherence ?? []).filter((a) => a.date !== input.date), { date: input.date, adhered: input.adhered, note: input.note ?? null }].sort((a, b) => a.date.localeCompare(b.date));
    await tx.query('update public.experiment_phases set adherence = $3::jsonb where user_id = $1 and id = $2', [userId, target.id, JSON.stringify(adherence)]);
    await tx.query('update public.health_experiments set updated_at = now() where user_id = $1 and id = $2', [userId, id]);
    return loadOne(tx, userId, id, today);
  });
}

async function evaluateTx(tx: Tx, userId: string, id: string, today: string, now: Date): Promise<ExperimentEvaluation | null> {
  const r = await tx.query<ExpRow>(`select ${EXP_COLS} from public.health_experiments where user_id = $1 and id = $2`, [userId, id]);
  const row = r.rows[0];
  if (!row) return null;
  const phases = await tx.query<PhaseRow>('select * from public.experiment_phases where user_id = $1 and experiment_id = $2 order by sequence', [userId, id]);
  const inputs = phaseInputs(phases.rows);
  const metric = outcomeMetricDef(row.primary_outcome_metric);
  if (!metric || !inputs.length) return null;
  const from = inputs[0]!.startDate;
  const to = inputs.every((p) => p.endDate) ? inputs.map((p) => p.endDate!).sort().at(-1)! : today;
  const daily = await outcomeDaily(tx, userId, metric.id, from, to);
  const secondary = [] as Array<{ metric: MetricDefinition; daily: DailyPoint[] }>;
  for (const s of row.secondary_outcome_metrics ?? []) {
    const def = outcomeMetricDef(s);
    if (def) secondary.push({ metric: def, daily: await outcomeDaily(tx, userId, s, from, to) });
  }
  const evaluation = evaluateExperiment({ design: row.design, metric, daily, phases: inputs, asOfDate: today, secondary, confounders: row.confounders ?? [], evaluatedAt: now.toISOString() }) as ExperimentEvaluation;
  const status = row.status === 'COMPLETED' || row.status === 'ABANDONED' ? row.status : experimentStatusFor(inputs, today);
  await tx.query('update public.health_experiments set evaluation = $3::jsonb, evaluated_at = now(), status = $4, updated_at = now() where user_id = $1 and id = $2', [userId, id, JSON.stringify(evaluation), status]);
  return evaluation;
}

export async function evaluateExperimentNow(pool: pg.Pool, userId: string, id: string, now: Date = new Date()): Promise<Experiment | null> {
  return withUser(pool, userId, async (tx) => {
    const today = localDateOf(now.toISOString(), null, await profileTz(tx, userId));
    const ev = await evaluateTx(tx, userId, id, today, now);
    return ev === null && !(await tx.query('select 1 from public.health_experiments where user_id = $1 and id = $2', [userId, id])).rowCount ? null : loadOne(tx, userId, id, today);
  });
}

/** Job: re-evaluate running experiments; raise one alert when the last phase has ended and no decision is recorded. */
export async function evaluateRunningExperiments(pool: pg.Pool, userId: string, now: Date = new Date()): Promise<{ evaluated: number; completedAlerts: number }> {
  return withUser(pool, userId, async (tx) => {
    const today = localDateOf(now.toISOString(), null, await profileTz(tx, userId));
    const rows = await tx.query<{ id: string; title: string }>(`select id, title from public.health_experiments where user_id = $1 and status = any($2::text[]) and status <> 'DRAFT'`, [userId, ACTIVE]);
    let evaluated = 0;
    let completedAlerts = 0;
    for (const r of rows.rows) {
      const ev = await evaluateTx(tx, userId, r.id, today, now);
      if (!ev) continue;
      evaluated++;
      if (ev.complete) {
        const ins = await tx.query(`insert into public.alerts (user_id, kind, severity, title, body, payload, dedupe_key) values ($1, 'EXPERIMENT_COMPLETED', 'INFO', 'An experiment has finished', $2, $3, $4) on conflict (user_id, dedupe_key) do nothing`, [userId, `“${r.title}” has completed all phases. Review the evaluation and record your decision in Experiments.`, JSON.stringify({ experimentId: r.id }), `experiment:${r.id}`]);
        if (ins.rowCount) completedAlerts++;
      }
    }
    return { evaluated, completedAlerts };
  });
}

/** For the monthly board report: completed experiments of the last 90 days and the ones still running. */
export async function experimentsForReport(tx: Tx, userId: string, today: string): Promise<{ completed: Array<Record<string, unknown>>; current: Array<Record<string, unknown>> }> {
  const rows = await tx.query<ExpRow>(`select ${EXP_COLS} from public.health_experiments where user_id = $1 and (status in ('BASELINE','INTERVENTION','WASHOUT','ANALYSIS') or (status = 'COMPLETED' and decided_at >= $2::date - interval '90 days')) order by created_at desc`, [userId, today]);
  const toEntry = (r: ExpRow) => ({ id: r.id, title: r.title, intervention: r.intervention, metric: r.primary_outcome_metric, status: r.status, decision: r.decision, verdict: r.evaluation?.verdict ?? null, summary: `${r.title} (${r.intervention}): ${r.evaluation?.summary ?? 'not evaluated yet'}${r.decision ? ` Decision: ${r.decision}.` : ''}` });
  return { completed: rows.rows.filter((r) => r.status === 'COMPLETED').map(toEntry), current: rows.rows.filter((r) => r.status !== 'COMPLETED').map(toEntry) };
}
