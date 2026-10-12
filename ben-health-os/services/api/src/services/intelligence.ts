/**
 * Phase 6 orchestration: builds analysis packets from the database, runs the deterministic rules
 * engine, optionally asks the configured AI provider (sharing controls applied), validates what comes
 * back, persists recommendations with evidence, assembles and stores the weekly / monthly reports,
 * evaluates recommendation outcomes, maintains alerts and the health memory.
 */
import type pg from 'pg';
import { addDays, classifyChange, directionFor, localDateOf, percentileRank, windowStats } from '@bho/analytics';
import { AnthropicProvider, MockAiProvider, assembleMonthlyReport, assembleWeeklyReport, assemblePacket, generateRuleRecommendations, validateAiResponse, type AiProvider, type PacketInputs } from '@bho/ai';
import type { AiNarrative, AiStatus, Alert, AnalysisPacket, CandidateRecommendation, HealthMemory, NotificationPrefs, PacketItem, Recommendation, RecommendationsResponse, Report } from '@bho/contracts';
import { NotificationPrefsSchema } from '@bho/contracts';
import { CONNECTORS, metricById } from '@bho/shared-config';
import type { AppConfig } from '../config.js';
import { withService, withUser, type Tx } from '../db/pool.js';
import { audit } from './audit.js';
import { bloodPressureSummary } from './bp.js';
import { buildToday, loadDaily } from './dashboard.js';
import { latestSignals } from './derived.js';
import { glucoseDay, repeatedMealsReport } from './glucose.js';
import { isFlagged, labsOverviewTx } from './labs.js';
import { medicationsOverviewTx } from './medications.js';
import { nutritionDays } from './nutrition.js';
import { listPreventiveTx } from './preventive.js';
import { listSources } from './sources.js';

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const fmt = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits }));
const MONTHLY_METRICS = ['sleep_duration', 'sleep_efficiency', 'hrv_rmssd', 'resting_heart_rate', 'respiratory_rate', 'spo2', 'steps', 'exercise_minutes', 'zone2_minutes', 'active_calories', 'vo2_max', 'weight', 'body_fat_pct', 'resistance_sessions', 'blood_glucose', 'calories', 'protein_g', 'fiber_g', 'sodium_mg', 'blood_pressure_systolic', 'blood_pressure_diastolic'];

export function createAiProvider(cfg: AppConfig): { provider: AiProvider | null; status: 'none' | 'mock' | 'anthropic' | 'blocked' } {
  if (cfg.AI_PROVIDER === 'mock') return { provider: new MockAiProvider({ includeInvalid: cfg.AI_MOCK_INCLUDE_INVALID }), status: 'mock' };
  if (cfg.AI_PROVIDER === 'anthropic') {
    if (!cfg.ANTHROPIC_API_KEY) return { provider: null, status: 'blocked' };
    return { provider: new AnthropicProvider({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.AI_MODEL, apiBase: cfg.AI_API_BASE }), status: 'anthropic' };
  }
  return { provider: null, status: 'none' };
}

export async function aiStatus(pool: pg.Pool, cfg: AppConfig, userId: string): Promise<AiStatus> {
  const prof = await withUser(pool, userId, (tx) => profileCtx(tx, userId));
  const { status } = createAiProvider(cfg);
  const providerStatus: AiStatus['status'] = !prof.sharing.enabled ? 'DISABLED' : status === 'none' ? 'NOT_CONFIGURED' : status === 'blocked' ? 'BLOCKED_BY_CREDENTIALS' : status === 'mock' ? 'MOCK' : 'CONFIGURED';
  const notes: Record<AiStatus['status'], string> = {
    DISABLED: 'AI data sharing is off. Reports are fully rules-based and nothing leaves the server.',
    NOT_CONFIGURED: 'Sharing is on but AI_PROVIDER=none on the server: reports stay rules-based until a provider is configured.',
    BLOCKED_BY_CREDENTIALS: 'AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY is set on the server (BLOCKED BY CREDENTIALS).',
    MOCK: 'Deterministic mock provider (tests/demo): findings restate packet trends; nothing is sent to an external service.',
    CONFIGURED: 'Live provider configured; packets are sent with the sharing controls applied. Live calls are untested until a key is provided (TESTED AGAINST LIVE API pending).',
  };
  return { provider: cfg.AI_PROVIDER, model: cfg.AI_PROVIDER === 'none' ? null : cfg.AI_PROVIDER === 'mock' ? 'mock-v1' : cfg.AI_MODEL, status: providerStatus, sharingEnabled: prof.sharing.enabled, excludedConnectors: prof.sharing.excludedConnectors, note: notes[providerStatus] };
}

// ---------------------------------------------------------------------------------------------
// Packet building
// ---------------------------------------------------------------------------------------------
interface ProfileCtx {
  timeZone: string;
  birthDate: string | null;
  sharing: { enabled: boolean; excludedConnectors: string[] };
}

async function profileCtx(tx: Tx, userId: string): Promise<ProfileCtx> {
  const r = await tx.query<{ time_zone: string; birth_date: Date | null; ai_sharing: { enabled?: boolean; excludedConnectors?: string[] } | null }>('select time_zone, birth_date, ai_sharing from public.profiles where id = $1', [userId]);
  const p = r.rows[0];
  return { timeZone: p?.time_zone ?? 'UTC', birthDate: p?.birth_date ? new Date(p.birth_date).toISOString().slice(0, 10) : null, sharing: { enabled: Boolean(p?.ai_sharing?.enabled), excludedConnectors: p?.ai_sharing?.excludedConnectors ?? ['oura'] } };
}

function favourableOf(metricId: string, delta: number | null): boolean | null {
  if (delta === null) return null;
  const d = directionFor(metricId, delta);
  return d === 'favourable' ? true : d === 'unfavourable' ? false : null;
}

async function metricSources(tx: Tx, userId: string, metricId: string, from: string, to: string): Promise<string[]> {
  const r = await tx.query<{ connector: string }>('select distinct connector from public.observations where user_id = $1 and metric_id = $2 and canonical and deleted_at is null and local_date between $3 and $4', [userId, metricId, from, to]);
  return r.rows.map((x) => x.connector);
}

