/**
 * Phase 7: strength-training overview (logged sets + exercise sessions) and subjective check-ins.
 * All math is in `@bho/analytics`; this module only loads rows and persists entries.
 */
import type pg from 'pg';
import { addDays, baselineWindows, checkInSummary, localDateOf, trainingSummary, windowStats, type CheckInRow } from '@bho/analytics';
import type { CheckIn, CheckInInput, CheckInsResponse, TrainingOverview, TrainingSet, TrainingSetInput } from '@bho/contracts';
import { withUser, type Tx } from '../db/pool.js';
import { audit } from './audit.js';
import { loadDaily } from './dashboard.js';

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

interface SetRow { id: string; local_date: Date; workout_id: string | null; exercise: string; set_index: number; reps: number; load_kg: number; rpe: number | null; notes: string | null; source: string; created_at: Date }
const setToDto = (r: SetRow): TrainingSet => ({ id: r.id, localDate: day(r.local_date), workoutId: r.workout_id, exercise: r.exercise, setIndex: r.set_index, reps: r.reps, loadKg: r.load_kg, rpe: r.rpe, notes: r.notes, source: r.source, createdAt: iso(r.created_at)! });

async function profileTz(tx: Tx, userId: string): Promise<string> {
  return (await tx.query<{ time_zone: string }>('select time_zone from public.profiles where id = $1', [userId])).rows[0]?.time_zone ?? 'UTC';
}

export async function trainingOverview(pool: pg.Pool, userId: string, days = 56, now: Date = new Date()): Promise<TrainingOverview> {
  return withUser(pool, userId, async (tx) => {
    const today = localDateOf(now.toISOString(), null, await profileTz(tx, userId));
    const from = addDays(today, -(days - 1));
    const sets = await tx.query<SetRow>('select id, local_date, workout_id, exercise, set_index, reps, load_kg, rpe, notes, source, created_at from public.training_sets where user_id = $1 and local_date between $2 and $3 order by local_date desc, exercise, set_index', [userId, from, today]);
    const sessions = await tx.query<{ id: string; local_date: Date; start_at: Date; duration_min: number; title: string | null; category: string; connector: string; data_origin: string | null; avg_heart_rate: number | null }>(`select id, local_date, start_at, duration_min, title, category, connector, data_origin, avg_heart_rate from public.workouts where user_id = $1 and canonical and deleted_at is null and category = 'RESISTANCE' and local_date between $2 and $3 order by start_at desc`, [userId, from, today]);
    const setInputs = sets.rows.map((s) => ({ localDate: day(s.local_date), exercise: s.exercise, setIndex: s.set_index, reps: s.reps, loadKg: s.load_kg, rpe: s.rpe }));
    const summary = trainingSummary(setInputs, sessions.rows.map((s) => ({ localDate: day(s.local_date), durationMin: s.duration_min, title: s.title, source: s.connector })), from, today);
    const w = baselineWindows(today);
    const zone2 = await loadDaily(tx, userId, 'zone2_minutes', w.baseline.from, today);
    const z7 = windowStats(zone2.daily, w.current.from, w.current.to);
    const z28 = windowStats(zone2.daily, w.baseline.from, w.baseline.to);
    const rec = async (metricId: string) => windowStats((await loadDaily(tx, userId, metricId, w.current.from, w.current.to)).daily, w.current.from, w.current.to).mean;
    const hrv7d = await rec('hrv_rmssd');
    const rhr7d = await rec('resting_heart_rate');
    const sleep7d = await rec('sleep_duration');
    return {
      from,
      to: today,
      summary,
      sessions: sessions.rows.map((s) => ({ id: s.id, localDate: day(s.local_date), startAt: iso(s.start_at)!, durationMin: s.duration_min, title: s.title, category: s.category, source: s.data_origin ? `${s.connector}:${s.data_origin}` : s.connector, avgHeartRate: s.avg_heart_rate })),
      recentSets: sets.rows.slice(0, 60).map(setToDto),
      zone2: { minutes7d: z7.n ? Math.round(z7.mean! * z7.daysWithData) : null, minutes28dMean: z28.mean, note: z7.n ? `Zone 2 minutes this week summed over ${z7.daysWithData} day(s) with data; 28-day daily mean ${z28.mean?.toFixed(0) ?? '—'}.` : 'No Zone 2 minutes derived this week (needs heart-rate samples and a max heart rate or birth date).' },
      recovery: { hrv7d, restingHr7d: rhr7d, sleep7d, note: 'Seven-day means for context when planning load; recovery metrics are not a readiness score.' },
      notes: ['Resistance sessions come from exercise records (Samsung Health, Oura, manual) deduplicated upstream; sets, reps and load are what you logged.', 'No programme is prescribed here. Progression labels compare your own last four weeks with the four before and never exceed what the logged sets support.'],
    };
  });
}

