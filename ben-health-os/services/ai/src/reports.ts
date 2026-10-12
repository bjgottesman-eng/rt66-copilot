/**
 * Weekly Health CEO (§18) and monthly Health Board (§19) report assembly from a packet, persisted
 * recommendations and the (validated) AI narrative. Pure functions; sections state insufficiency
 * explicitly instead of manufacturing conclusions.
 */
import type { AiNarrative, AnalysisPacket, PacketItem, Recommendation, ReportSection } from '@bho/contracts';
import { itemsOfKind } from './packet.js';

export interface WeeklyReportInputs {
  packet: AnalysisPacket;
  recommendations: Recommendation[];
  narrative: AiNarrative;
  dataThrough: string;
}

const fmt = (v: unknown, digits = 1): string => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—');
function section(key: string, title: string, claimType: ReportSection['claimType'], lines: string[], items: Array<Record<string, unknown>> = [], insufficientReason?: string | null): ReportSection {
  if (lines.length === 0) return { key, title, claimType, lines: [insufficientReason ?? 'Not enough data in this period to say anything; nothing is inferred.'], items, insufficient: true };
  return { key, title, claimType, lines, items, insufficient: false };
}
const trendLine = (t: PacketItem): string => {
  const d = t.data as { label: string; unit: string; current7d: { mean: number | null; daysWithData: number; days: number }; baseline28d: { mean: number | null; daysWithData: number; days: number }; deltaPct: number | null; changeClass: string };
  if (d.changeClass === 'INSUFFICIENT_EVIDENCE' || d.current7d?.mean == null) return `${d.label}: insufficient evidence (${d.current7d?.daysWithData ?? 0}/${d.current7d?.days ?? 7} days this period, ${d.baseline28d?.daysWithData ?? 0}/${d.baseline28d?.days ?? 28} in the baseline).`;
  return `${d.label}: ${fmt(d.current7d.mean)} ${d.unit} vs ${fmt(d.baseline28d.mean)} ${d.unit} baseline (${d.deltaPct == null ? '—' : `${d.deltaPct > 0 ? '+' : ''}${fmt(d.deltaPct)}%`}) — ${d.changeClass.toLowerCase().replace('_', ' ')}.`;
};
const isFavourable = (t: PacketItem) => t.data.favourable === true || (t.data.metricId === 'sleep_duration' && Number(t.data.delta) > 0 && t.data.favourable === null);
const isUnfavourable = (t: PacketItem) => t.data.favourable === false || (t.data.metricId === 'sleep_duration' && Number(t.data.delta) < 0 && t.data.favourable === null);
const changed = (t: PacketItem) => t.data.changeClass === 'MEANINGFUL' || t.data.changeClass === 'DIRECTIONAL';

export function buildPriorities(recommendations: Recommendation[], limit = 3): Array<{ rank: number; title: string; text: string; recommendationId: string | null; insufficient: boolean }> {
  const active = recommendations.filter((r) => ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'DISCUSS_WITH_CLINICIAN'].includes(r.status)).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const out: Array<{ rank: number; title: string; text: string; recommendationId: string | null; insufficient: boolean }> = active.slice(0, limit).map((r, i) => ({ rank: i + 1, title: r.title, text: r.proposedAction, recommendationId: r.id, insufficient: false }));
  while (out.length < limit) out.push({ rank: out.length + 1, title: 'No further priority this period', text: 'Not enough evidence for another priority; none is manufactured.', recommendationId: null, insufficient: true });
  return out;
}