export async function buildPacketInputs(pool: pg.Pool, cfg: AppConfig, userId: string, kind: 'weekly' | 'monthly', opts: { periodTo?: string } = {}, now: Date = new Date()): Promise<PacketInputs> {
  const nowIso = now.toISOString();
  const today = await buildToday(pool, userId, now);
  const signals = await latestSignals(pool, userId);
  const bp = await bloodPressureSummary(pool, userId, now, 30);
  const sources = await listSources(pool, userId, now, new Set(CONNECTORS.filter((c) => c.implementationStatus !== 'NOT_IMPLEMENTED').map((c) => c.id)));
  return withUser(pool, userId, async (tx) => {
    const prof = await profileCtx(tx, userId);
    const asOf = opts.periodTo ?? addDays(localDateOf(nowIso, null, prof.timeZone), -1);
    const period = kind === 'weekly' ? { from: addDays(asOf, -6), to: asOf, baselineFrom: addDays(asOf, -34), baselineTo: addDays(asOf, -7) } : { from: addDays(asOf, -29), to: asOf, baselineFrom: addDays(asOf, -119), baselineTo: addDays(asOf, -30) };
    const items: PacketItem[] = [];

    // Trends per metric
    for (const domain of today.domains) {
      for (const card of domain.metrics) {
        if (card.freshness.status === 'NOT_CONNECTED' || card.metricId === 'lab_result') continue; // labs are packet items of their own, not a daily trend
        const def = metricById(card.metricId);
        if (!def) continue;
        const srcs = await metricSources(tx, userId, card.metricId, period.baselineFrom, period.to);
        if (kind === 'weekly') {
          const cmp = card.comparison;
          const delta = cmp?.delta ?? null;
          const changeClass = cmp?.changeClass ?? 'INSUFFICIENT_EVIDENCE';
          const text = cmp && cmp.current7d.mean != null && changeClass !== 'INSUFFICIENT_EVIDENCE' ? `${card.label}: 7-day mean ${fmt(cmp.current7d.mean)} ${card.unit} (${cmp.current7d.daysWithData}/${cmp.current7d.days} days) vs 28-day baseline ${fmt(cmp.baseline28d.mean)} ${card.unit} (${cmp.baseline28d.daysWithData}/${cmp.baseline28d.days} days): ${cmp.explanation}` : `${card.label}: insufficient evidence for a 7-day vs 28-day comparison (${cmp?.current7d.daysWithData ?? 0} of 7 days with data).`;
          items.push({ id: `trend:${card.metricId}:7v28`, claimType: 'DERIVED_TREND', domain: domain.domain, kind: 'trend', text, data: { metricId: card.metricId, label: card.label, unit: card.unit, domain: domain.domain, current7d: cmp?.current7d ?? { mean: null, daysWithData: 0, days: 7, coverage: 0 }, baseline28d: cmp?.baseline28d ?? { mean: null, daysWithData: 0, days: 28, coverage: 0 }, delta, deltaPct: cmp?.deltaPct ?? null, changeClass, favourable: favourableOf(card.metricId, delta), explanation: cmp?.explanation ?? '', latest: card.latest ? { value: card.latest.value, measuredAt: card.latest.measuredAt, source: card.latest.sourceLabel } : null, freshness: card.freshness.status }, sources: srcs.length ? srcs : card.latest ? [card.latest.connector] : [], asOf: period.to });
        } else if (MONTHLY_METRICS.includes(card.metricId)) {
          const { daily } = await loadDaily(tx, userId, card.metricId, addDays(asOf, -364), asOf);
          const current30 = windowStats(daily, period.from, period.to);
          const prior90 = windowStats(daily, period.baselineFrom!, period.baselineTo!);
          const cls = classifyChange(def, current30, prior90);
          const values365 = daily.map((d) => d.value).filter((v): v is number => v != null);
          const pct365 = current30.mean != null && values365.length >= 30 ? percentileRank(current30.mean, values365) : null;
          const text = current30.mean != null && cls.changeClass !== 'INSUFFICIENT_EVIDENCE' ? `${card.label}: 30-day mean ${fmt(current30.mean)} ${card.unit} (${current30.daysWithData}/30 days) vs prior 90-day mean ${fmt(prior90.mean)} ${card.unit} (${prior90.daysWithData}/90 days): ${cls.changeClass.toLowerCase().replace('_', ' ')}${pct365 != null ? `; ${fmt(pct365, 0)}th percentile of the last 365 days` : ''}.` : `${card.label}: insufficient evidence for a 30-day vs 90-day comparison (${current30.daysWithData}/30 days).`;
          items.push({ id: `trend:${card.metricId}:30v90`, claimType: 'DERIVED_TREND', domain: domain.domain, kind: 'trend', text, data: { metricId: card.metricId, label: card.label, unit: card.unit, domain: domain.domain, current30, prior90, delta: cls.delta, deltaPct: cls.deltaPct, changeClass: cls.changeClass, favourable: favourableOf(card.metricId, cls.delta), pct365 }, sources: srcs, asOf: period.to });
        }
      }
    }
    // Signals
    signals.forEach((s, i) => items.push({ id: `signal:${i + 1}`, claimType: 'DERIVED_TREND', domain: s.domain, kind: 'signal', text: `${metricById(s.metricId)?.label ?? s.metricId}: ${s.explanation}`, data: { metricId: s.metricId, kind: s.kind, direction: s.direction, priority: s.priority, delta: s.delta, deltaPct: s.deltaPct, asOfDate: s.asOfDate }, sources: [], asOf: s.asOfDate }));
    // Blood pressure
    if (bp.latest) {
      const srcs = [...new Set(bp.readings.map((r) => r.connector))];
      items.push({ id: 'bp:30d', claimType: 'MEASURED_FACT', domain: 'cardio', kind: 'bp', text: `Blood pressure (home cuff, last 30 days): latest ${fmt(bp.latest.systolic, 0)}/${fmt(bp.latest.diastolic, 0)} mmHg on ${bp.latest.measuredAt.slice(0, 10)}; 7-day average ${bp.avg7d ? `${fmt(bp.avg7d.systolic, 0)}/${fmt(bp.avg7d.diastolic, 0)} over ${bp.avg7d.n} readings` : 'not available'}; 30-day average ${bp.avg30d ? `${fmt(bp.avg30d.systolic, 0)}/${fmt(bp.avg30d.diastolic, 0)} over ${bp.avg30d.n} readings` : 'not available'}; target below ${bp.targets.systolicMax}/${bp.targets.diastolicMax} (${bp.targets.clinicianConfigured ? 'clinician-set' : 'placeholder'}).`, data: { latest: bp.latest, avg7d: bp.avg7d, avg30d: bp.avg30d, morning: bp.morning, evening: bp.evening, sessions30d: bp.sessions.length, target: bp.targets }, sources: srcs, asOf: bp.latest.measuredAt.slice(0, 10) });
    }
    // Labs
    const labs = await labsOverviewTx(tx, userId, now);
    for (const a of labs.analytes) {
      if (!a.latest) continue;
      const l = a.latest;
      items.push({ id: `lab:${l.id}`, claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'lab', text: `${a.label}: ${l.valueText ?? fmt(l.value, 2)} ${l.unit ?? ''} on ${l.collectedAt?.slice(0, 10) ?? 'unknown date'}${l.referenceText ? ` (lab reference ${l.referenceText}` : ''}${l.abnormalFlag ? `${l.referenceText ? ', ' : ' ('}lab flag ${l.abnormalFlag})` : l.referenceText ? ')' : ''}${a.previous && a.deltaPct != null ? `; prior ${fmt(a.previous.value, 2)} ${a.previous.unit ?? ''} on ${a.previous.collectedAt?.slice(0, 10)} (${a.deltaPct > 0 ? '+' : ''}${a.deltaPct}%)` : ''}; source ${l.source}${l.laboratory ? `, ${l.laboratory}` : ''}.`, data: { id: l.id, analyteKey: a.analyteKey, label: a.label, value: l.value, valueText: l.valueText, unit: l.unit, canonicalValue: l.canonicalValue, canonicalUnit: l.canonicalUnit, referenceText: l.referenceText, abnormalFlag: l.abnormalFlag, flagged: a.flaggedLatest, collectedAt: l.collectedAt?.slice(0, 10) ?? null, direction: a.direction, deltaPct: a.deltaPct, count: a.count }, sources: [l.source], asOf: l.collectedAt?.slice(0, 10) ?? null });
    }
    if (labs.pendingReview > 0) items.push({ id: 'labs:pending', claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'labs_pending', text: `${labs.pendingReview} imported lab result(s) are waiting for review and do not count yet.`, data: { pendingReview: labs.pendingReview }, sources: [], asOf: period.to });
    // Glucose
    // Last day with glucose samples inside the period (never today's partial day)
    const gDay = await tx.query<{ d: string | null }>(`select max(local_date)::text as d from public.glucose_samples where user_id = $1 and canonical and deleted_at is null and local_date between $2 and $3`, [userId, period.from, period.to]);
    const g = gDay.rows[0]?.d ? await glucoseDay(pool, userId, gDay.rows[0].d, now) : null;
    if (g && g.stats.n > 0) items.push({ id: `glucose:${g.date}`, claimType: 'MEASURED_FACT', domain: 'metabolic_nutrition', kind: 'glucose_day', text: `Glucose on ${g.date} (${g.stats.n} samples, ${fmt(g.stats.coverageHours)} h covered): mean ${fmt(g.stats.mean, 0)} mg/dL, CV ${fmt(g.stats.cvPct)}%, ${fmt(g.stats.timeInRangePct)}% in your range ${g.range.lowMgDl}–${g.range.highMgDl} (below ${fmt(g.stats.timeBelowPct)}%, above ${fmt(g.stats.timeAbovePct)}%), overnight mean ${fmt(g.stats.overnightMean, 0)}.`, data: { date: g.date, ...g.stats, range: g.range }, sources: [...new Set(g.samples.map((s) => s.source.split(':')[0]!))], asOf: g.date });
    const rep = await repeatedMealsReport(pool, userId, 28, now);
    for (const m of rep.meals) items.push({ id: `glucose:repeated:${m.label.replace(/[^a-z0-9]+/gi, '-')}`, claimType: 'DERIVED_TREND', domain: 'metabolic_nutrition', kind: 'glucose_repeated', text: `Meal “${m.label}” (${m.occurrences} times, ${rep.from} → ${rep.to}): mean 2-hour peak ${m.meanPeakDelta != null ? `${m.meanPeakDelta > 0 ? '+' : ''}${fmt(m.meanPeakDelta, 0)}` : '—'} mg/dL, mean incremental AUC ${fmt(m.meanIAuc, 0)}.`, data: { label: m.label, occurrences: m.occurrences, meanPeakDelta: m.meanPeakDelta, meanIAuc: m.meanIAuc }, sources: ['health_connect'], asOf: rep.to });
    // Nutrition
    const nut = await nutritionDays(pool, userId, addDays(asOf, -6), asOf);
    if (nut.daysWithData7d > 0) items.push({ id: 'nutrition:7d', claimType: 'MEASURED_FACT', domain: 'metabolic_nutrition', kind: 'nutrition_7d', text: `Nutrition (${nut.daysWithData7d} of 7 days logged): ${fmt(nut.mean7d.calories, 0)} kcal, ${fmt(nut.mean7d.protein_g, 0)} g protein, ${fmt(nut.mean7d.fiber_g, 0)} g fibre, ${fmt(nut.mean7d.sodium_mg, 0)} mg sodium per logged day${nut.targets.protein_g ? `; your protein target ${nut.targets.protein_g} g` : ''}.`, data: { mean7d: nut.mean7d, daysWithData7d: nut.daysWithData7d, targets: nut.targets }, sources: [...new Set(nut.days.flatMap((d) => d.sources.map((s) => s.split(':')[0]!)))], asOf: asOf });
    // Medications, allergies, conditions
    const meds = await medicationsOverviewTx(tx, userId);
    for (const m of meds.medications.filter((x) => x.status === 'CURRENT' || x.status === 'AS_NEEDED')) items.push({ id: `medication:${m.id}`, claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'medication', text: `Medication: ${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? `, ${m.frequency}` : ''} (${m.status.toLowerCase().replace('_', ' ')}; source ${m.source}).`, data: { id: m.id, name: m.name, status: m.status, dosage: m.dosage, frequency: m.frequency, source: m.source }, sources: [], asOf: null });
    for (const a of meds.allergies) items.push({ id: `allergy:${a.id}`, claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'allergy', text: `Allergy: ${a.substance}${a.reaction ? ` (${a.reaction})` : ''}, ${a.severity.toLowerCase()}; source ${a.source}.`, data: { id: a.id, substance: a.substance, severity: a.severity }, sources: [], asOf: null });
    items.push({ id: 'medication_review', claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'medication_review', text: `${meds.medications.length} medication(s) on file; ${meds.reconciliations[0] ? `last reconciled ${meds.reconciliations[0].performedAt.slice(0, 10)}` : 'never reconciled'}; ${meds.unreconciled.length} source record(s) unreconciled.`, data: { medicationsCount: meds.medications.length, lastReconciledAt: meds.reconciliations[0]?.performedAt ?? null, unreconciled: meds.unreconciled.length }, sources: [], asOf: period.to });
    const conds = await tx.query<{ id: string; name: string; status: string; source: string; verification_status: string; onset_date: Date | null }>(`select id, name, status, source, verification_status, onset_date from public.conditions where user_id = $1 and status = 'ACTIVE'`, [userId]);
    for (const c of conds.rows) items.push({ id: `condition:${c.id}`, claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'condition', text: `Condition (${c.source.toLowerCase()}, ${c.verification_status.toLowerCase()}): ${c.name}${c.onset_date ? `, since ${new Date(c.onset_date).toISOString().slice(0, 10)}` : ''}.`, data: { id: c.id, name: c.name, source: c.source, verificationStatus: c.verification_status }, sources: [], asOf: null });
    // Preventive
    const prev = await listPreventiveTx(tx, userId, localDateOf(nowIso, null, prof.timeZone));
    for (const p of prev.items.filter((i) => i.computedStatus !== 'NOT_APPLICABLE')) items.push({ id: `preventive:${p.id}`, claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'preventive', text: `Preventive: ${p.title} — ${p.computedStatus.toLowerCase().replace(/_/g, ' ')}${p.computedDueAt ? ` (due ${p.computedDueAt})` : ''}${p.lastCompletedAt ? `, last ${p.lastCompletedAt}` : ''}; source ${p.guidelineSource}.`, data: { id: p.id, title: p.title, computedStatus: p.computedStatus, computedDueAt: p.computedDueAt, guidelineSource: p.guidelineSource }, sources: [], asOf: period.to });
    // Sources
    for (const s of sources.sources) {
      if (s.connectionStatus === 'NOT_CONFIGURED' || s.implementationStatus === 'NOT_IMPLEMENTED') continue;
      const ageH = s.lastSuccessfulSyncAt ? (now.getTime() - Date.parse(s.lastSuccessfulSyncAt)) / 3_600_000 : null;
      const freshness = ['ERROR', 'EXPIRED', 'REVOKED'].includes(s.connectionStatus) ? 'SYNC_ERROR' : ageH !== null && ageH > 3 * s.expectedSyncIntervalHours ? 'STALE' : s.connectionStatus === 'CONNECTED' ? 'CURRENT' : 'INSUFFICIENT_DATA';
      items.push({ id: `source:${s.connectorId}`, claimType: 'MEASURED_FACT', domain: 'data_quality', kind: 'source', text: `${s.displayName}: ${s.connectionStatus.toLowerCase().replace(/_/g, ' ')}, ${freshness.toLowerCase().replace('_', ' ')} (last successful sync ${s.lastSuccessfulSyncAt ? `${fmt(ageH, 0)} h ago` : 'never'}; ${s.coverageDays30}/30 days of observations${s.lastError ? `; last error: ${s.lastError.slice(0, 80)}` : ''}).`, data: { connector: s.connectorId, displayName: s.displayName, connectionStatus: s.connectionStatus, freshness, lastSuccessfulSyncAt: s.lastSuccessfulSyncAt, coverageDays30: s.coverageDays30 }, sources: [s.connectorId], asOf: period.to });
    }
    // Memory and goals (context, labelled by origin)
    const mem = await tx.query<{ id: string; category: string; statement: string; origin: string; verification_status: string }>(`select id, category, statement, origin, verification_status from public.health_memories where user_id = $1 and archived_at is null and verification_status not in ('ARCHIVED','DELETED') order by recorded_at desc limit 40`, [userId]);
    for (const m of mem.rows) items.push({ id: `memory:${m.id}`, claimType: 'MEASURED_FACT', domain: 'context', kind: 'memory', text: `Memory (${m.category.toLowerCase().replace(/_/g, ' ')}, ${m.origin.toLowerCase().replace(/_/g, ' ')}, ${m.verification_status.toLowerCase().replace(/_/g, ' ')}): ${m.statement}`, data: { id: m.id, category: m.category, origin: m.origin, verificationStatus: m.verification_status }, sources: [], asOf: null });
    const goals = await tx.query<{ id: string; title: string; target_metric: string | null; target_value: number | null; target_unit: string | null; target_type: string; target_date: Date | null }>(`select id, title, target_metric, target_value, target_unit, target_type, target_date from public.health_goals where user_id = $1 and status = 'ACTIVE'`, [userId]);
    for (const gl of goals.rows) items.push({ id: `goal:${gl.id}`, claimType: 'MEASURED_FACT', domain: 'context', kind: 'goal', text: `Goal (${gl.target_type.toLowerCase().replace(/_/g, ' ')}): ${gl.title}${gl.target_value != null ? ` — target ${gl.target_value} ${gl.target_unit ?? ''}` : ''}${gl.target_date ? ` by ${new Date(gl.target_date).toISOString().slice(0, 10)}` : ''}.`, data: { id: gl.id, title: gl.title, targetMetric: gl.target_metric, targetValue: gl.target_value, targetType: gl.target_type }, sources: [], asOf: null });

    const age = prof.birthDate ? Math.floor((now.getTime() - Date.parse(prof.birthDate)) / (365.25 * 86_400_000)) : null;
    return {
      kind,
      generatedAt: nowIso,
      period,
      timeZone: prof.timeZone,
      subject: { ageYears: age, sexAtBirth: null },
      sharing: prof.sharing,
      items,
      domainStatuses: today.domains.map((d) => ({ domain: d.domain, status: d.status, evidence: d.evidence })),
      dataQuality: { connectedSources: today.dataQuality.connectedSources, staleSources: today.dataQuality.staleSources, observations30d: today.dataQuality.observations30d, notes: today.dataQuality.notes },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------------------------
const REC_COLS = 'id, rule_key, title, category, observation, interpretation, reason, proposed_action, expected_benefit, required_effort, estimated_cost, confidence, claim_type, limitations, clinician_review_status, status, priority, generated_by, source_report_id, expires_at, outcome_metric, outcome, snoozed_until, dismiss_reason, accepted_at, completed_at, packet_item_ids, created_at, updated_at';
interface RecRow { id: string; rule_key: string | null; title: string; category: string; observation: string; interpretation: string | null; reason: string; proposed_action: string; expected_benefit: string | null; required_effort: string | null; estimated_cost: string | null; confidence: Recommendation['confidence']; claim_type: Recommendation['claimType']; limitations: string | null; clinician_review_status: Recommendation['clinicianReviewStatus']; status: Recommendation['status']; priority: number | null; generated_by: string; source_report_id: string | null; expires_at: Date | null; outcome_metric: string | null; outcome: Record<string, unknown> | null; snoozed_until: Date | null; dismiss_reason: string | null; accepted_at: Date | null; completed_at: Date | null; packet_item_ids: string[]; created_at: Date; updated_at: Date }
interface EvRow { id: string; recommendation_id: string; evidence_type: Recommendation['evidence'][number]['evidenceType']; ref_table: string | null; ref_id: string | null; citation: string | null; publication_date: Date | null; population: string | null; strength: string | null; applicability: string | null; limitations: string | null; last_verified_at: Date | null; details: Record<string, unknown> }

function recToDto(r: RecRow, ev: EvRow[]): Recommendation {
  return {
    id: r.id, ruleKey: r.rule_key, title: r.title, category: r.category, observation: r.observation, interpretation: r.interpretation, reason: r.reason, proposedAction: r.proposed_action, expectedBenefit: r.expected_benefit, requiredEffort: r.required_effort, estimatedCost: r.estimated_cost, confidence: r.confidence, claimType: r.claim_type, limitations: r.limitations, clinicianReviewStatus: r.clinician_review_status, status: r.status, priority: r.priority, generatedBy: r.generated_by, sourceReportId: r.source_report_id, expiresAt: iso(r.expires_at), outcomeMetric: r.outcome_metric, outcome: r.outcome, snoozedUntil: iso(r.snoozed_until), dismissReason: r.dismiss_reason, acceptedAt: iso(r.accepted_at), completedAt: iso(r.completed_at), packetItemIds: r.packet_item_ids ?? [], createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
    evidence: ev.filter((e) => e.recommendation_id === r.id).map((e) => ({ id: e.id, evidenceType: e.evidence_type, refTable: e.ref_table, refId: e.ref_id, citation: e.citation, publicationDate: e.publication_date ? new Date(e.publication_date).toISOString().slice(0, 10) : null, population: e.population, strength: e.strength, applicability: e.applicability, limitations: e.limitations, lastVerifiedAt: iso(e.last_verified_at), details: e.details ?? {} })),
  };
}

async function loadRecommendations(tx: Tx, userId: string, statuses?: string[]): Promise<Recommendation[]> {
  const rows = await tx.query<RecRow>(`select ${REC_COLS} from public.recommendations where user_id = $1 ${statuses ? 'and status = any($2::text[])' : ''} order by case when priority is null then 9 else priority end, created_at desc`, statuses ? [userId, statuses] : [userId]);
  if (!rows.rows.length) return [];
  const ev = await tx.query<EvRow>('select id, recommendation_id, evidence_type, ref_table, ref_id, citation, publication_date, population, strength, applicability, limitations, last_verified_at, details from public.recommendation_evidence where user_id = $1 and recommendation_id = any($2::uuid[])', [userId, rows.rows.map((r) => r.id)]);
  return rows.rows.map((r) => recToDto(r, ev.rows));
}

/** Persists candidates with the no-repeat rules: active duplicates are kept, dismissed ones are not re-raised without newer evidence. */
export async function persistCandidates(tx: Tx, userId: string, candidates: CandidateRecommendation[], generatedBy: string, reportId: string | null, now: Date): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const nowIso = now.toISOString();
  for (const c of candidates) {
    const existing = await tx.query<{ id: string; status: string; updated_at: Date; snoozed_until: Date | null }>(`select id, status, updated_at, snoozed_until from public.recommendations where user_id = $1 and rule_key = $2 order by created_at desc limit 1`, [userId, c.ruleKey]);
    const prev = existing.rows[0];
    if (prev) {
      const active = ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'DISCUSS_WITH_CLINICIAN'].includes(prev.status) || (prev.status === 'SNOOZED' && prev.snoozed_until && prev.snoozed_until.getTime() > now.getTime());
      const dismissedWithoutNewEvidence = prev.status === 'DISMISSED' && prev.updated_at.getTime() >= Date.parse(`${c.evidenceAsOf}T23:59:59Z`);
      const recentlyCompleted = prev.status === 'COMPLETED' && now.getTime() - prev.updated_at.getTime() < 30 * 86_400_000;
      if (active || dismissedWithoutNewEvidence || recentlyCompleted) {
        skipped++;
        continue;
      }
    }
    const r = await tx.query<{ id: string }>(
      `insert into public.recommendations (user_id, rule_key, title, category, observation, interpretation, reason, proposed_action, expected_benefit, required_effort, estimated_cost, confidence, claim_type, limitations, clinician_review_status, status, priority, generated_by, source_report_id, expires_at, outcome_metric, packet_item_ids)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) returning id`,
      [userId, c.ruleKey, c.title, c.category, c.observation, c.interpretation, c.reason, c.proposedAction, c.expectedBenefit, c.requiredEffort, c.estimatedCost, c.confidence, c.claimType, c.limitations, c.clinicianReviewStatus, c.initialStatus, c.priority, generatedBy, reportId, new Date(now.getTime() + c.expiresInDays * 86_400_000).toISOString(), c.outcomeMetric, c.packetItemIds],
    );
    for (const e of c.evidence) {
      await tx.query(
        `insert into public.recommendation_evidence (user_id, recommendation_id, evidence_type, ref_table, ref_id, citation, publication_date, population, strength, applicability, limitations, last_verified_at, details) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [userId, r.rows[0]!.id, e.evidenceType, e.refTable ?? null, e.refId ?? null, e.citation ?? null, e.publicationDate ?? null, e.population ?? null, e.strength ?? null, e.applicability ?? null, e.limitations ?? null, e.lastVerifiedAt ?? null, JSON.stringify(e.details ?? {})],
      );
    }
    inserted++;
  }
  await rerankPriorities(tx, userId, now);
  return { inserted, skipped };
}

/** At most three active recommendations carry a priority (1–3); everything else is unranked. */
export async function rerankPriorities(tx: Tx, userId: string, now: Date): Promise<void> {
  const active = await tx.query<{ id: string }>(`select id from public.recommendations where user_id = $1 and status in ('NEW','ACCEPTED','IN_PROGRESS','DISCUSS_WITH_CLINICIAN') and (expires_at is null or expires_at > $2) order by case when priority is null then 9 else priority end, case confidence when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, created_at desc`, [userId, now.toISOString()]);
  await tx.query(`update public.recommendations set priority = null where user_id = $1`, [userId]);
  for (let i = 0; i < Math.min(3, active.rows.length); i++) await tx.query('update public.recommendations set priority = $3 where user_id = $1 and id = $2', [userId, active.rows[i]!.id, i + 1]);
}

export async function listRecommendations(pool: pg.Pool, userId: string, status?: string): Promise<RecommendationsResponse> {
  return withUser(pool, userId, async (tx) => {
    const recs = await loadRecommendations(tx, userId, status ? [status] : undefined);
    const counts: Record<string, number> = {};
    const all = await tx.query<{ status: string; n: number }>('select status, count(*)::int as n from public.recommendations where user_id = $1 group by status', [userId]);
    for (const r of all.rows) counts[r.status] = Number(r.n);
    return { recommendations: recs, counts, notes: ['Every recommendation cites the packet items, lab results or guidelines it rests on; nothing here is a diagnosis or a medication change.', 'At most three active recommendations carry a weekly priority. Dismissed items are not raised again without newer evidence; outcomes are measured 14 days after acceptance on the stated metric.'] };
  });
}

export async function updateRecommendation(pool: pg.Pool, userId: string, id: string, update: { status: Recommendation['status']; snoozedUntil?: string; dismissReason?: string }, now: Date = new Date()): Promise<Recommendation | null> {
  const out = await withUser(pool, userId, async (tx) => {
    const r = await tx.query(
      `update public.recommendations set status = $3, snoozed_until = case when $3 = 'SNOOZED' then $4::timestamptz else null end, dismiss_reason = case when $3 = 'DISMISSED' then $5 else dismiss_reason end,
         accepted_at = case when $3 in ('ACCEPTED','IN_PROGRESS') and accepted_at is null then $6::timestamptz else accepted_at end, completed_at = case when $3 = 'COMPLETED' then $6::timestamptz else completed_at end, updated_at = now()
       where user_id = $1 and id = $2`,
      [userId, id, update.status, update.snoozedUntil ? `${update.snoozedUntil}T12:00:00Z` : null, update.dismissReason ?? null, now.toISOString()],
    );
    if (!r.rowCount) return null;
    await rerankPriorities(tx, userId, now);
    const list = await loadRecommendations(tx, userId);
    return list.find((x) => x.id === id) ?? null;
  });
  if (out) await audit(pool, { userId, actor: 'user', action: 'RECOMMENDATION_UPDATE', entity: 'recommendations', entityId: id, details: { status: update.status } });
  return out;
}

/** recommendation_outcome v1: 7 days before acceptance vs the 7 days after; descriptive, never causal. */
export async function evaluateOutcomes(tx: Tx, userId: string, now: Date): Promise<number> {
  const due = await tx.query<{ id: string; outcome_metric: string; accepted_at: Date }>(`select id, outcome_metric, accepted_at from public.recommendations where user_id = $1 and outcome is null and outcome_metric is not null and accepted_at is not null and accepted_at < $2::timestamptz - interval '8 days'`, [userId, now.toISOString()]);
  let evaluated = 0;
  for (const r of due.rows) {
    const def = metricById(r.outcome_metric);
    if (!def) continue;
    const acceptedDay = new Date(r.accepted_at).toISOString().slice(0, 10);
    const { daily } = await loadDaily(tx, userId, r.outcome_metric, addDays(acceptedDay, -7), addDays(acceptedDay, 7));
    const before = windowStats(daily, addDays(acceptedDay, -7), addDays(acceptedDay, -1));
    const after = windowStats(daily, addDays(acceptedDay, 1), addDays(acceptedDay, 7));
    const enough = before.daysWithData >= 4 && after.daysWithData >= 4 && before.mean != null && after.mean != null;
    const delta = enough ? after.mean! - before.mean! : null;
    const cls = enough ? classifyChange(def, after, before) : null;
    const favourable = delta === null ? null : favourableOf(r.outcome_metric, delta);
    const outcome = { algorithm: 'recommendation_outcome', version: 1, metric: r.outcome_metric, before: before.mean, after: after.mean, daysBefore: before.daysWithData, daysAfter: after.daysWithData, delta, deltaPct: cls?.deltaPct ?? null, changeClass: cls?.changeClass ?? 'INSUFFICIENT_EVIDENCE', favourable, summary: enough ? `${def.label}: ${fmt(before.mean)} → ${fmt(after.mean)} ${def.unit} (${cls!.changeClass.toLowerCase().replace('_', ' ')})` : `${def.label}: not enough days with data before/after acceptance (${before.daysWithData}/${after.daysWithData})`, evaluatedAt: now.toISOString() };
    await tx.query('update public.recommendations set outcome = $3, updated_at = now() where user_id = $1 and id = $2', [userId, r.id, JSON.stringify(outcome)]);
    evaluated++;
  }
  return evaluated;
}

// ---------------------------------------------------------------------------------------------
// AI narrative
// ---------------------------------------------------------------------------------------------
async function narrativeFor(cfg: AppConfig, providerPacket: AnalysisPacket, sharingEnabled: boolean, log?: (msg: string) => void): Promise<AiNarrative> {
  const base = { provider: null, model: null, summary: null, findings: [], physicianQuestions: [], rejected: [], packetHash: providerPacket.hash };
  if (!sharingEnabled) return { ...base, status: 'DISABLED', note: 'AI data sharing is off (Settings). The report is fully rules-based; nothing left the server.' };
  const { provider, status } = createAiProvider(cfg);
  if (!provider) return { ...base, status: 'BLOCKED_BY_CREDENTIALS', note: status === 'blocked' ? 'AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set (BLOCKED BY CREDENTIALS).' : 'No AI provider configured (AI_PROVIDER=none). The report is fully rules-based.' };
  try {
    const raw = await provider.analyze(providerPacket);
    const v = validateAiResponse(raw, providerPacket);
    return { status: provider.name === 'mock' ? 'MOCK' : 'OK', provider: provider.name, model: provider.model, summary: v.summary, findings: v.accepted, physicianQuestions: v.physicianQuestions, rejected: v.rejected, packetHash: providerPacket.hash, note: `${providerPacket.items.length} packet items sent (${providerPacket.sharing.droppedItems} withheld by sharing controls); ${v.accepted.length} finding(s) accepted, ${v.rejected.length} rejected by the validator.` };
  } catch (e) {
    log?.(`ai provider failed: ${(e as Error).message}`);
    return { ...base, status: 'FAILED', provider: provider.name, model: provider.model, note: `Provider call failed: ${(e as Error).message.slice(0, 200)}. The report is rules-based.` };
  }
}

function aiCandidates(narrative: AiNarrative, asOf: string): CandidateRecommendation[] {
  return narrative.findings.filter((f) => f.claimType === 'RECOMMENDATION').map((f) => ({
    ruleKey: `ai:${f.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
    title: f.title,
    category: f.category.toUpperCase().slice(0, 60),
    observation: f.text,
    interpretation: null,
    reason: `AI finding (${narrative.provider}/${narrative.model}) citing ${f.citations.join(', ')}.`,
    proposedAction: f.proposedAction ?? f.text,
    expectedBenefit: f.expectedBenefit ?? null,
    requiredEffort: null,
    estimatedCost: null,
    confidence: f.confidence,
    claimType: 'RECOMMENDATION',
    limitations: f.limitations ?? 'AI-generated from the analysis packet; validated for citations and safety phrasing only.',
    clinicianReviewStatus: f.clinicianReview ? 'RECOMMENDED' : 'NOT_REQUIRED',
    initialStatus: f.clinicianReview ? 'DISCUSS_WITH_CLINICIAN' : 'NEW',
    priority: null,
    outcomeMetric: null,
    expiresInDays: 14,
    evidence: f.citations.map((c) => ({ evidenceType: 'DERIVED_METRIC' as const, citation: c, details: { packetItemId: c, aiCitation: true } })),
    packetItemIds: f.citations,
    evidenceAsOf: asOf,
  }));
}

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------
export interface GenerateOptions {
  periodTo?: string;
  force?: boolean;
}

export async function generateWeeklyReport(pool: pg.Pool, cfg: AppConfig, userId: string, opts: GenerateOptions = {}, now: Date = new Date(), log?: (msg: string) => void): Promise<Report> {
  const inputs = await buildPacketInputs(pool, cfg, userId, 'weekly', { periodTo: opts.periodTo }, now);
  const existing = await withUser(pool, userId, (tx) => tx.query<{ id: string }>('select id from public.weekly_health_reports where user_id = $1 and period_to = $2', [userId, inputs.period.to]));
  if (existing.rows[0] && !opts.force) return (await getReport(pool, userId, 'weekly', existing.rows[0].id))!;
  const localPacket = assemblePacket(inputs, { forProvider: false });
  const providerPacket = assemblePacket(inputs, { forProvider: true });
  const narrative = await narrativeFor(cfg, providerPacket, inputs.sharing.enabled, log);
  const report = await withUser(pool, userId, async (tx) => {
    await evaluateOutcomes(tx, userId, now);
    const rules = generateRuleRecommendations(localPacket);
    const persisted = await persistCandidates(tx, userId, rules, 'rules:recommendation_rules/v1', null, now);
    const ai = await persistCandidates(tx, userId, aiCandidates(narrative, inputs.period.to), `ai:${narrative.provider ?? 'none'}/${narrative.model ?? 'none'}`, null, now);
    for (const f of narrative.findings.filter((x) => x.claimType === 'HYPOTHESIS')) {
      await tx.query(`insert into public.health_memories (user_id, category, statement, origin, source_ref, confidence, verification_status) select $1, 'RECOMMENDATION', $2, 'AI_HYPOTHESIS', $3, $4, 'UNVERIFIED' where not exists (select 1 from public.health_memories where user_id = $1 and statement = $2 and origin = 'AI_HYPOTHESIS')`, [userId, `${f.title}: ${f.text}`, `report:weekly:${inputs.period.to}; cites ${f.citations.join(', ')}`, f.confidence]);
    }
    const recs = await loadRecommendations(tx, userId);
    const content = assembleWeeklyReport({ packet: localPacket, recommendations: recs, narrative, dataThrough: inputs.period.to });
    const generator = { algorithm: 'weekly_health_ceo', version: 1, rules: 'recommendation_rules/v1', packetHash: localPacket.hash, providerPacketHash: providerPacket.hash, ai: { status: narrative.status, provider: narrative.provider, model: narrative.model }, candidates: rules.length, inserted: persisted.inserted + ai.inserted, skipped: persisted.skipped + ai.skipped };
    const r = await tx.query<{ id: string; generated_at: Date }>(
      `insert into public.weekly_health_reports (user_id, period_from, period_to, baseline_from, baseline_to, generator, content, status) values ($1, $2, $3, $4, $5, $6, $7, 'READY')
       on conflict (user_id, period_to) do update set period_from = excluded.period_from, baseline_from = excluded.baseline_from, baseline_to = excluded.baseline_to, generator = excluded.generator, content = excluded.content, status = 'READY', generated_at = now() returning id, generated_at`,
      [userId, inputs.period.from, inputs.period.to, inputs.period.baselineFrom, inputs.period.baselineTo, JSON.stringify(generator), JSON.stringify(content)],
    );
    await tx.query(`update public.recommendations set source_report_id = $2 where user_id = $1 and source_report_id is null and created_at >= $3::timestamptz - interval '1 minute'`, [userId, r.rows[0]!.id, now.toISOString()]);
    await insertAlert(tx, userId, { kind: 'REPORT_READY', severity: 'INFO', title: 'Weekly Health CEO report ready', body: `Report for ${inputs.period.from} → ${inputs.period.to} is ready in Health CEO.`, payload: { reportId: r.rows[0]!.id, kind: 'weekly' }, dedupeKey: `weekly:${inputs.period.to}` });
    return { id: r.rows[0]!.id, kind: 'weekly' as const, periodFrom: inputs.period.from, periodTo: inputs.period.to, baselineFrom: inputs.period.baselineFrom, baselineTo: inputs.period.baselineTo, generatedAt: new Date(r.rows[0]!.generated_at).toISOString(), generator, status: 'READY' as const, content };
  });
  await audit(pool, { userId, actor: 'system', action: 'REPORT_GENERATED', entity: 'weekly_health_reports', entityId: report.id, details: { periodTo: inputs.period.to, ai: narrative.status } });
  return report;
}

export async function generateMonthlyReport(pool: pg.Pool, cfg: AppConfig, userId: string, opts: GenerateOptions = {}, now: Date = new Date(), log?: (msg: string) => void): Promise<Report> {
  const inputs = await buildPacketInputs(pool, cfg, userId, 'monthly', { periodTo: opts.periodTo }, now);
  const existing = await withUser(pool, userId, (tx) => tx.query<{ id: string }>('select id from public.monthly_health_reports where user_id = $1 and period_to = $2', [userId, inputs.period.to]));
  if (existing.rows[0] && !opts.force) return (await getReport(pool, userId, 'monthly', existing.rows[0].id))!;
  const localPacket = assemblePacket(inputs, { forProvider: false });
  const providerPacket = assemblePacket(inputs, { forProvider: true });
  const narrative = await narrativeFor(cfg, providerPacket, inputs.sharing.enabled, log);
  const report = await withUser(pool, userId, async (tx) => {
    await evaluateOutcomes(tx, userId, now);
    const recs = await loadRecommendations(tx, userId);
    const content = assembleMonthlyReport({ packet: localPacket, recommendations: recs, narrative, experiments: { completed: [], current: [] }, dataThrough: inputs.period.to });
    const generator = { algorithm: 'monthly_health_board', version: 1, packetHash: localPacket.hash, providerPacketHash: providerPacket.hash, ai: { status: narrative.status, provider: narrative.provider, model: narrative.model } };
    const r = await tx.query<{ id: string; generated_at: Date }>(
      `insert into public.monthly_health_reports (user_id, period_from, period_to, generator, content, status) values ($1, $2, $3, $4, $5, 'READY')
       on conflict (user_id, period_to) do update set period_from = excluded.period_from, generator = excluded.generator, content = excluded.content, status = 'READY', generated_at = now() returning id, generated_at`,
      [userId, inputs.period.from, inputs.period.to, JSON.stringify(generator), JSON.stringify(content)],
    );
    await insertAlert(tx, userId, { kind: 'REPORT_READY', severity: 'INFO', title: 'Monthly Health Board report ready', body: `Report for ${inputs.period.from} → ${inputs.period.to} is ready in Health CEO.`, payload: { reportId: r.rows[0]!.id, kind: 'monthly' }, dedupeKey: `monthly:${inputs.period.to}` });
    return { id: r.rows[0]!.id, kind: 'monthly' as const, periodFrom: inputs.period.from, periodTo: inputs.period.to, baselineFrom: inputs.period.baselineFrom, baselineTo: inputs.period.baselineTo, generatedAt: new Date(r.rows[0]!.generated_at).toISOString(), generator, status: 'READY' as const, content };
  });
  await audit(pool, { userId, actor: 'system', action: 'REPORT_GENERATED', entity: 'monthly_health_reports', entityId: report.id, details: { periodTo: inputs.period.to, ai: narrative.status } });
  return report;
}

export async function listReports(pool: pg.Pool, userId: string): Promise<Array<{ id: string; kind: 'weekly' | 'monthly'; periodFrom: string; periodTo: string; generatedAt: string; status: string }>> {
  return withUser(pool, userId, async (tx) => {
    const w = await tx.query<{ id: string; period_from: Date; period_to: Date; generated_at: Date; status: string }>('select id, period_from, period_to, generated_at, status from public.weekly_health_reports where user_id = $1 order by period_to desc limit 52', [userId]);
    const m = await tx.query<{ id: string; period_from: Date; period_to: Date; generated_at: Date; status: string }>('select id, period_from, period_to, generated_at, status from public.monthly_health_reports where user_id = $1 order by period_to desc limit 24', [userId]);
    const map = (kind: 'weekly' | 'monthly') => (r: { id: string; period_from: Date; period_to: Date; generated_at: Date; status: string }) => ({ id: r.id, kind, periodFrom: new Date(r.period_from).toISOString().slice(0, 10), periodTo: new Date(r.period_to).toISOString().slice(0, 10), generatedAt: new Date(r.generated_at).toISOString(), status: r.status });
    return [...w.rows.map(map('weekly')), ...m.rows.map(map('monthly'))].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  });
}

export async function getReport(pool: pg.Pool, userId: string, kind: 'weekly' | 'monthly', id: string): Promise<Report | null> {
  return withUser(pool, userId, async (tx) => {
    const table = kind === 'weekly' ? 'weekly_health_reports' : 'monthly_health_reports';
    const r = await tx.query<{ id: string; period_from: Date; period_to: Date; baseline_from?: Date; baseline_to?: Date; generated_at: Date; generator: Record<string, unknown>; content: Report['content']; status: Report['status'] }>(`select * from public.${table} where user_id = $1 and id = $2`, [userId, id]);
    const row = r.rows[0];
    if (!row) return null;
    return { id: row.id, kind, periodFrom: new Date(row.period_from).toISOString().slice(0, 10), periodTo: new Date(row.period_to).toISOString().slice(0, 10), baselineFrom: row.baseline_from ? new Date(row.baseline_from).toISOString().slice(0, 10) : null, baselineTo: row.baseline_to ? new Date(row.baseline_to).toISOString().slice(0, 10) : null, generatedAt: new Date(row.generated_at).toISOString(), generator: row.generator ?? {}, status: row.status, content: row.content };
  });
}

/** Scheduled job: weekly reports when the latest complete week has none, monthly on the first days of a month, alerts for everyone with data. */
export async function reportsJob(pool: pg.Pool, cfg: AppConfig, now: Date = new Date(), log?: (msg: string) => void): Promise<{ users: number; weekly: number; monthly: number; failed: number }> {
  const users = await withService(pool, (tx) => tx.query<{ user_id: string; time_zone: string }>(`select p.id as user_id, p.time_zone from public.profiles p where exists (select 1 from public.observations o where o.user_id = p.id and o.deleted_at is null)`));
  let weekly = 0;
  let monthly = 0;
  let failed = 0;
  for (const u of users.rows) {
    try {
      const asOf = addDays(localDateOf(now.toISOString(), null, u.time_zone), -1);
      const latest = await withUser(pool, u.user_id, (tx) => tx.query<{ d: Date | null }>('select max(period_to) as d from public.weekly_health_reports where user_id = $1', [u.user_id]));
      const last = latest.rows[0]?.d ? new Date(latest.rows[0].d).toISOString().slice(0, 10) : null;
      if (!last || Date.parse(asOf) - Date.parse(last) >= 7 * 86_400_000) {
        await generateWeeklyReport(pool, cfg, u.user_id, {}, now, log);
        weekly++;
      }
      if (asOf.endsWith('-01') || asOf.endsWith('-02')) {
        const lm = await withUser(pool, u.user_id, (tx) => tx.query<{ d: Date | null }>('select max(period_to) as d from public.monthly_health_reports where user_id = $1', [u.user_id]));
        const lastM = lm.rows[0]?.d ? new Date(lm.rows[0].d).toISOString().slice(0, 10) : null;
        if (!lastM || Date.parse(asOf) - Date.parse(lastM) >= 28 * 86_400_000) {
          await generateMonthlyReport(pool, cfg, u.user_id, {}, now, log);
          monthly++;
        }
      }
      await refreshAlerts(pool, cfg, u.user_id, now);
    } catch (e) {
      failed++;
      log?.(`reports job failed for a user: ${(e as Error).message}`);
    }
  }
  return { users: users.rows.length, weekly, monthly, failed };
}

// ---------------------------------------------------------------------------------------------
// Alerts and notification preferences
// ---------------------------------------------------------------------------------------------
export async function insertAlert(tx: Tx, userId: string, a: { kind: Alert['kind']; severity: Alert['severity']; title: string; body: string | null; payload: Record<string, unknown>; dedupeKey: string }): Promise<boolean> {
  const r = await tx.query(`insert into public.alerts (user_id, kind, severity, title, body, payload, dedupe_key) values ($1, $2, $3, $4, $5, $6, $7) on conflict (user_id, dedupe_key) do nothing`, [userId, a.kind, a.severity, a.title, a.body, JSON.stringify(a.payload), a.dedupeKey]);
  return (r.rowCount ?? 0) > 0;
}

/** High-signal alerts only (spec §30); titles never carry values; one alert per condition per window. */
export async function refreshAlerts(pool: pg.Pool, cfg: AppConfig, userId: string, now: Date = new Date()): Promise<number> {
  const sources = await listSources(pool, userId, now, new Set(CONNECTORS.filter((c) => c.implementationStatus !== 'NOT_IMPLEMENTED').map((c) => c.id)));
  const week = now.toISOString().slice(0, 10);
  return withUser(pool, userId, async (tx) => {
    const prof = await profileCtx(tx, userId);
    const today = localDateOf(now.toISOString(), null, prof.timeZone);
    let created = 0;
    for (const s of sources.sources) {
      if (s.connectionStatus === 'EXPIRED' && (await insertAlert(tx, userId, { kind: 'CONNECTION_EXPIRED', severity: 'ATTENTION', title: `${s.displayName} connection expired`, body: 'Reconnect the source in Data Sources to resume synchronization.', payload: { connector: s.connectorId }, dedupeKey: `expired:${s.connectorId}:${week}` }))) created++;
      if (s.connectionStatus === 'REVOKED' && (await insertAlert(tx, userId, { kind: 'PERMISSIONS_REVOKED', severity: 'ATTENTION', title: `${s.displayName} permissions revoked`, body: 'Open the app to grant the permissions again.', payload: { connector: s.connectorId }, dedupeKey: `revoked:${s.connectorId}:${week}` }))) created++;
      const ageH = s.lastSuccessfulSyncAt ? (now.getTime() - Date.parse(s.lastSuccessfulSyncAt)) / 3_600_000 : null;
      if (s.connectionStatus === 'CONNECTED' && ageH !== null && ageH > 3 * s.expectedSyncIntervalHours && s.integrationClass !== 'FILE_IMPORT' && (await insertAlert(tx, userId, { kind: 'SYNC_STALE', severity: 'INFO', title: `${s.displayName} synchronization is stale`, body: 'No successful sync for longer than expected. Open Data Sources for the reason.', payload: { connector: s.connectorId }, dedupeKey: `stale:${s.connectorId}:${week}` }))) created++;
    }
    const prev = await listPreventiveTx(tx, userId, today);
    for (const p of prev.items.filter((i) => i.computedStatus === 'DUE')) if (await insertAlert(tx, userId, { kind: 'FOLLOW_UP_DUE', severity: 'INFO', title: 'A preventive-care item is due', body: `${p.title} is past its due date. Open Preventive care.`, payload: { itemId: p.id }, dedupeKey: `due:${p.id}:${today.slice(0, 7)}` })) created++;
    const meds = await medicationsOverviewTx(tx, userId);
    const last = meds.reconciliations[0]?.performedAt ?? null;
    if (meds.medications.length > 0 && (!last || now.getTime() - Date.parse(last) > 365 * 86_400_000)) if (await insertAlert(tx, userId, { kind: 'MEDICATION_REVIEW_DUE', severity: 'INFO', title: 'Medication review is due', body: 'Reconcile your medication list on the Medications page and confirm it with your clinician.', payload: {}, dedupeKey: `medreview:${today.slice(0, 7)}` })) created++;
    return created;
  });
}

export async function listAlerts(pool: pg.Pool, userId: string, unreadOnly: boolean): Promise<{ alerts: Alert[]; unread: number }> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<{ id: string; kind: Alert['kind']; severity: Alert['severity']; title: string; body: string | null; payload: Record<string, unknown>; created_at: Date; delivered_at: Date | null; read_at: Date | null; dismissed_at: Date | null }>(`select id, kind, severity, title, body, payload, created_at, delivered_at, read_at, dismissed_at from public.alerts where user_id = $1 ${unreadOnly ? 'and read_at is null and dismissed_at is null' : ''} order by created_at desc limit 100`, [userId]);
    const unread = await tx.query<{ n: number }>('select count(*)::int as n from public.alerts where user_id = $1 and read_at is null and dismissed_at is null', [userId]);
    return { alerts: r.rows.map((a) => ({ id: a.id, kind: a.kind, severity: a.severity, title: a.title, body: a.body, payload: a.payload ?? {}, createdAt: iso(a.created_at)!, deliveredAt: iso(a.delivered_at), readAt: iso(a.read_at), dismissedAt: iso(a.dismissed_at) })), unread: Number(unread.rows[0]!.n) };
  });
}

