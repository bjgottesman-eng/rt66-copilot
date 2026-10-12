import { describe, expect, it } from 'vitest';
import { metricById } from '@bho/shared-config';
import { addDays, checkInSummary, estimatedOneRepMax, evaluateExperiment, exerciseProgression, experimentStatusFor, planPhases, sessionVolumeKg, trainingSummary, weekStarts, type DailyPoint, type ExperimentPhaseInput, type TrainingSetInput } from '../src/index.js';

const rhr = metricById('resting_heart_rate')!;
const hrv = metricById('hrv_rmssd')!;
const START = '2026-08-01';
/** Deterministic daily series: mean ± 1 alternating, so sd > 0 without randomness. */
function series(from: string, days: number, mean: number, skip: (i: number) => boolean = () => false): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let i = 0; i < days; i++) if (!skip(i)) out.push({ localDate: addDays(from, i), value: mean + (i % 2 === 0 ? 1 : -1) });
  return out;
}
const beforeAfter = (interventionMean: number, interventionDays = 21, skip?: (i: number) => boolean): { daily: DailyPoint[]; phases: ExperimentPhaseInput[] } => {
  const baselineDays = 28;
  const ivFrom = addDays(START, baselineDays);
  return {
    daily: [...series(START, baselineDays, 54), ...series(ivFrom, interventionDays, interventionMean, skip)],
    phases: [
      { phase: 'BASELINE', sequence: 1, startDate: START, endDate: addDays(START, baselineDays - 1), adherence: [] },
      { phase: 'INTERVENTION', sequence: 2, startDate: ivFrom, endDate: addDays(ivFrom, interventionDays - 1), adherence: Array.from({ length: interventionDays }, (_, i) => ({ date: addDays(ivFrom, i), adhered: true })) },
    ],
  };
};

