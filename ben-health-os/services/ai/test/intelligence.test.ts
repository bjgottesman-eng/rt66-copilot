import { describe, expect, it } from 'vitest';
import { assembleMonthlyReport, assembleWeeklyReport, forbiddenReason, generateRuleRecommendations, MockAiProvider, validateAiResponse, AI_INSTRUCTIONS } from '../src/index.js';
import { makeItems, makePacket } from './fixtures.js';
import type { Recommendation } from '@bho/contracts';

describe('analysis packet', () => {
  it('applies the sharing controls only for providers, keeps ids stable and hashes content', () => {
    const local = makePacket({ forProvider: false });
    const forProvider = makePacket({ forProvider: true, excluded: ['oura'] });
    expect(local.items).toHaveLength(makeItems().length);
    expect(local.sharing.droppedItems).toBe(0);
    expect(forProvider.items.some((i) => i.sources.includes('oura'))).toBe(false);
    expect(forProvider.sharing.droppedItems).toBe(3); // HRV trend, VO2 max trend, Oura source item
    expect(forProvider.instructions).toEqual(AI_INSTRUCTIONS);
    expect(local.hash).toHaveLength(32);
    expect(makePacket({ forProvider: false }).hash).toBe(local.hash);
    expect(local.hash).not.toBe(forProvider.hash);
  });
});

describe('recommendation rules', () => {
  const packet = makePacket();
  const recs = generateRuleRecommendations(packet);
  it('raises every applicable rule with evidence and packet citations', () => {
    const keys = recs.map((r) => r.ruleKey);
    expect(keys).toEqual(expect.arrayContaining(['sleep_decline', 'recovery_strain', 'activity_decline', 'bp_above_target', 'glucose_excursions:lunch', 'lab_flagged', 'preventive_due:p1', 'source_stale:oura', 'medication_review_due', 'protein_below_target', 'labs_pending_review']));
    expect(recs.every((r) => r.evidence.length >= 1 && r.packetItemIds.length >= 1)).toBe(true);
    expect(recs.every((r) => r.packetItemIds.every((id) => packet.items.some((i) => i.id === id)))).toBe(true);
    const bp = recs.find((r) => r.ruleKey === 'bp_above_target')!;
    expect(bp).toMatchObject({ clinicianReviewStatus: 'RECOMMENDED', initialStatus: 'DISCUSS_WITH_CLINICIAN', claimType: 'RECOMMENDATION', confidence: 'MEDIUM' });
    expect(bp.evidence.some((e) => e.evidenceType === 'GUIDELINE' && e.citation?.includes('2017 ACC/AHA'))).toBe(true);
    expect(bp.evidence.find((e) => e.evidenceType === 'GUIDELINE')!.lastVerifiedAt).toBeNull();
    expect(recs.find((r) => r.ruleKey === 'glucose_excursions:lunch')!.claimType).toBe('HYPOTHESIS');
    expect(recs.find((r) => r.ruleKey === 'lab_flagged')!.evidence[0]).toMatchObject({ evidenceType: 'LAB_RESULT', refTable: 'lab_results', refId: '11111111-1111-4111-8111-111111111111' });
    expect(recs.find((r) => r.ruleKey === 'protein_below_target')!.reason).toContain('target 150');
  });
  it('caps weekly priorities at three and never touches medication', () => {
    expect(recs.filter((r) => r.priority !== null)).toHaveLength(3);
    expect(recs.filter((r) => r.priority !== null).map((r) => r.priority)).toEqual([1, 2, 3]);
    expect(recs[0]!.ruleKey).toBe('sleep_decline'); // priority 1, higher confidence than the BP rule's MEDIUM? both MEDIUM → stable order by priority then confidence
    expect(recs.every((r) => forbiddenReason(`${r.title}. ${r.proposedAction} ${r.reason}`) === null)).toBe(true);
  });
  it('is quiet when nothing changed', () => {
    const quiet = makePacket();
    quiet.items = quiet.items.filter((i) => i.kind === 'trend' && i.data.changeClass === 'NOISE');
    expect(generateRuleRecommendations(quiet)).toEqual([]);
  });
});

describe('AI response validation', () => {
  const packet = makePacket({ forProvider: true });
  it('accepts cited findings, drops invalid citations, rejects forbidden phrasing and malformed responses', () => {
    const ok = validateAiResponse({ summary: 'Sleep fell this week.', findings: [{ claimType: 'HYPOTHESIS', title: 'Sleep', text: 'Sleep duration fell versus baseline.', citations: ['trend:sleep_duration:7v28', 'nope'], confidence: 'MEDIUM', category: 'recovery' }], physicianQuestions: ['How should the LDL flag be followed up?'] }, packet);
    expect(ok.accepted).toHaveLength(1);
    expect(ok.accepted[0]!.citations).toEqual(['trend:sleep_duration:7v28']);
    expect(ok.rejected).toEqual([]);
    const bad = validateAiResponse({ summary: 'You have hypertension.', findings: [{ claimType: 'RECOMMENDATION', title: 'Statin', text: 'Stop taking your statin medication.', citations: ['trend:sleep_duration:7v28'], confidence: 'HIGH', category: 'x' }, { claimType: 'RECOMMENDATION', title: 'Uncited', text: 'Walk more.', citations: ['ghost:1'], confidence: 'LOW', category: 'x' }, { claimType: 'HYPOTHESIS', title: 'Emergency', text: 'This could be a heart attack, call 911.', citations: ['bp:30d'], confidence: 'LOW', category: 'x' }], physicianQuestions: ['Should I stop my medication?'] }, packet);
    expect(bad.accepted).toEqual([]);
    expect(bad.rejected.map((r) => r.reason)).toEqual(['medication change', 'no valid packet citation', 'unsupported emergency claim']);
    expect(bad.summary).toMatch(/withheld/);
    expect(bad.physicianQuestions).toEqual([]);
    const malformed = validateAiResponse({ nope: true }, packet);
    expect(malformed.rejected[0]!.reason).toMatch(/malformed/);
  });
  it('mock provider output passes validation; its deliberate bad findings are rejected', async () => {
    const good = validateAiResponse(await new MockAiProvider().analyze(packet), packet);
    expect(good.accepted.length).toBeGreaterThan(0);
    expect(good.accepted.every((f) => f.citations.every((c) => packet.items.some((i) => i.id === c)))).toBe(true);
    expect(good.rejected).toEqual([]);
    expect(good.physicianQuestions.length).toBe(1);
    const withBad = validateAiResponse(await new MockAiProvider({ includeInvalid: true }).analyze(packet), packet);
    expect(withBad.rejected.map((r) => r.reason).sort()).toEqual(['medication change', 'no valid packet citation']);
  });
});