export async function updateAlert(pool: pg.Pool, userId: string, id: string, action: 'read' | 'dismissed' | 'delivered'): Promise<boolean> {
  const col = action === 'read' ? 'read_at' : action === 'dismissed' ? 'dismissed_at' : 'delivered_at';
  return withUser(pool, userId, async (tx) => (await tx.query(`update public.alerts set ${col} = coalesce(${col}, now()) where user_id = $1 and id = $2`, [userId, id])).rowCount! > 0);
}

export async function getNotificationPrefs(pool: pg.Pool, userId: string): Promise<NotificationPrefs> {
  const r = await withUser(pool, userId, (tx) => tx.query<{ notification_prefs: unknown }>('select notification_prefs from public.profiles where id = $1', [userId]));
  const parsed = NotificationPrefsSchema.safeParse(r.rows[0]?.notification_prefs ?? {});
  return parsed.success ? parsed.data : NotificationPrefsSchema.parse({});
}

export async function setNotificationPrefs(pool: pg.Pool, userId: string, prefs: NotificationPrefs): Promise<void> {
  await withUser(pool, userId, (tx) => tx.query('update public.profiles set notification_prefs = $2::jsonb where id = $1', [userId, JSON.stringify(prefs)]));
}

// ---------------------------------------------------------------------------------------------
// Health memory
// ---------------------------------------------------------------------------------------------
const MEM_COLS = 'id, category, statement, origin, source_ref, confidence, verification_status, recorded_at, last_reviewed_at, archived_at';
interface MemRow { id: string; category: HealthMemory['category']; statement: string; origin: HealthMemory['origin']; source_ref: string | null; confidence: HealthMemory['confidence']; verification_status: HealthMemory['verificationStatus']; recorded_at: Date; last_reviewed_at: Date | null; archived_at: Date | null }
const memToDto = (m: MemRow): HealthMemory => ({ id: m.id, category: m.category, statement: m.statement, origin: m.origin, sourceRef: m.source_ref, confidence: m.confidence, verificationStatus: m.verification_status, recordedAt: iso(m.recorded_at)!, lastReviewedAt: iso(m.last_reviewed_at), archivedAt: iso(m.archived_at) });

