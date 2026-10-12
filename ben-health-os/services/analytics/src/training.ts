/**
 * Strength-training math (algorithm `training_summary`, version 1). Sets are what the user logged;
 * sessions come from the workouts table (RESISTANCE category, deduplicated upstream). Nothing here
 * estimates fitness; the estimated one-rep max is a formula with known limits and is labelled as such.
 */
import { addDays } from './time.js';
import { mean } from './stats.js';

export interface TrainingSetInput {
  localDate: string;
  exercise: string;
  setIndex: number;
  reps: number;
  loadKg: number;
  rpe?: number | null;
}

export interface ResistanceSessionInput {
  localDate: string;
  durationMin: number;
  title?: string | null;
  source?: string | null;
}

export interface ExerciseSessionSummary {
  date: string;
  sets: number;
  reps: number;
  volumeKg: number;
  topSetKg: number;
  topSetReps: number;
  estimatedOneRepMaxKg: number | null;
}

export interface ExerciseProgression {
  exercise: string;
  sessions: ExerciseSessionSummary[];
  bestEstimatedOneRepMaxKg: number | null;
  /** Mean best e1RM of the last 4 weeks vs the 4 weeks before; null when either side lacks 2 sessions. */
  recentMeanKg: number | null;
  priorMeanKg: number | null;
  deltaPct: number | null;
  status: 'PROGRESSING' | 'MAINTAINING' | 'REGRESSING' | 'INSUFFICIENT_EVIDENCE';
  note: string;
}

export interface WeekSummary {
  weekStart: string;
  weekEnd: string;
  sessions: number;
  loggedSets: number;
  volumeKg: number;
  minutes: number;
}

export interface TrainingSummary {
  algorithm: 'training_summary';
  version: 1;
  from: string;
  to: string;
  weeks: WeekSummary[];
  sessionsPerWeek: number | null;
  weeksWithoutSession: number;
  progression: ExerciseProgression[];
  notes: string[];
}

/** Epley estimate, only trusted for 1–12 reps; higher-rep sets return null rather than a guess. */
export function estimatedOneRepMax(loadKg: number, reps: number): number | null {
  if (!(loadKg > 0) || !Number.isInteger(reps) || reps < 1 || reps > 12) return null;
  if (reps === 1) return loadKg;
  return Math.round(loadKg * (1 + reps / 30) * 10) / 10;
}

export function sessionVolumeKg(sets: Array<{ reps: number; loadKg: number }>): number {
  return Math.round(sets.reduce((v, s) => v + s.reps * s.loadKg, 0) * 10) / 10;
}

