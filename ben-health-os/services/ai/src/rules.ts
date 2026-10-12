/**
 * Deterministic recommendation rules (recommendation_rules v1). Each candidate links evidence
 * (packet items, labs, guidelines) and states confidence, effort, limitations and whether a clinician
 * should review it. Nothing here diagnoses or touches medication.
 */
import type { AnalysisPacket, CandidateRecommendation, EvidenceInput, PacketItem } from '@bho/contracts';
import { itemsOfKind } from './packet.js';

const GUIDELINES = {
  sleep: { citation: 'Watson NF et al. Recommended amount of sleep for a healthy adult: a joint consensus statement of the American Academy of Sleep Medicine and Sleep Research Society. Sleep. 2015;38(6):843–844.', publicationDate: '2015-06-01', population: 'healthy adults 18–60', strength: 'consensus statement', applicability: 'general adult guidance; not individualised' },
  activity: { citation: 'U.S. Department of Health and Human Services. Physical Activity Guidelines for Americans, 2nd edition. 2018.', publicationDate: '2018-11-01', population: 'adults', strength: 'national guideline', applicability: 'general adult guidance; not individualised' },
  bp: { citation: 'Whelton PK et al. 2017 ACC/AHA/AAPA/ABC/ACPM/AGS/APhA/ASH/ASPC/NMA/PCNA Guideline for the Prevention, Detection, Evaluation, and Management of High Blood Pressure in Adults. Hypertension. 2018;71(6):e13–e115.', publicationDate: '2018-06-01', population: 'adults', strength: 'clinical practice guideline', applicability: 'home readings; interpretation belongs to the clinician' },
} as const;
const VERIFY_NOTE = 'Citation recorded from the engineering team’s knowledge on 2026-10-12; verify at the official source before relying on it (last_verified_at is empty until then).';