export function assembleWeeklyReport(input: WeeklyReportInputs) {
  const { packet, recommendations, narrative } = input;
  const trends = itemsOfKind(packet, 'trend');
  const signals = itemsOfKind(packet, 'signal');
  const byDomain = (domain: string) => trends.filter((t) => t.domain === domain);
  const improved = trends.filter((t) => changed(t) && isFavourable(t));
  const deteriorated = trends.filter((t) => changed(t) && isUnfavourable(t));
  const insufficient = trends.filter((t) => t.data.changeClass === 'INSUFFICIENT_EVIDENCE');
  const bp = itemsOfKind(packet, 'bp')[0];
  const labs = itemsOfKind(packet, 'lab');
  const flagged = labs.filter((l) => l.data.flagged === true);
  const preventive = itemsOfKind(packet, 'preventive');
  const sources = itemsOfKind(packet, 'source');
  const glucoseDays = itemsOfKind(packet, 'glucose_day');
  const nutrition = itemsOfKind(packet, 'nutrition_7d')[0];
  const repeated = itemsOfKind(packet, 'glucose_repeated');

  const executiveSummary = [
    `Latest 7 complete days (${packet.period.from} → ${packet.period.to}) versus the preceding 28 days (${packet.period.baselineFrom} → ${packet.period.baselineTo}).`,
    `Domains: ${packet.domainStatuses.map((d) => `${d.domain.replace(/_/g, ' ')} ${d.status.replace(/_/g, ' ').toLowerCase()}`).join('; ')}.`,
    `${improved.length} metric(s) improved, ${deteriorated.length} deteriorated, ${trends.length - improved.length - deteriorated.length - insufficient.length} within normal variation, ${insufficient.length} with insufficient coverage.`,
    `${packet.dataQuality.connectedSources} connected source(s), ${packet.dataQuality.staleSources} stale; ${packet.dataQuality.observations30d.toLocaleString('en-US')} observations in 30 days.`,
  ];
  const sections: ReportSection[] = [
    section('kpi_scorecard', 'KPI scorecard (7-day vs 28-day)', 'DERIVED_TREND', trends.map(trendLine), trends.map((t) => ({ id: t.id, ...t.data }))),
    section('improved', 'What improved', 'DERIVED_TREND', improved.map(trendLine), improved.map((t) => ({ id: t.id })), 'No metric improved meaningfully or directionally versus baseline.'),
    section('deteriorated', 'What deteriorated', 'DERIVED_TREND', deteriorated.map(trendLine), deteriorated.map((t) => ({ id: t.id })), 'No metric deteriorated meaningfully or directionally versus baseline.'),
    section('recovery', 'Recovery', 'DERIVED_TREND', byDomain('recovery').map(trendLine), [], 'No recovery metrics with enough coverage this period.'),
    section('activity', 'Activity and exercise', 'DERIVED_TREND', byDomain('cardio').filter((t) => !String(t.data.metricId).startsWith('blood_pressure') && t.data.metricId !== 'pulse').map(trendLine), [], 'No activity metrics with enough coverage this period.'),
    section('body', 'Body composition', 'DERIVED_TREND', byDomain('strength_body').map(trendLine), [], 'No body-composition metrics with enough coverage this period.'),
    section('glucose_nutrition', 'Glucose and nutrition', 'MEASURED_FACT', [...glucoseDays.map((g) => g.text), ...repeated.map((r) => r.text), ...(nutrition ? [nutrition.text] : []), ...byDomain('metabolic_nutrition').map(trendLine)], [], 'No glucose or nutrition data this period.'),
    section('blood_pressure', 'Blood pressure', 'MEASURED_FACT', bp ? [bp.text] : [], bp ? [{ id: bp.id, ...bp.data }] : [], 'No home blood-pressure readings this period.'),
    section('clinical_preventive', 'Clinical and preventive health', 'MEASURED_FACT', [...labs.slice(0, 12).map((l) => l.text), ...preventive.map((p) => p.text)], [], 'No confirmed laboratory results or preventive items yet.'),
    section('data_quality', 'Data quality', 'MEASURED_FACT', [...sources.map((s) => s.text), ...packet.dataQuality.notes], [], 'No sources connected.'),
    section('signals_vs_noise', 'Meaningful signals vs noise', 'DERIVED_TREND', [...signals.map((s) => s.text), `${trends.filter((t) => t.data.changeClass === 'NOISE').length} metric(s) moved within normal variation (noise); ${insufficient.length} could not be judged for lack of coverage.`]),
  ];
  const priorities = buildPriorities(recommendations);
  const physicianFollowUp = [
    ...recommendations.filter((r) => r.clinicianReviewStatus === 'RECOMMENDED' && r.status !== 'DISMISSED' && r.status !== 'COMPLETED').map((r) => `${r.title}: ${r.reason}`),
    ...flagged.map((l) => `Lab-flagged: ${l.text}`),
    ...preventive.filter((p) => p.data.computedStatus === 'DUE').map((p) => `Preventive item due: ${String(p.data.title)}`),
    ...narrative.physicianQuestions.map((q) => `Question (AI, cites packet items): ${q}`),
  ];
  return {
    algorithm: 'weekly_health_ceo' as const,
    version: 1,
    dataThrough: input.dataThrough,
    executiveSummary,
    sections,
    priorities,
    physicianFollowUp: physicianFollowUp.length ? physicianFollowUp : ['Nothing flagged for clinician follow-up this week.'],
    aiNarrative: narrative,
    packetHash: packet.hash,
  };
}

export interface MonthlyReportInputs {
  packet: AnalysisPacket; // kind 'monthly': trend items carry current30 / prior90 / pct365
  recommendations: Recommendation[];
  narrative: AiNarrative;
  experiments: { completed: Array<Record<string, unknown>>; current: Array<Record<string, unknown>> };
  dataThrough: string;
}

