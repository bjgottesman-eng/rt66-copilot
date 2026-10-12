import type { AnalysisPacket, PacketItem } from '@bho/contracts';
import { assemblePacket } from '../src/packet.js';

const trend = (metricId: string, label: string, unit: string, domain: string, cur: number, base: number, changeClass: string, favourable: boolean | null, sources = ['health_connect']): PacketItem => ({
  id: `trend:${metricId}:7v28`,
  claimType: 'DERIVED_TREND',
  domain,
  kind: 'trend',
  text: `${label}: 7-day mean ${cur} ${unit} vs 28-day baseline ${base} ${unit} (${changeClass.toLowerCase()}).`,
  data: { metricId, label, unit, domain, current7d: { mean: cur, daysWithData: 7, days: 7, coverage: 1 }, baseline28d: { mean: base, daysWithData: 26, days: 28, coverage: 0.93 }, delta: cur - base, deltaPct: Math.round(((cur - base) / base) * 1000) / 10, changeClass, favourable, explanation: 'x' },
  sources,
  asOf: '2026-10-11',
});

export function makeItems(): PacketItem[] {
  return [
    trend('sleep_duration', 'Sleep duration', 'min', 'recovery', 395, 435, 'MEANINGFUL', null),
    trend('hrv_rmssd', 'HRV', 'ms', 'recovery', 38, 46, 'MEANINGFUL', false, ['oura']),
    trend('resting_heart_rate', 'Resting heart rate', 'bpm', 'recovery', 56, 55, 'NOISE', null),
    trend('steps', 'Steps', 'steps', 'cardio', 6800, 8900, 'DIRECTIONAL', false),
    trend('weight', 'Weight', 'kg', 'strength_body', 80.1, 80.4, 'NOISE', null),
    trend('exercise_minutes', 'Exercise minutes', 'min', 'cardio', 40, 32, 'DIRECTIONAL', true),
    trend('protein_g', 'Protein', 'g', 'metabolic_nutrition', 110, 112, 'NOISE', null),
    { id: 'trend:vo2_max:7v28', claimType: 'DERIVED_TREND', domain: 'cardio', kind: 'trend', text: 'VO2 max: insufficient evidence.', data: { metricId: 'vo2_max', label: 'VO2 max', unit: 'mL/kg/min', domain: 'cardio', current7d: { mean: null, daysWithData: 1, days: 7, coverage: 0.14 }, baseline28d: { mean: null, daysWithData: 2, days: 28, coverage: 0.07 }, delta: null, deltaPct: null, changeClass: 'INSUFFICIENT_EVIDENCE', favourable: null, explanation: 'insufficient' }, sources: ['oura'], asOf: '2026-10-11' },
    { id: 'signal:1', claimType: 'DERIVED_TREND', domain: 'recovery', kind: 'signal', text: 'Sleep duration: meaningful decrease of 40 min (−9%) vs baseline.', data: { metricId: 'sleep_duration', kind: 'MEANINGFUL_CHANGE', direction: 'unfavourable', priority: 1 }, sources: ['health_connect'], asOf: '2026-10-11' },
    { id: 'bp:30d', claimType: 'MEASURED_FACT', domain: 'cardio', kind: 'bp', text: 'Blood pressure: 7-day average 138/88 mmHg over 8 readings; 30-day average 134/86 (31 readings); target below 130/80 (default placeholder).', data: { avg7d: { systolic: 138, diastolic: 88, n: 8 }, avg30d: { systolic: 134, diastolic: 86, n: 31 }, target: { systolicMax: 130, diastolicMax: 80, source: 'placeholder', clinicianConfigured: false } }, sources: ['withings'], asOf: '2026-10-11' },
    { id: 'lab:11111111-1111-4111-8111-111111111111', claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'lab', text: 'LDL-C 112 mg/dL on 2026-09-20 (reference <100, lab flag H; Quest).', data: { id: '11111111-1111-4111-8111-111111111111', analyteKey: 'ldl_c', label: 'LDL-C', value: 112, unit: 'mg/dL', abnormalFlag: 'H', flagged: true, collectedAt: '2026-09-20' }, sources: ['function_health'], asOf: '2026-09-20' },
    { id: 'lab:22222222-2222-4222-8222-222222222222', claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'lab', text: 'ApoB 78 mg/dL on 2026-09-20 (reference <90; Quest).', data: { id: '22222222-2222-4222-8222-222222222222', analyteKey: 'apob', label: 'ApoB', value: 78, unit: 'mg/dL', abnormalFlag: null, flagged: false, collectedAt: '2026-09-20' }, sources: ['function_health'], asOf: '2026-09-20' },
    { id: 'labs:pending', claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'labs_pending', text: '2 imported lab result(s) are waiting for review.', data: { pendingReview: 2 }, sources: ['function_health'], asOf: '2026-10-11' },
    { id: 'preventive:p1', claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'preventive', text: 'Annual physical: DUE (due 2026-09-01).', data: { id: 'p1', title: 'Annual physical', computedStatus: 'DUE', computedDueAt: '2026-09-01', guidelineSource: 'Primary care clinician' }, sources: ['manual'], asOf: '2026-10-11' },
    { id: 'source:oura', claimType: 'MEASURED_FACT', domain: 'data_quality', kind: 'source', text: 'Oura: connected, STALE (last successful sync 9 days ago).', data: { connector: 'oura', displayName: 'Oura', connectionStatus: 'CONNECTED', freshness: 'STALE' }, sources: ['oura'], asOf: '2026-10-11' },
    { id: 'source:health_connect', claimType: 'MEASURED_FACT', domain: 'data_quality', kind: 'source', text: 'Health Connect: connected, CURRENT.', data: { connector: 'health_connect', displayName: 'Health Connect', connectionStatus: 'CONNECTED', freshness: 'CURRENT' }, sources: ['health_connect'], asOf: '2026-10-11' },
    { id: 'medication_review', claimType: 'MEASURED_FACT', domain: 'clinical_preventive', kind: 'medication_review', text: '2 medication(s) on file; never reconciled.', data: { medicationsCount: 2, lastReconciledAt: null }, sources: ['manual'], asOf: '2026-10-11' },
    { id: 'nutrition:7d', claimType: 'MEASURED_FACT', domain: 'metabolic_nutrition', kind: 'nutrition_7d', text: 'Nutrition (6 of 7 days logged): 2,250 kcal, 110 g protein, 27 g fibre per day.', data: { mean7d: { calories: 2250, protein_g: 110, fiber_g: 27 }, daysWithData7d: 6, targets: { protein_g: 150 } }, sources: ['cronometer'], asOf: '2026-10-11' },
    { id: 'glucose:repeated:lunch', claimType: 'DERIVED_TREND', domain: 'metabolic_nutrition', kind: 'glucose_repeated', text: 'Lunch: 4 occurrences, mean 2-hour peak +62 mg/dL.', data: { label: 'lunch', occurrences: 4, meanPeakDelta: 62, meanIAuc: 3100 }, sources: ['health_connect'], asOf: '2026-10-11' },
  ];
}

export function makePacket(opts: { forProvider?: boolean; enabled?: boolean; excluded?: string[] } = {}): AnalysisPacket {
  return assemblePacket(
    {
      kind: 'weekly',
      generatedAt: '2026-10-12T12:00:00Z',
      period: { from: '2026-10-05', to: '2026-10-11', baselineFrom: '2026-09-07', baselineTo: '2026-10-04' },
      timeZone: 'America/New_York',
      subject: { ageYears: 40, sexAtBirth: null },
      sharing: { enabled: opts.enabled ?? false, excludedConnectors: opts.excluded ?? ['oura'] },
      items: makeItems(),
      domainStatuses: [{ domain: 'recovery', status: 'ATTENTION', evidence: ['Sleep duration: meaningful decrease'] }, { domain: 'cardio', status: 'WATCH', evidence: [] }, { domain: 'strength_body', status: 'STEADY', evidence: [] }, { domain: 'metabolic_nutrition', status: 'STEADY', evidence: [] }, { domain: 'clinical_preventive', status: 'WATCH', evidence: ['1 lab-flagged value'] }],
      dataQuality: { connectedSources: 3, staleSources: 1, observations30d: 12000, notes: [] },
    },
    { forProvider: opts.forProvider ?? false },
  );
}