function guideline(g: keyof typeof GUIDELINES): EvidenceInput {
  const x = GUIDELINES[g];
  return { evidenceType: 'GUIDELINE', citation: x.citation, publicationDate: x.publicationDate, population: x.population, strength: x.strength, applicability: x.applicability, limitations: 'Population guidance, not a personal target.', lastVerifiedAt: null, details: { verificationNote: VERIFY_NOTE } };
}
function itemEvidence(item: PacketItem, type: EvidenceInput['evidenceType'] = 'DERIVED_METRIC', refTable: string | null = null, refId: string | null = null): EvidenceInput {
  return { evidenceType: type, refTable, refId, citation: item.text, details: { packetItemId: item.id, ...item.data } };
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function generateRuleRecommendations(packet: AnalysisPacket): CandidateRecommendation[] {
  const out: CandidateRecommendation[] = [];
  const asOf = packet.period.to;
  const trends = itemsOfKind(packet, 'trend');
  const trend = (metricId: string) => trends.find((t) => t.data.metricId === metricId);
  const changed = (t: PacketItem | undefined) => t && (t.data.changeClass === 'MEANINGFUL' || t.data.changeClass === 'DIRECTIONAL');
  const confidenceFor = (t: PacketItem) => (t.data.changeClass === 'MEANINGFUL' ? 'MEDIUM' : 'LOW') as 'MEDIUM' | 'LOW';
  const base = { estimatedCost: 'none', claimType: 'RECOMMENDATION' as const, clinicianReviewStatus: 'NOT_REQUIRED' as const, initialStatus: 'NEW' as const, expiresInDays: 14, evidenceAsOf: asOf };

  // 1. Sleep duration fell
  const sleep = trend('sleep_duration');
  if (changed(sleep) && (num(sleep!.data.delta) ?? 0) < 0) {
    out.push({ ...base, ruleKey: 'sleep_decline', title: 'Protect sleep this week', category: 'SLEEP', observation: sleep!.text, interpretation: 'A shorter 7-day sleep mean than the preceding 28 days; cause unknown.', reason: `Sleep duration changed ${String(sleep!.data.changeClass).toLowerCase()}ly versus baseline.`, proposedAction: 'Hold a consistent bedtime for the next 7 nights, keep the hour before bed screen-free, and re-check the 7-day mean next week.', expectedBenefit: 'Sleep duration back toward your 28-day baseline.', requiredEffort: 'LOW', confidence: confidenceFor(sleep!), limitations: 'A 7-day window can reflect travel, illness or a late week; this is not a sleep-disorder assessment.', priority: sleep!.data.changeClass === 'MEANINGFUL' ? 1 : 2, outcomeMetric: 'sleep_duration', evidence: [itemEvidence(sleep!), guideline('sleep')], packetItemIds: [sleep!.id] });
  }
  // 2. Recovery strain: HRV down or resting HR up meaningfully
  const hrv = trend('hrv_rmssd');
  const rhr = trend('resting_heart_rate');
  const strain = [hrv, rhr].filter((t) => changed(t) && t!.data.favourable === false && t!.data.changeClass === 'MEANINGFUL') as PacketItem[];
  if (strain.length) {
    out.push({ ...base, ruleKey: 'recovery_strain', title: 'Plan an easier training week', category: 'RECOVERY', observation: strain.map((t) => t.text).join(' '), interpretation: 'Recovery markers moved unfavourably together with or without a training change; illness, alcohol and heat also move them.', reason: 'Meaningful unfavourable change in resting heart rate and/or HRV versus baseline.', proposedAction: 'Keep intensity moderate for a week (Zone 2 and mobility), prioritise sleep, and watch whether the 7-day means return toward baseline.', expectedBenefit: 'Recovery markers back toward baseline without losing training consistency.', requiredEffort: 'LOW', confidence: 'MEDIUM', limitations: 'Not a readiness prescription; wearable HRV is noisy and these markers are not diagnostic.', priority: 2, outcomeMetric: strain[0]!.data.metricId as string, evidence: strain.map((t) => itemEvidence(t)), packetItemIds: strain.map((t) => t.id) });
  }
  // 3. Movement fell
  const activity = ['steps', 'exercise_minutes', 'zone2_minutes'].map(trend).filter((t) => changed(t) && t!.data.favourable === false) as PacketItem[];
  if (activity.length) {
    out.push({ ...base, ruleKey: 'activity_decline', title: 'Rebuild daily movement', category: 'ACTIVITY', observation: activity.map((t) => t.text).join(' '), interpretation: 'Less movement than the preceding four weeks.', reason: 'Unfavourable change in steps, exercise minutes or Zone 2 minutes versus baseline.', proposedAction: 'Add two 20-minute walks on the days with the lowest step counts and keep the planned sessions; re-check next week.', expectedBenefit: 'Activity back to the 28-day baseline.', requiredEffort: 'MEDIUM', confidence: activity.some((t) => t.data.changeClass === 'MEANINGFUL') ? 'MEDIUM' : 'LOW', limitations: 'Phone and watch coverage differ; a week with travel or illness is not a trend.', priority: activity.some((t) => t.data.changeClass === 'MEANINGFUL') ? 2 : 3, outcomeMetric: activity[0]!.data.metricId as string, evidence: [...activity.map((t) => itemEvidence(t)), guideline('activity')], packetItemIds: activity.map((t) => t.id) });
  }
  // 4. Blood pressure above the configured target
  const bp = itemsOfKind(packet, 'bp')[0];
  if (bp) {
    const avg = bp.data.avg7d as { systolic: number; diastolic: number; n: number } | null;
    const target = bp.data.target as { systolicMax: number; diastolicMax: number; source: string; clinicianConfigured: boolean } | undefined;
    if (avg && target && avg.n >= 3 && (avg.systolic >= target.systolicMax || avg.diastolic >= target.diastolicMax)) {
      out.push({ ...base, ruleKey: 'bp_above_target', title: 'Discuss your blood-pressure trend with your clinician', category: 'CARDIOVASCULAR', observation: bp.text, interpretation: `The 7-day home average is at or above the ${target.clinicianConfigured ? 'clinician-set' : 'placeholder'} target of ${target.systolicMax}/${target.diastolicMax} mmHg.`, reason: 'Home cuff 7-day average at or above target.', proposedAction: 'Keep taking seated morning and evening readings for the next week and share the 7-day and 30-day averages with your clinician.', expectedBenefit: 'A clinician decision based on a proper home-reading series rather than single values.', requiredEffort: 'LOW', confidence: avg.n >= 6 ? 'MEDIUM' : 'LOW', limitations: 'Home readings depend on technique and timing; an average above a target is not a diagnosis.', clinicianReviewStatus: 'RECOMMENDED', initialStatus: 'DISCUSS_WITH_CLINICIAN', priority: 1, outcomeMetric: 'blood_pressure_systolic', evidence: [itemEvidence(bp, 'OBSERVATION'), guideline('bp')], packetItemIds: [bp.id] });
    }
  }
  // 5. Repeated meals with large glucose excursions → hypothesis / experiment proposal
  for (const m of itemsOfKind(packet, 'glucose_repeated')) {
    const peak = num(m.data.meanPeakDelta);
    const n = num(m.data.occurrences) ?? 0;
    if (peak !== null && peak >= 50 && n >= 3) {
      out.push({ ...base, ruleKey: `glucose_excursions:${String(m.data.label)}`, title: `Large post-meal glucose rises after “${String(m.data.label)}”`, category: 'METABOLIC', claimType: 'HYPOTHESIS', observation: m.text, interpretation: 'The same meal label repeatedly shows a large 2-hour rise; composition, portion and timing are plausible factors.', reason: `Mean peak rise ≥ 50 mg/dL across ${n} occurrences.`, proposedAction: 'Consider an N-of-1 experiment: eat fibre/protein before the carbohydrate or take a 10-minute walk after this meal for two weeks and compare the 2-hour peaks.', expectedBenefit: 'Smaller post-meal rises for this meal, if the pattern is causal.', requiredEffort: 'LOW', confidence: 'LOW', limitations: 'Correlation only; sleep, stress and portions differ between days. Not a diagnosis of glucose intolerance.', priority: 3, outcomeMetric: 'blood_glucose', evidence: [itemEvidence(m)], packetItemIds: [m.id] });
    }
  }
  // 6. Laboratory flagged values on the latest panel
  const flagged = itemsOfKind(packet, 'lab').filter((l) => l.data.flagged === true);
  if (flagged.length) {
    out.push({ ...base, ruleKey: 'lab_flagged', title: 'Review flagged laboratory results with your clinician', category: 'CLINICAL', observation: flagged.map((l) => l.text).join(' '), interpretation: 'The laboratory flagged these values against its own reference range.', reason: `${flagged.length} lab-flagged value(s) on the latest confirmed results.`, proposedAction: 'Bring the flagged results and their history to your next visit (the physician brief lists them with dates and ranges).', expectedBenefit: 'Clinician interpretation in context, instead of self-interpretation.', requiredEffort: 'LOW', confidence: 'HIGH', limitations: 'Lab flags use the laboratory’s reference range; they are not a diagnosis.', clinicianReviewStatus: 'RECOMMENDED', initialStatus: 'DISCUSS_WITH_CLINICIAN', priority: 2, outcomeMetric: null, evidence: flagged.map((l) => itemEvidence(l, 'LAB_RESULT', 'lab_results', typeof l.data.id === 'string' ? (l.data.id as string) : null)), packetItemIds: flagged.map((l) => l.id) });
  }
  // 7. Preventive care due
  for (const p of itemsOfKind(packet, 'preventive').filter((p) => p.data.computedStatus === 'DUE')) {
    out.push({ ...base, ruleKey: `preventive_due:${String(p.data.id ?? p.data.title)}`, title: `Schedule: ${String(p.data.title)}`, category: 'PREVENTIVE', observation: p.text, interpretation: null, reason: 'Past the due date computed from your last completion and interval.', proposedAction: `Book ${String(p.data.title).toLowerCase()} and mark it completed afterwards.`, expectedBenefit: 'Preventive item back on schedule.', requiredEffort: 'LOW', confidence: 'HIGH', limitations: 'The interval is yours or your clinician’s; the app does not judge whether the screening applies.', priority: 2, outcomeMetric: null, expiresInDays: 60, evidence: [{ evidenceType: 'GUIDELINE', citation: String(p.data.guidelineSource ?? ''), details: { packetItemId: p.id, recordedByUser: true } }], packetItemIds: [p.id] });
  }
  // 8. Sources not syncing
  const broken = itemsOfKind(packet, 'source').filter((s) => ['STALE', 'SYNC_ERROR'].includes(String(s.data.freshness)) || ['EXPIRED', 'REVOKED', 'ERROR'].includes(String(s.data.connectionStatus)));
  for (const s of broken) {
    out.push({ ...base, ruleKey: `source_stale:${String(s.data.connector)}`, title: `Fix ${String(s.data.displayName ?? s.data.connector)} synchronization`, category: 'DATA', observation: s.text, interpretation: null, reason: 'Without current data the trends for this source cannot be judged.', proposedAction: 'Open Data Sources and follow the connector note (reconnect, grant permissions or open the vendor app).', expectedBenefit: 'Current data for the affected metrics.', requiredEffort: 'LOW', confidence: 'HIGH', limitations: null, priority: 3, outcomeMetric: null, expiresInDays: 7, evidence: [itemEvidence(s, 'OBSERVATION')], packetItemIds: [s.id] });
  }
  // 9. Medication review overdue
  const review = itemsOfKind(packet, 'medication_review')[0];
  if (review && (num(review.data.medicationsCount) ?? 0) > 0) {
    const last = typeof review.data.lastReconciledAt === 'string' ? review.data.lastReconciledAt : null;
    const overdue = !last || Date.parse(asOf) - Date.parse(last) > 365 * 86_400_000;
    if (overdue) out.push({ ...base, ruleKey: 'medication_review_due', title: 'Medication review with your clinician or pharmacist', category: 'MEDICATION', observation: review.text, interpretation: null, reason: last ? 'More than a year since the last reconciliation.' : 'The medication list has never been reconciled.', proposedAction: 'Reconcile the list on the Medications page and confirm it at the next visit.', expectedBenefit: 'A confirmed medication list for the physician brief.', requiredEffort: 'LOW', confidence: 'HIGH', limitations: 'The app records the list; any change is the clinician’s decision.', clinicianReviewStatus: 'RECOMMENDED', priority: 3, outcomeMetric: null, expiresInDays: 90, evidence: [itemEvidence(review, 'USER_REPORT')], packetItemIds: [review.id] });
  }
  // 10. Protein below the user's own target
  const nutrition = itemsOfKind(packet, 'nutrition_7d')[0];
  if (nutrition) {
    const targets = (nutrition.data.targets ?? {}) as Record<string, unknown>;
    const mean = (nutrition.data.mean7d ?? {}) as Record<string, unknown>;
    const target = num(targets.protein_g);
    const actual = num(mean.protein_g);
    if (target !== null && actual !== null && (num(nutrition.data.daysWithData7d) ?? 0) >= 4 && actual < 0.9 * target) {
      out.push({ ...base, ruleKey: 'protein_below_target', title: 'Protein intake below your target', category: 'NUTRITION', observation: nutrition.text, interpretation: null, reason: `7-day mean ${Math.round(actual)} g versus your target ${Math.round(target)} g.`, proposedAction: 'Add a protein-forward breakfast or a post-training serving on the lowest days; re-check the 7-day mean next week.', expectedBenefit: 'Protein intake at your own target.', requiredEffort: 'MEDIUM', confidence: 'MEDIUM', limitations: 'The target is yours (or your clinician’s), not a population recommendation; logged days only.', priority: 3, outcomeMetric: 'protein_g', evidence: [itemEvidence(nutrition, 'USER_REPORT')], packetItemIds: [nutrition.id] });
    }
  }
  // 11. Imported labs waiting for review
  const pending = itemsOfKind(packet, 'labs_pending')[0];
  if (pending && (num(pending.data.pendingReview) ?? 0) > 0) {
    out.push({ ...base, ruleKey: 'labs_pending_review', title: 'Review imported lab results', category: 'DATA', observation: pending.text, interpretation: null, reason: 'Staged results do not count until reviewed.', proposedAction: 'Open Labs, check the mapping and values, and confirm or reject each row.', expectedBenefit: 'Lab history complete for trends and the physician brief.', requiredEffort: 'LOW', confidence: 'HIGH', limitations: null, priority: 3, outcomeMetric: null, expiresInDays: 30, evidence: [itemEvidence(pending, 'USER_REPORT')], packetItemIds: [pending.id] });
  }

  // Weekly priorities are capped at three; everything else is listed without a rank.
  const ranked = [...out].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || confidenceRank(b.confidence) - confidenceRank(a.confidence));
  ranked.forEach((c, i) => {
    c.priority = i < 3 ? i + 1 : null;
  });
  return ranked;
}

function confidenceRank(c: 'LOW' | 'MEDIUM' | 'HIGH'): number {
  return c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : 1;
}