export function assembleMonthlyReport(input: MonthlyReportInputs) {
  const { packet, recommendations, narrative } = input;
  const trends = itemsOfKind(packet, 'trend');
  const line = (t: PacketItem) => {
    const d = t.data as { label: string; unit: string; current30: { mean: number | null; daysWithData: number }; prior90: { mean: number | null; daysWithData: number }; deltaPct: number | null; changeClass: string; pct365: number | null };
    if (d.changeClass === 'INSUFFICIENT_EVIDENCE' || d.current30?.mean == null) return `${d.label}: insufficient evidence (${d.current30?.daysWithData ?? 0}/30 days).`;
    return `${d.label}: ${fmt(d.current30.mean)} ${d.unit} over 30 days vs ${fmt(d.prior90?.mean)} ${d.unit} in the prior 90 (${d.deltaPct == null ? '—' : `${d.deltaPct > 0 ? '+' : ''}${fmt(d.deltaPct)}%`}, ${d.changeClass.toLowerCase().replace('_', ' ')})${d.pct365 != null ? `; this month sits at the ${fmt(d.pct365, 0)}th percentile of the last 365 days` : ''}.`;
  };
  const improved = trends.filter((t) => changed(t) && isFavourable(t));
  const deteriorated = trends.filter((t) => changed(t) && isUnfavourable(t));
  const scorecard = packet.domainStatuses.map((d) => `${d.domain.replace(/_/g, ' ')}: ${d.status.replace(/_/g, ' ').toLowerCase()} — ${d.evidence[0] ?? ''}`);
  const risks = [
    ...itemsOfKind(packet, 'lab').filter((l) => l.data.flagged === true).map((l) => `Lab-flagged: ${l.text}`),
    ...itemsOfKind(packet, 'bp').filter((b) => { const avg = b.data.avg30d as { systolic: number; diastolic: number } | null; const t = b.data.target as { systolicMax: number; diastolicMax: number } | undefined; return avg && t && (avg.systolic >= t.systolicMax || avg.diastolic >= t.diastolicMax); }).map((b) => `Blood pressure 30-day average at or above target: ${b.text}`),
    ...itemsOfKind(packet, 'preventive').filter((p) => p.data.computedStatus === 'DUE').map((p) => `Preventive item overdue: ${String(p.data.title)}`),
    ...itemsOfKind(packet, 'source').filter((s) => ['STALE', 'SYNC_ERROR'].includes(String(s.data.freshness))).map((s) => `Source not current: ${s.text}`),
  ];
  const maintain = recommendations.filter((r) => (r.status === 'COMPLETED' || r.status === 'ACCEPTED' || r.status === 'IN_PROGRESS') && r.outcome && (r.outcome as { changeClass?: string; favourable?: boolean }).favourable === true).map((r) => `${r.title} — outcome favourable (${String((r.outcome as { summary?: string }).summary ?? '')})`);
  const discontinue = recommendations.filter((r) => r.outcome && (r.outcome as { favourable?: boolean | null }).favourable === false).map((r) => `${r.title} — outcome unfavourable or unchanged (${String((r.outcome as { summary?: string }).summary ?? '')})`);
  const sections: ReportSection[] = [
    section('scorecard', 'Five-domain scorecard', 'DERIVED_TREND', scorecard),
    section('trends', 'Last 30 days vs prior 90 days (365-day percentile)', 'DERIVED_TREND', trends.map(line)),
    section('improved', 'Improvements', 'DERIVED_TREND', improved.map(line), [], 'No meaningful or directional improvement over the prior 90 days.'),
    section('deteriorated', 'Deterioration', 'DERIVED_TREND', deteriorated.map(line), [], 'No meaningful or directional deterioration over the prior 90 days.'),
    section('risk_register', 'Risk register (facts for clinician review, not diagnoses)', 'MEASURED_FACT', risks, [], 'No lab flags, blood-pressure targets exceeded, overdue items or stale sources.'),
    section('source_quality', 'Source-quality audit', 'MEASURED_FACT', [...itemsOfKind(packet, 'source').map((s) => s.text), ...packet.dataQuality.notes], [], 'No sources connected.'),
    section('experiments_completed', 'Completed experiments', null, input.experiments.completed.map((e) => String(e.summary ?? e.title ?? '')), input.experiments.completed, 'No completed experiments (experiment engine arrives in Phase 7).'),
    section('experiments_current', 'Current experiments', null, input.experiments.current.map((e) => String(e.summary ?? e.title ?? '')), input.experiments.current, 'No experiments running.'),
    section('maintain', 'Interventions to maintain', 'DERIVED_TREND', maintain, [], 'No accepted recommendation has a measured favourable outcome yet.'),
    section('discontinue', 'Interventions to discontinue or re-test', 'DERIVED_TREND', discontinue, [], 'No accepted recommendation has a measured unfavourable outcome.'),
  ];
  return {
    algorithm: 'monthly_health_board' as const,
    version: 1,
    dataThrough: input.dataThrough,
    executiveSummary: [
      `Last 30 days (${packet.period.from} → ${packet.period.to}) against the prior 90-day context${packet.period.baselineFrom ? ` (${packet.period.baselineFrom} → ${packet.period.baselineTo})` : ''} and the 365-day history.`,
      `${improved.length} metric(s) improved, ${deteriorated.length} deteriorated; ${risks.length} item(s) in the risk register.`,
    ],
    sections,
    priorities: buildPriorities(recommendations),
    aiNarrative: narrative,
    packetHash: packet.hash,
  };
}
