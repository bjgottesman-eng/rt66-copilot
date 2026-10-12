import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CheckInsResponseSchema, ExperimentSchema, ExperimentsResponseSchema, ReportSchema, TrainingOverviewSchema } from '@bho/contracts';
import { addDays } from '@bho/analytics';
import { buildApp } from '../src/app.js';
import { login, uniqueEmail, TEST_DATABASE_URL } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_MODE: 'local', LOG_LEVEL: 'silent', ALLOW_DEMO_SEED: 'true', LOCAL_JWT_SECRET: 'test-secret-test-secret-test-secret', JOB_SECRET: 'reports-secret' });
});
afterAll(async () => {
  await app.close();
});

const TODAY = new Date().toISOString().slice(0, 10);
const rhrBatch = (days: Array<{ date: string; bpm: number }>) => ({
  source: 'health_connect', deviceInstanceId: 'test-device-00000007', appVersion: 't', timeZone: 'UTC', clientTime: new Date().toISOString(), mode: 'CHANGES', deletions: [],
  records: days.map((d) => ({ recordType: 'RestingHeartRate', hcId: `rhr-${d.date}`, dataOrigin: 'com.ouraring.oura', lastModifiedTime: `${d.date}T08:00:00Z`, recordingMethod: 'AUTOMATICALLY_RECORDED', time: `${d.date}T06:00:00Z`, zoneOffset: '+00:00', payload: { bpm: d.bpm } })),
});