/** ISO weeks (Monday start) covering [from, to]. */
export function weekStarts(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const dow = (start.getUTCDay() + 6) % 7; // Monday = 0
  let cursor = addDays(from, -dow);
  const out: string[] = [];
  while (cursor <= to) {
    out.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return out;
}

export function exerciseProgression(exercise: string, sets: TrainingSetInput[], asOfDate: string): ExerciseProgression {
  const byDate = new Map<string, TrainingSetInput[]>();
  for (const s of sets.filter((x) => x.exercise === exercise)) byDate.set(s.localDate, [...(byDate.get(s.localDate) ?? []), s]);
  const sessions: ExerciseSessionSummary[] = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, ss]) => {
    const top = ss.reduce((best, s) => (s.loadKg > best.loadKg || (s.loadKg === best.loadKg && s.reps > best.reps) ? s : best), ss[0]!);
    const e1 = ss.map((s) => estimatedOneRepMax(s.loadKg, s.reps)).filter((v): v is number => v !== null);
    return { date, sets: ss.length, reps: ss.reduce((n, s) => n + s.reps, 0), volumeKg: sessionVolumeKg(ss), topSetKg: top.loadKg, topSetReps: top.reps, estimatedOneRepMaxKg: e1.length ? Math.max(...e1) : null };
  });
  const best = sessions.map((s) => s.estimatedOneRepMaxKg).filter((v): v is number => v !== null);
  const recentFrom = addDays(asOfDate, -27);
  const priorFrom = addDays(asOfDate, -55);
  const recent = sessions.filter((s) => s.date >= recentFrom && s.date <= asOfDate && s.estimatedOneRepMaxKg !== null).map((s) => s.estimatedOneRepMaxKg!);
  const prior = sessions.filter((s) => s.date >= priorFrom && s.date < recentFrom && s.estimatedOneRepMaxKg !== null).map((s) => s.estimatedOneRepMaxKg!);
  const recentMean = recent.length >= 2 ? mean(recent) : null;
  const priorMean = prior.length >= 2 ? mean(prior) : null;
  const deltaPct = recentMean !== null && priorMean !== null && priorMean > 0 ? Math.round(((recentMean - priorMean) / priorMean) * 1000) / 10 : null;
  let status: ExerciseProgression['status'];
  let note: string;
  if (deltaPct === null) {
    status = 'INSUFFICIENT_EVIDENCE';
    note = `Needs at least two sessions with 1–12-rep sets in each of the last two 4-week blocks (have ${recent.length} recent, ${prior.length} prior).`;
  } else if (deltaPct >= 2.5) {
    status = 'PROGRESSING';
    note = `Estimated 1RM up ${deltaPct}% versus the previous 4 weeks.`;
  } else if (deltaPct <= -2.5) {
    status = 'REGRESSING';
    note = `Estimated 1RM down ${Math.abs(deltaPct)}% versus the previous 4 weeks; check recovery, illness and sleep before changing the plan.`;
  } else {
    status = 'MAINTAINING';
    note = `Estimated 1RM within ±2.5% of the previous 4 weeks.`;
  }
  return { exercise, sessions, bestEstimatedOneRepMaxKg: best.length ? Math.max(...best) : null, recentMeanKg: recentMean === null ? null : Math.round(recentMean * 10) / 10, priorMeanKg: priorMean === null ? null : Math.round(priorMean * 10) / 10, deltaPct, status, note };
}

export function trainingSummary(sets: TrainingSetInput[], sessions: ResistanceSessionInput[], from: string, to: string): TrainingSummary {
  const weeks: WeekSummary[] = weekStarts(from, to).map((ws) => {
    const we = addDays(ws, 6);
    const inWeek = (d: string) => d >= ws && d <= we;
    const wsSets = sets.filter((s) => inWeek(s.localDate));
    const wsSessions = sessions.filter((s) => inWeek(s.localDate));
    // A week with logged sets but no recorded session still counts as one training day per date.
    const sessionDays = new Set([...wsSessions.map((s) => s.localDate), ...wsSets.map((s) => s.localDate)]);
    return { weekStart: ws, weekEnd: we, sessions: sessionDays.size, loggedSets: wsSets.length, volumeKg: sessionVolumeKg(wsSets), minutes: Math.round(wsSessions.reduce((m, s) => m + s.durationMin, 0)) };
  });
  const fullWeeks = weeks.filter((w) => w.weekEnd <= to && w.weekStart >= from);
  const exercises = [...new Set(sets.map((s) => s.exercise))].sort();
  const progression = exercises.map((e) => exerciseProgression(e, sets, to));
  const notes: string[] = [
    'Sessions come from exercise records (Health Connect / connectors) and logged sets; a day with either counts once.',
    'Estimated 1RM uses the Epley formula on 1–12-rep sets only; it is a planning number, not a tested maximum.',
  ];
  if (!sets.length) notes.push('No sets logged yet: volume and progression need set/rep/load entries.');
  return {
    algorithm: 'training_summary',
    version: 1,
    from,
    to,
    weeks,
    sessionsPerWeek: fullWeeks.length ? Math.round((fullWeeks.reduce((n, w) => n + w.sessions, 0) / fullWeeks.length) * 10) / 10 : null,
    weeksWithoutSession: fullWeeks.filter((w) => w.sessions === 0).length,
    progression,
    notes,
  };
}