describe('report assembly', () => {
  const packet = makePacket();
  const narrative = { status: 'DISABLED' as const, provider: null, model: null, summary: null, findings: [], physicianQuestions: [], rejected: [], packetHash: packet.hash, note: 'AI sharing is off.' };
  const rec = (over: Partial<Recommendation>): Recommendation => ({ id: '33333333-3333-4333-8333-333333333333', ruleKey: 'sleep_decline', title: 'Protect sleep this week', category: 'SLEEP', observation: 'o', interpretation: null, reason: 'r', proposedAction: 'Consistent bedtime', expectedBenefit: null, requiredEffort: 'LOW', estimatedCost: null, confidence: 'MEDIUM', claimType: 'RECOMMENDATION', limitations: null, clinicianReviewStatus: 'NOT_REQUIRED', status: 'NEW', priority: 1, generatedBy: 'rules:v1', sourceReportId: null, expiresAt: null, outcomeMetric: 'sleep_duration', outcome: null, snoozedUntil: null, dismissReason: null, acceptedAt: null, completedAt: null, packetItemIds: [], createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', evidence: [], ...over });
  it('builds the 14 weekly sections with explicit insufficiency and exactly three priorities', () => {
    const r = assembleWeeklyReport({ packet, recommendations: [rec({})], narrative, dataThrough: '2026-10-11' });
    expect(r.sections.map((s) => s.key)).toEqual(['kpi_scorecard', 'improved', 'deteriorated', 'recovery', 'activity', 'body', 'glucose_nutrition', 'blood_pressure', 'clinical_preventive', 'data_quality', 'signals_vs_noise']);
    expect(r.executiveSummary.length + r.priorities.length + r.physicianFollowUp.length).toBeGreaterThan(5); // 11 sections + summary + priorities + follow-up = the 14 parts of §18
    expect(r.sections.find((s) => s.key === 'improved')!.lines[0]).toMatch(/Exercise minutes/);
    expect(r.sections.find((s) => s.key === 'deteriorated')!.lines.join(' ')).toMatch(/Sleep duration/);
    expect(r.sections.find((s) => s.key === 'deteriorated')!.lines.join(' ')).toMatch(/Steps/);
    expect(r.sections.find((s) => s.key === 'kpi_scorecard')!.lines.find((l) => l.startsWith('VO2 max'))).toMatch(/insufficient evidence/);
    expect(r.priorities).toHaveLength(3);
    expect(r.priorities[0]).toMatchObject({ rank: 1, title: 'Protect sleep this week', insufficient: false });
    expect(r.priorities[2]).toMatchObject({ rank: 3, insufficient: true });
    expect(r.physicianFollowUp.join(' ')).toMatch(/Lab-flagged: LDL-C/);
    expect(r.physicianFollowUp.join(' ')).toMatch(/Preventive item due/);
    const empty = assembleWeeklyReport({ packet: { ...packet, items: [] }, recommendations: [], narrative, dataThrough: '2026-10-11' });
    expect(empty.sections.every((s) => s.insufficient || s.key === 'signals_vs_noise')).toBe(true);
    expect(empty.priorities.every((p) => p.insufficient)).toBe(true);
  });
  it('builds the monthly board report with a risk register and interventions from outcomes', () => {
    const monthly = { ...packet, kind: 'monthly' as const, items: packet.items.map((i) => (i.kind === 'trend' ? { ...i, data: { ...i.data, current30: i.data.current7d, prior90: i.data.baseline28d, pct365: 42 } } : i)) };
    const r = assembleMonthlyReport({ packet: monthly, recommendations: [rec({ status: 'COMPLETED', outcome: { favourable: true, summary: '+30 min sleep' } }), rec({ id: '44444444-4444-4444-8444-444444444444', ruleKey: 'activity_decline', title: 'Rebuild daily movement', status: 'ACCEPTED', outcome: { favourable: false, summary: 'no change' } })], narrative, experiments: { completed: [], current: [] }, dataThrough: '2026-10-11' });
    expect(r.sections.map((s) => s.key)).toEqual(['scorecard', 'trends', 'improved', 'deteriorated', 'risk_register', 'source_quality', 'experiments_completed', 'experiments_current', 'maintain', 'discontinue']);
    expect(r.sections.find((s) => s.key === 'risk_register')!.lines.length).toBe(4);
    expect(r.sections.find((s) => s.key === 'maintain')!.lines[0]).toMatch(/Protect sleep/);
    expect(r.sections.find((s) => s.key === 'discontinue')!.lines[0]).toMatch(/Rebuild daily movement/);
    expect(r.sections.find((s) => s.key === 'experiments_completed')!.insufficient).toBe(true);
    expect(r.sections.find((s) => s.key === 'trends')!.lines[0]).toMatch(/42th percentile|42nd/);
  });
});