describe('Phase 7: N-of-1 experiments', () => {
  it('runs an experiment end to end: create → adherence → evaluate (ADOPT) → decide → memory + monthly report', async () => {
    const { auth } = await login(app, uniqueEmail('exp'));
    const start = addDays(TODAY, -31); // 14 baseline + 14 intervention days, finished 3 days ago
    const days: Array<{ date: string; bpm: number }> = [];
    for (let i = 0; i < 28; i++) days.push({ date: addDays(start, i), bpm: (i < 14 ? 56 : 50) + (i % 2) });
    expect((await app.inject({ method: 'POST', url: '/v1/ingest/health-connect', headers: auth, payload: rhrBatch(days) })).statusCode).toBe(200);

    expect((await app.inject({ method: 'POST', url: '/v1/experiments', headers: auth, payload: { title: 'x', researchQuestion: 'q', hypothesis: 'h', intervention: 'i', primaryOutcomeMetric: 'not_a_metric' } })).statusCode).toBe(400);
    const created = ExperimentSchema.parse((await app.inject({ method: 'POST', url: '/v1/experiments', headers: auth, payload: { title: 'Evening walk after dinner', researchQuestion: 'Does a 20-minute walk after dinner lower my resting heart rate?', hypothesis: 'Resting heart rate falls by at least 3 bpm.', intervention: '20-minute walk after dinner', primaryOutcomeMetric: 'resting_heart_rate', secondaryOutcomeMetrics: ['hrv_rmssd'], design: 'BEFORE_AFTER', plannedBaselineDays: 14, plannedInterventionDays: 14, startDate: start, confounders: ['travel'] } })).json());
    expect(created.phases.map((p) => p.phase)).toEqual(['BASELINE', 'INTERVENTION']);
    expect(created.phases[1]).toMatchObject({ startDate: addDays(start, 14), endDate: addDays(start, 27) });
    expect(created.status).toBe('ANALYSIS');
    expect(created.evaluation).toBeNull();
    expect(created.daily.filter((d) => d.phase === 'INTERVENTION')).toHaveLength(14);

    // Adherence: outside the phases → 400; inside → stored on the intervention phase
    expect((await app.inject({ method: 'POST', url: `/v1/experiments/${created.id}/adherence`, headers: auth, payload: { date: addDays(start, -5), adhered: true } })).statusCode).toBe(400);
    for (let i = 14; i < 28; i++) expect((await app.inject({ method: 'POST', url: `/v1/experiments/${created.id}/adherence`, headers: auth, payload: { date: addDays(start, i), adhered: i !== 20, note: i === 20 ? 'rain' : null } })).statusCode).toBe(200);
    const evaluated = ExperimentSchema.parse((await app.inject({ method: 'POST', url: `/v1/experiments/${created.id}/evaluate`, headers: auth })).json());
    const ev = evaluated.evaluation!;
    expect(ev.complete).toBe(true);
    expect(ev.preliminary).toBe(false);
    expect(ev.changeClass).toBe('MEANINGFUL');
    expect(ev.favourable).toBe(true);
    expect(ev.verdict).toBe('ADOPT');
    expect(ev.adherenceRate).toBeCloseTo(13 / 14, 5);
    expect(ev.delta).toBeCloseTo(-6, 5);
    expect(ev.secondary[0]).toMatchObject({ metricId: 'hrv_rmssd', changeClass: 'INSUFFICIENT_EVIDENCE' });
    expect(ev.limitations.join(' ')).toMatch(/Before\/after design/);
    expect(ev.limitations.join(' ')).toMatch(/travel/);
    expect(ev.summary).not.toMatch(/caus/i);

    // Decision closes it, writes a memory, and the monthly board report lists it
    const decided = ExperimentSchema.parse((await app.inject({ method: 'PATCH', url: `/v1/experiments/${created.id}`, headers: auth, payload: { action: 'decide', decision: 'ADOPT', decisionNote: 'Keep the walk' } })).json());
    expect(decided.status).toBe('COMPLETED');
    expect(decided.decision).toBe('ADOPT');
    const memories = (await app.inject({ method: 'GET', url: '/v1/memories', headers: auth })).json() as { memories: Array<{ category: string; origin: string; statement: string; verificationStatus: string }> };
    expect(memories.memories.some((m) => m.category === 'EXPERIMENT' && m.origin === 'DERIVED_CALCULATION' && m.statement.includes('Evening walk') && m.verificationStatus === 'USER_CONFIRMED')).toBe(true);
    const monthly = ReportSchema.parse((await app.inject({ method: 'POST', url: '/v1/reports/monthly', headers: auth, payload: { force: true } })).json());
    const completedSection = monthly.content.sections.find((s) => s.key === 'experiments_completed')!;
    expect(completedSection.insufficient).toBe(false);
    expect(completedSection.lines.join(' ')).toContain('Evening walk after dinner');
    expect(completedSection.lines.join(' ')).toContain('Decision: ADOPT');
    // Once decided, start is refused
    expect((await app.inject({ method: 'PATCH', url: `/v1/experiments/${created.id}`, headers: auth, payload: { action: 'start' } })).statusCode).toBe(409);
  }, 60_000);

  it('plans alternating blocks, keeps running experiments preliminary, raises an alert from the job, and isolates users', async () => {
    const a = await login(app, uniqueEmail('exp-a'));
    const b = await login(app, uniqueEmail('exp-b'));
    const draft = ExperimentSchema.parse((await app.inject({ method: 'POST', url: '/v1/experiments', headers: a.auth, payload: { title: 'Magnesium before bed', researchQuestion: 'q', hypothesis: 'h', intervention: 'magnesium glycinate 300 mg (supplement, not a prescription)', primaryOutcomeMetric: 'checkin:perceivedSleepQuality', design: 'ALTERNATING', plannedBaselineDays: 7, plannedInterventionDays: 7, plannedBlocks: 2 } })).json());
    expect(draft.status).toBe('DRAFT');
    expect(draft.phases).toEqual([]);
    const started = ExperimentSchema.parse((await app.inject({ method: 'PATCH', url: `/v1/experiments/${draft.id}`, headers: a.auth, payload: { action: 'start', startDate: addDays(TODAY, -10) } })).json());
    expect(started.phases.map((p) => p.phase)).toEqual(['BASELINE', 'INTERVENTION', 'BASELINE', 'INTERVENTION']);
    expect(started.status).toBe('INTERVENTION');
    expect(started.primaryOutcomeLabel).toMatch(/sleep quality/i);
    // Check-ins feed the subjective outcome
    for (let i = 10; i >= 0; i--) expect((await app.inject({ method: 'POST', url: '/v1/checkins', headers: a.auth, payload: { at: `${addDays(TODAY, -i)}T07:30:00Z`, perceivedSleepQuality: i >= 4 ? 6 : 8, energy: 7 } })).statusCode).toBe(201);
    const running = ExperimentSchema.parse((await app.inject({ method: 'POST', url: `/v1/experiments/${draft.id}/evaluate`, headers: a.auth })).json());
    expect(running.evaluation!.preliminary).toBe(true);
    expect(running.evaluation!.reasons[0]).toMatch(/Preliminary/);
    expect(running.evaluation!.baseline!.daysWithData).toBe(7);
    // A finished experiment with no decision → the job raises one EXPERIMENT_COMPLETED alert (idempotent)
    const finished = ExperimentSchema.parse((await app.inject({ method: 'POST', url: '/v1/experiments', headers: a.auth, payload: { title: 'Finished one', researchQuestion: 'q', hypothesis: 'h', intervention: 'i', primaryOutcomeMetric: 'checkin:energy', plannedBaselineDays: 3, plannedInterventionDays: 3, startDate: addDays(TODAY, -8) } })).json());
    expect(finished.status).toBe('ANALYSIS');
    for (let n = 0; n < 2; n++) expect((await app.inject({ method: 'POST', url: '/internal/jobs/reports', headers: { 'x-job-secret': 'reports-secret' } })).statusCode).toBe(200);
    const alerts = (await app.inject({ method: 'GET', url: '/v1/alerts', headers: a.auth })).json() as { alerts: Array<{ kind: string; title: string; payload: Record<string, unknown> }> };
    const done = alerts.alerts.filter((x) => x.kind === 'EXPERIMENT_COMPLETED');
    expect(done).toHaveLength(1);
    expect(done[0]!.payload.experimentId).toBe(finished.id);
    expect(done[0]!.title).not.toMatch(/\d/);
    // RLS: B sees nothing of A's
    expect(ExperimentsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/experiments', headers: b.auth })).json()).experiments).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/v1/experiments/${draft.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/experiments/${draft.id}/adherence`, headers: b.auth, payload: { date: TODAY, adhered: true } })).statusCode).toBe(404);
    const list = ExperimentsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/experiments', headers: a.auth })).json());
    expect(list.experiments).toHaveLength(2);
    expect(list.outcomeMetrics.some((m) => m.id === 'checkin:energy')).toBe(true);
    // Abandon
    expect(ExperimentSchema.parse((await app.inject({ method: 'PATCH', url: `/v1/experiments/${draft.id}`, headers: a.auth, payload: { action: 'abandon', decisionNote: 'ran out of capsules' } })).json()).status).toBe('ABANDONED');
  }, 60_000);
});

describe('Phase 7: training and check-ins', () => {
  it('logs sets idempotently, summarises weeks and progression, and lists check-ins with a 7-vs-28-day summary', async () => {
    const { auth } = await login(app, uniqueEmail('train'));
    const sets = [] as Array<Record<string, unknown>>;
    for (let w = 0; w < 9; w++) for (let s = 1; s <= 3; s++) sets.push({ localDate: addDays(TODAY, -(w * 7 + 1)), exercise: 'Back squat', setIndex: s, reps: 5, loadKg: 120 - w * 2.5, rpe: 7 });
    const posted = await app.inject({ method: 'POST', url: '/v1/training/sets', headers: auth, payload: { sets } });
    expect(posted.statusCode).toBe(201);
    expect(posted.json().sets).toHaveLength(27);
    // Same set again with a corrected load → updated, not duplicated
    expect((await app.inject({ method: 'POST', url: '/v1/training/sets', headers: auth, payload: { sets: [{ localDate: addDays(TODAY, -1), exercise: 'Back squat', setIndex: 1, reps: 5, loadKg: 122.5 }] } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/v1/training/sets', headers: auth, payload: { sets: [{ localDate: addDays(TODAY, -1), exercise: 'Back squat', setIndex: 1, reps: 0, loadKg: 10 }] } })).statusCode).toBe(400);
    const overview = TrainingOverviewSchema.parse((await app.inject({ method: 'GET', url: '/v1/training?days=70', headers: auth })).json());
    expect(overview.recentSets).toHaveLength(27);
    expect(overview.recentSets.find((s) => s.localDate === addDays(TODAY, -1) && s.setIndex === 1)!.loadKg).toBe(122.5);
    const squat = overview.summary.progression.find((p) => p.exercise === 'Back squat')!;
    expect(squat.status).toBe('PROGRESSING');
    expect(squat.sessions).toHaveLength(9);
    expect(overview.summary.weeks.reduce((n, w) => n + w.loggedSets, 0)).toBe(27);
    expect(overview.summary.sessionsPerWeek).toBeGreaterThan(0.5);
    expect(overview.zone2.minutes7d).toBeNull(); // no heart-rate samples → honestly null
    const del = await app.inject({ method: 'DELETE', url: `/v1/training/sets/${overview.recentSets[0]!.id}`, headers: auth });
    expect(del.statusCode).toBe(204);
    expect(TrainingOverviewSchema.parse((await app.inject({ method: 'GET', url: '/v1/training?days=70', headers: auth })).json()).recentSets).toHaveLength(26);

    expect((await app.inject({ method: 'POST', url: '/v1/checkins', headers: auth, payload: { energy: 11 } })).statusCode).toBe(400);
    for (let i = 34; i >= 0; i--) expect((await app.inject({ method: 'POST', url: '/v1/checkins', headers: auth, payload: { at: `${addDays(TODAY, -i)}T08:00:00Z`, energy: i < 7 ? 8 + (i % 2) : 5 + (i % 2), stress: 4 + (i % 2), soreness: 3, note: i === 0 ? 'felt great' : null } })).statusCode).toBe(201);
    const checkins = CheckInsResponseSchema.parse((await app.inject({ method: 'GET', url: '/v1/checkins', headers: auth })).json());
    expect(checkins.checkIns).toHaveLength(35);
    expect(checkins.checkIns[0]!.note).toBe('felt great');
    const energy = checkins.summary.dimensions.find((d) => d.dimension === 'energy')!;
    expect(energy.changeClass).toBe('MEANINGFUL');
    expect(energy.favourable).toBe(true);
    expect(checkins.summary.dimensions.find((d) => d.dimension === 'mood')!.changeClass).toBe('INSUFFICIENT_EVIDENCE');
    expect(checkins.summary.daysLogged7d).toBe(7);
    expect((await app.inject({ method: 'DELETE', url: `/v1/checkins/${checkins.checkIns[0]!.id}`, headers: auth })).statusCode).toBe(204);
    // Export includes the new table; delete-all removes it
    const exported = (await app.inject({ method: 'GET', url: '/v1/me/export', headers: auth })).json() as Record<string, unknown[]>;
    expect(exported.training_sets).toHaveLength(26);
    expect(exported.symptoms).toHaveLength(34);
  }, 60_000);
});