export async function addTrainingSets(pool: pg.Pool, userId: string, sets: TrainingSetInput[]): Promise<TrainingSet[]> {
  const out = await withUser(pool, userId, async (tx) => {
    const rows: TrainingSet[] = [];
    for (const s of sets) {
      const r = await tx.query<SetRow>(
        `insert into public.training_sets (user_id, local_date, workout_id, exercise, set_index, reps, load_kg, rpe, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (user_id, local_date, exercise, set_index) do update set reps = excluded.reps, load_kg = excluded.load_kg, rpe = excluded.rpe, notes = excluded.notes, workout_id = coalesce(excluded.workout_id, public.training_sets.workout_id), updated_at = now()
         returning id, local_date, workout_id, exercise, set_index, reps, load_kg, rpe, notes, source, created_at`,
        [userId, s.localDate, s.workoutId ?? null, s.exercise.trim(), s.setIndex, s.reps, s.loadKg, s.rpe ?? null, s.notes ?? null],
      );
      rows.push(setToDto(r.rows[0]!));
    }
    return rows;
  });
  await audit(pool, { userId, actor: 'user', action: 'TRAINING_SETS_UPSERT', entity: 'training_sets', details: { count: out.length } });
  return out;
}

export async function deleteTrainingSet(pool: pg.Pool, userId: string, id: string): Promise<boolean> {
  return withUser(pool, userId, async (tx) => (await tx.query('delete from public.training_sets where user_id = $1 and id = $2', [userId, id])).rowCount! > 0);
}

interface CheckInRowDb { id: string; at: Date; local_date: Date; energy: number | null; mood: number | null; stress: number | null; soreness: number | null; fatigue: number | null; focus: number | null; pain: number | null; perceived_sleep_quality: number | null; subjective_recovery: number | null; illness_symptoms: string[]; note: string | null; created_at: Date }
const checkInToDto = (r: CheckInRowDb): CheckIn => ({ id: r.id, at: iso(r.at)!, localDate: day(r.local_date), energy: r.energy, mood: r.mood, stress: r.stress, soreness: r.soreness, fatigue: r.fatigue, focus: r.focus, pain: r.pain, perceivedSleepQuality: r.perceived_sleep_quality, subjectiveRecovery: r.subjective_recovery, illnessSymptoms: r.illness_symptoms ?? [], note: r.note, createdAt: iso(r.created_at)! });
const CHECKIN_COLS = 'id, at, local_date, energy, mood, stress, soreness, fatigue, focus, pain, perceived_sleep_quality, subjective_recovery, illness_symptoms, note, created_at';

export async function listCheckIns(pool: pg.Pool, userId: string, days = 35, now: Date = new Date()): Promise<CheckInsResponse> {
  return withUser(pool, userId, async (tx) => {
    const today = localDateOf(now.toISOString(), null, await profileTz(tx, userId));
    const rows = await tx.query<CheckInRowDb>(`select ${CHECKIN_COLS} from public.symptoms where user_id = $1 and local_date between $2 and $3 order by at desc`, [userId, addDays(today, -(days - 1)), today]);
    const checkIns = rows.rows.map(checkInToDto);
    const summaryRows: CheckInRow[] = checkIns.map((c) => ({ localDate: c.localDate, energy: c.energy, mood: c.mood, stress: c.stress, soreness: c.soreness, fatigue: c.fatigue, focus: c.focus, pain: c.pain, perceivedSleepQuality: c.perceivedSleepQuality, subjectiveRecovery: c.subjectiveRecovery }));
    return { checkIns, summary: checkInSummary(summaryRows, today), notes: ['Check-ins are your own ratings (1–10) and count as measured facts about how you felt. They can be the outcome of an experiment (choose a “check-in” metric).'] };
  });
}

export async function createCheckIn(pool: pg.Pool, userId: string, input: CheckInInput, now: Date = new Date()): Promise<CheckIn> {
  return withUser(pool, userId, async (tx) => {
    const tz = await profileTz(tx, userId);
    const at = input.at ?? now.toISOString();
    const localDate = localDateOf(at, null, tz);
    const r = await tx.query<CheckInRowDb>(
      `insert into public.symptoms (user_id, at, local_date, energy, mood, stress, soreness, fatigue, focus, pain, perceived_sleep_quality, subjective_recovery, illness_symptoms, note) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (user_id, local_date, at) do update set energy = excluded.energy, mood = excluded.mood, stress = excluded.stress, soreness = excluded.soreness, fatigue = excluded.fatigue, focus = excluded.focus, pain = excluded.pain, perceived_sleep_quality = excluded.perceived_sleep_quality, subjective_recovery = excluded.subjective_recovery, illness_symptoms = excluded.illness_symptoms, note = excluded.note
       returning ${CHECKIN_COLS}`,
      [userId, at, localDate, input.energy ?? null, input.mood ?? null, input.stress ?? null, input.soreness ?? null, input.fatigue ?? null, input.focus ?? null, input.pain ?? null, input.perceivedSleepQuality ?? null, input.subjectiveRecovery ?? null, input.illnessSymptoms, input.note ?? null],
    );
    return checkInToDto(r.rows[0]!);
  });
}

export async function deleteCheckIn(pool: pg.Pool, userId: string, id: string): Promise<boolean> {
  return withUser(pool, userId, async (tx) => (await tx.query('delete from public.symptoms where user_id = $1 and id = $2', [userId, id])).rowCount! > 0);
}