describe('Phase 7: N-of-1 experiment evaluation', () => {
  it('adopts a meaningful favourable change with full adherence and names the before/after limitation', () => {
    const { daily, phases } = beforeAfter(50);
    const ev = evaluateExperiment({ design: 'BEFORE_AFTER', metric: rhr, daily, phases, asOfDate: '2026-10-01', evaluatedAt: '2026-10-01T12:00:00Z' });
    expect(ev.complete).toBe(true);
    expect(ev.preliminary).toBe(false);
    expect(ev.changeClass).toBe('MEANINGFUL');
    expect(ev.delta).toBeCloseTo(-4, 0);
    expect(ev.favourable).toBe(true);
    expect(ev.adherenceRate).toBe(1);
    expect(ev.verdict).toBe('ADOPT');
    expect(ev.confidence).toBe('HIGH'); // effect size well above 1 on a ±1 baseline
    expect(ev.limitations.join(' ')).toMatch(/Before\/after design/);
    expect(ev.summary).toContain('Verdict ADOPT');
    expect(ev.baseline!.daysWithData).toBe(28);
    expect(ev.intervention!.days).toBe(21);
  });

  it('rejects a meaningful unfavourable change, retests a directional one, and calls noise inconclusive', () => {
    expect(evaluateExperiment({ design: 'BEFORE_AFTER', metric: rhr, ...beforeAfter(58), asOfDate: '2026-10-01' }).verdict).toBe('REJECT');
    const directional = evaluateExperiment({ design: 'BEFORE_AFTER', metric: rhr, ...beforeAfter(52), asOfDate: '2026-10-01' });
    expect(directional.changeClass).toBe('DIRECTIONAL');
    expect(directional.verdict).toBe('RETEST');
    const noise = evaluateExperiment({ design: 'BEFORE_AFTER', metric: rhr, ...beforeAfter(54), asOfDate: '2026-10-01' });
    expect(noise.changeClass).toBe('NOISE');
    expect(noise.verdict).toBe('INCONCLUSIVE');
    expect(noise.reasons.join(' ')).toMatch(/not the same as no effect/);
  });

  it('refuses a verdict without coverage, flags poor adherence, and marks running experiments preliminary', () => {
    const sparse = evaluateExperiment({ design: 'BEFORE_AFTER', metric: rhr, ...beforeAfter(50, 21, (i) => i % 7 !== 0), asOfDate: '2026-10-01' });
    expect(sparse.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(sparse.reasons.join(' ')).toMatch(/Intervention window has 3 of 21 days/);
    const poor = beforeAfter(50);
    poor.phases[1]!.adherence = poor.phases[1]!.adherence.map((a, i) => ({ ...a, adhered: i % 2 === 0 }));
    const lowAdherence = evaluateExperiment({ design: 'BEFORE_AFTER', metric: rhr, ...poor, asOfDate: '2026-10-01' });
    expect(lowAdherence.adherenceRate).toBeCloseTo(11 / 21, 5);
    expect(lowAdherence.verdict).toBe('RETEST');
    expect(lowAdherence.reasons.join(' ')).toMatch(/Adherence was 52%/);
    const running = beforeAfter(50);
    running.phases[1]!.endDate = null;
    const prelim = evaluateExperiment({ design: 'BEFORE_AFTER', metric: rhr, ...running, asOfDate: addDays(running.phases[1]!.startDate, 9) });
    expect(prelim.preliminary).toBe(true);
    expect(prelim.complete).toBe(false);
    expect(prelim.intervention!.days).toBe(10);
    expect(prelim.reasons[0]).toMatch(/Preliminary/);
    const none = evaluateExperiment({ design: 'BEFORE_AFTER', metric: rhr, daily: [], phases: [], asOfDate: '2026-10-01' });
    expect(none.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(none.reasons).toContain('No baseline phase yet.');
  });

  it('scores consistency across alternating blocks and evaluates secondary outcomes', () => {
    const phases = planPhases('ALTERNATING', START, 7, 7, 2).map((p) => ({ ...p, adherence: [] as ExperimentPhaseInput['adherence'] }));
    expect(phases.map((p) => `${p.phase}:${p.startDate}`)).toEqual(['BASELINE:2026-08-01', 'INTERVENTION:2026-08-08', 'BASELINE:2026-08-15', 'INTERVENTION:2026-08-22']);
    const daily = phases.flatMap((p) => series(p.startDate, 7, p.phase === 'BASELINE' ? 54 : 50));
    const hrvDaily = phases.flatMap((p) => series(p.startDate, 7, p.phase === 'BASELINE' ? 40 : 46));
    const ev = evaluateExperiment({ design: 'ALTERNATING', metric: rhr, daily, phases, asOfDate: '2026-09-01', secondary: [{ metric: hrv, daily: hrvDaily }], confounders: ['travel in week 3'] });
    expect(ev.consistency).toBe(1);
    expect(ev.verdict).toBe('ADOPT');
    expect(ev.confidence).toBe('HIGH');
    expect(ev.limitations.join(' ')).not.toMatch(/Before\/after design/);
    expect(ev.limitations.join(' ')).toMatch(/travel in week 3/);
    expect(ev.secondary[0]).toMatchObject({ metricId: 'hrv_rmssd', favourable: true });
    expect(ev.secondary[0]!.delta).toBeCloseTo(6, 5);
    expect(experimentStatusFor(phases, '2026-08-10')).toBe('INTERVENTION');
    expect(experimentStatusFor(phases, '2026-07-01')).toBe('DRAFT');
    expect(experimentStatusFor(phases, '2026-09-01')).toBe('ANALYSIS');
    expect(planPhases('BEFORE_AFTER', START, 14, 14, 3)).toHaveLength(2);
    expect(planPhases('ALTERNATING', START, 7, 7, 2, 3).map((p) => p.phase)).toEqual(['BASELINE', 'INTERVENTION', 'WASHOUT', 'BASELINE', 'INTERVENTION']);
  });
});

describe('Phase 7: strength training', () => {
  const sets: TrainingSetInput[] = [];
  // 8 weeks of squats every Monday and Thursday, +2.5 kg every week; 5 reps.
  for (let w = 0; w < 8; w++) for (const dow of [0, 3]) for (let s = 1; s <= 3; s++) sets.push({ localDate: addDays('2026-08-03', w * 7 + dow), exercise: 'Back squat', setIndex: s, reps: 5, loadKg: 100 + w * 2.5, rpe: 7 });
  sets.push({ localDate: '2026-09-24', exercise: 'Bench press', setIndex: 1, reps: 15, loadKg: 60 });

  it('estimates 1RM only for 1–12-rep sets and sums volume', () => {
    expect(estimatedOneRepMax(100, 5)).toBeCloseTo(116.7, 1);
    expect(estimatedOneRepMax(100, 1)).toBe(100);
    expect(estimatedOneRepMax(60, 15)).toBeNull();
    expect(estimatedOneRepMax(0, 5)).toBeNull();
    expect(sessionVolumeKg([{ reps: 5, loadKg: 100 }, { reps: 5, loadKg: 100 }])).toBe(1000);
  });

  it('detects progression from the last 4 weeks versus the 4 before, and honest insufficiency', () => {
    const p = exerciseProgression('Back squat', sets, '2026-09-27');
    expect(p.sessions).toHaveLength(16);
    expect(p.bestEstimatedOneRepMaxKg).toBeCloseTo(137.1, 1);
    expect(p.status).toBe('PROGRESSING');
    expect(p.deltaPct).toBeGreaterThan(2.5);
    const bench = exerciseProgression('Bench press', sets, '2026-09-27');
    expect(bench.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(bench.bestEstimatedOneRepMaxKg).toBeNull();
  });

  it('summarises weeks from sessions and logged sets without double counting a day', () => {
    expect(weekStarts('2026-08-05', '2026-08-20')).toEqual(['2026-08-03', '2026-08-10', '2026-08-17']);
    const sessions = [{ localDate: '2026-08-03', durationMin: 45 }, { localDate: '2026-08-06', durationMin: 40 }, { localDate: '2026-08-08', durationMin: 30 }];
    const s = trainingSummary(sets, sessions, '2026-08-03', '2026-09-27');
    expect(s.weeks[0]).toMatchObject({ weekStart: '2026-08-03', sessions: 3, loggedSets: 6, minutes: 115 });
    expect(s.weeks[0]!.volumeKg).toBe(3000);
    expect(s.weeks[1]!.sessions).toBe(2); // sets only, no recorded session
    expect(s.sessionsPerWeek).toBeCloseTo(2.1, 1);
    expect(s.weeksWithoutSession).toBe(0);
    expect(s.progression.map((p) => p.exercise)).toEqual(['Back squat', 'Bench press']);
  });
});

describe('Phase 7: subjective check-ins', () => {
  it('compares 7 days with the preceding 28 using the statistical rule and gates on coverage', () => {
    const rows = [] as Array<{ localDate: string; energy: number; stress: number; pain?: number }>;
    for (let i = 0; i < 35; i++) rows.push({ localDate: addDays('2026-09-01', i), energy: i >= 28 ? 8 + (i % 2) : 5 + (i % 2), stress: 4 + (i % 2), ...(i >= 33 ? { pain: 2 } : {}) });
    const s = checkInSummary(rows, '2026-10-05');
    const energy = s.dimensions.find((d) => d.dimension === 'energy')!;
    expect(energy.changeClass).toBe('MEANINGFUL');
    expect(energy.favourable).toBe(true);
    expect(energy.mean7d).toBeCloseTo(8.4, 0);
    const stress = s.dimensions.find((d) => d.dimension === 'stress')!;
    expect(stress.changeClass).toBe('NOISE');
    const pain = s.dimensions.find((d) => d.dimension === 'pain')!;
    expect(pain.changeClass).toBe('INSUFFICIENT_EVIDENCE');
    expect(s.daysLogged7d).toBe(7);
    expect(s.dimensions.find((d) => d.dimension === 'mood')!.mean7d).toBeNull();
  });
});