export async function listMemories(pool: pg.Pool, userId: string, includeArchived = false): Promise<HealthMemory[]> {
  return withUser(pool, userId, async (tx) => (await tx.query<MemRow>(`select ${MEM_COLS} from public.health_memories where user_id = $1 ${includeArchived ? '' : "and verification_status not in ('ARCHIVED','DELETED') and archived_at is null"} order by recorded_at desc limit 500`, [userId])).rows.map(memToDto));
}

export async function createMemory(pool: pg.Pool, userId: string, m: { category: HealthMemory['category']; statement: string; origin: HealthMemory['origin']; confidence: HealthMemory['confidence']; sourceRef?: string | null }): Promise<HealthMemory> {
  return withUser(pool, userId, async (tx) => memToDto((await tx.query<MemRow>(`insert into public.health_memories (user_id, category, statement, origin, source_ref, confidence, verification_status) values ($1, $2, $3, $4, $5, $6, case when $4 = 'USER_REPORTED' then 'USER_CONFIRMED' else 'UNVERIFIED' end) returning ${MEM_COLS}`, [userId, m.category, m.statement, m.origin, m.sourceRef ?? null, m.confidence])).rows[0]!));
}

export async function updateMemory(pool: pg.Pool, userId: string, id: string, u: { statement?: string; verificationStatus?: 'UNVERIFIED' | 'USER_CONFIRMED' | 'CLINICIAN_CONFIRMED' | 'ARCHIVED' }): Promise<HealthMemory | null> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query<MemRow>(`update public.health_memories set statement = coalesce($3, statement), verification_status = coalesce($4, verification_status), last_reviewed_at = now(), archived_at = case when $4 = 'ARCHIVED' then now() else archived_at end where user_id = $1 and id = $2 returning ${MEM_COLS}`, [userId, id, u.statement ?? null, u.verificationStatus ?? null]);
    return r.rows[0] ? memToDto(r.rows[0]) : null;
  });
}

export async function deleteMemory(pool: pg.Pool, userId: string, id: string): Promise<boolean> {
  return withUser(pool, userId, async (tx) => (await tx.query('delete from public.health_memories where user_id = $1 and id = $2', [userId, id])).rowCount! > 0);
}

/** Preview of the packet a provider would receive (sharing controls applied); nothing is sent. */
export async function previewPacket(pool: pg.Pool, cfg: AppConfig, userId: string, kind: 'weekly' | 'monthly', now: Date = new Date()): Promise<AnalysisPacket> {
  const inputs = await buildPacketInputs(pool, cfg, userId, kind, {}, now);
  return assemblePacket(inputs, { forProvider: true });
}
