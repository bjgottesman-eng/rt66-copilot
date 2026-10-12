/**
 * Glucose day analytics and annotations (Phase 4). All statistics come from `@bho/analytics`; this
 * module only loads canonical samples/meals/workouts for a local day and shapes the response.
 */
import type pg from 'pg';
import { addDays, glucoseDayStats, localDateOf, localTimeOf, mealExcursion, repeatedMeals, type GlucoseSample, type MealExcursion } from '@bho/analytics';
import { GlucoseRangeSchema, type Annotation, type AnnotationInput, type GlucoseDayResponse, type GlucoseRange, type RepeatedMealsResponse } from '@bho/contracts';
import { withUser, type Tx } from '../db/pool.js';

export const STELO_LATENCY_HOURS = 3;
const DEFAULT_RANGE: GlucoseRange = { lowMgDl: 70, highMgDl: 140, source: 'Default range placeholder (70–140 mg/dL). Set with your clinician.' };
const DISCLAIMER = 'Descriptive statistics only, not a diagnosis. The range shown is yours or your clinician’s, not a medical threshold. Discuss any change with your clinician.';
const EXCLUDED_FLAGS = ['IMPLAUSIBLE_VALUE', 'FUTURE_TIMESTAMP'];

async function profileFor(tx: Tx, userId: string): Promise<{ timeZone: string; range: GlucoseRange }> {
  const r = await tx.query<{ time_zone: string; glucose_range: unknown }>('select time_zone, glucose_range from public.profiles where id = $1', [userId]);
  const parsed = GlucoseRangeSchema.safeParse(r.rows[0]?.glucose_range);
  return { timeZone: r.rows[0]?.time_zone ?? 'UTC', range: parsed.success ? parsed.data : DEFAULT_RANGE };
}

async function loadSamples(tx: Tx, userId: string, from: string, to: string): Promise<Array<GlucoseSample & { source: string }>> {
  const rows = await tx.query<{ measured_at: Date; mg_dl: number; connector: string; data_origin: string | null }>(
    `select measured_at, mg_dl::float8 as mg_dl, connector, data_origin from public.glucose_samples
     where user_id = $1 and local_date between $2 and $3 and canonical and deleted_at is null and not (quality_flags && $4::text[]) order by measured_at`,
    [userId, from, to, EXCLUDED_FLAGS],
  );
  return rows.rows.map((r) => ({ t: new Date(r.measured_at).toISOString(), mgDl: Number(r.mg_dl), source: r.connector + (r.data_origin ? `:${r.data_origin}` : '') }));
}

interface MealMarker {
  at: string;
  label: string;
  source: string;
  day: string;
}

async function loadMeals(tx: Tx, userId: string, from: string, to: string): Promise<MealMarker[]> {
  const meals = await tx.query<{ eaten_at: Date; label: string; connector: string; data_origin: string | null; day: string }>(
    `select eaten_at, coalesce(name, meal_type, 'Meal') as label, connector, data_origin, local_date::text as day from public.meals
     where user_id = $1 and local_date between $2 and $3 and canonical and deleted_at is null and coalesce(meal_type, '') <> 'DAILY_SUMMARY' order by eaten_at`,
    [userId, from, to],
  );
  const ann = await tx.query<{ at: Date; label: string; day: string }>(`select at, label, local_date::text as day from public.annotations where user_id = $1 and kind = 'MEAL' and local_date between $2 and $3 order by at`, [userId, from, to]);
  return [
    ...meals.rows.map((m) => ({ at: new Date(m.eaten_at).toISOString(), label: m.label, source: m.connector + (m.data_origin ? `:${m.data_origin}` : ''), day: m.day })),
    ...ann.rows.map((a) => ({ at: new Date(a.at).toISOString(), label: a.label, source: 'annotation', day: a.day })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

export async function glucoseDay(pool: pg.Pool, userId: string, dateParam: string | null, now: Date = new Date()): Promise<GlucoseDayResponse> {
  return withUser(pool, userId, async (tx) => {
    const { timeZone, range } = await profileFor(tx, userId);
    const dates = await tx.query<{ d: string }>(
      `select distinct local_date::text as d from public.glucose_samples where user_id = $1 and canonical and deleted_at is null and not (quality_flags && $2::text[]) order by d desc limit 90`,
      [userId, EXCLUDED_FLAGS],
    );
    const datesWithData = dates.rows.map((r) => r.d);
    const date = dateParam ?? datesWithData[0] ?? localDateOf(now, null, timeZone);
    const samples = await loadSamples(tx, userId, date, date);
    const meals = await loadMeals(tx, userId, date, date);
    const annRows = await tx.query<{ id: string; kind: string; at: Date; end_at: Date | null; label: string }>('select id, kind, at, end_at, label from public.annotations where user_id = $1 and local_date = $2 order by at', [userId, date]);
    const workoutRows = await tx.query<{ start_at: Date; end_at: Date; label: string }>(
      `select start_at, end_at, coalesce(title, exercise_type_name, category) as label from public.workouts where user_id = $1 and local_date = $2 and canonical and deleted_at is null order by start_at`,
      [userId, date],
    );
    const workouts = [
      ...workoutRows.rows.map((w) => ({ startAt: new Date(w.start_at).toISOString(), endAt: new Date(w.end_at).toISOString(), label: w.label })),
      ...annRows.rows.filter((a) => a.kind === 'EXERCISE').map((a) => ({ startAt: new Date(a.at).toISOString(), endAt: new Date(a.end_at ?? a.at).toISOString(), label: a.label })),
    ].sort((a, b) => a.startAt.localeCompare(b.startAt));
    const gs: GlucoseSample[] = samples.map(({ t, mgDl }) => ({ t, mgDl }));
    const excursions = meals.map((m) => mealExcursion(gs, { at: m.at, label: m.label }));
    const stats = glucoseDayStats(gs, range, { startHour: 0, endHour: 6, hourOf: (t) => localTimeOf(t, null, timeZone).hour });
    const latest = await tx.query<{ t: Date | null }>(`select max(measured_at) as t from public.glucose_samples where user_id = $1 and canonical and deleted_at is null and not (quality_flags && $2::text[])`, [userId, EXCLUDED_FLAGS]);
    const latestSampleAt = latest.rows[0]?.t ? new Date(latest.rows[0].t).toISOString() : null;
    const ageH = latestSampleAt ? (now.getTime() - Date.parse(latestSampleAt)) / 3_600_000 : null;
    const note =
      ageH === null
        ? 'No glucose samples yet. Stelo readings arrive through Health Connect once the Stelo app is granted sharing.'
        : ageH <= STELO_LATENCY_HOURS
          ? `Latest sample ${ageH.toFixed(1)} h ago. Stelo publishes to Health Connect with up to ${STELO_LATENCY_HOURS} h delay, so the most recent readings are expected to be missing.`
          : `Latest sample ${ageH.toFixed(1)} h ago, beyond the expected ${STELO_LATENCY_HOURS} h Stelo delay. Check the Stelo app, Health Connect sharing and the phone sync.`;
    return {
      date,
      timeZone,
      range,
      samples,
      stats,
      meals: meals.map(({ at, label, source }) => ({ at, label, source })),
      workouts,
      annotations: annRows.rows.map((a) => ({ id: a.id, kind: a.kind, at: new Date(a.at).toISOString(), label: a.label })),
      excursions,
      freshness: { latestSampleAt, expectedSourceLatencyHours: STELO_LATENCY_HOURS, note },
      datesWithData,
      disclaimer: DISCLAIMER,
    };
  });
}

export async function repeatedMealsReport(pool: pg.Pool, userId: string, days: number, now: Date = new Date()): Promise<RepeatedMealsResponse> {
  return withUser(pool, userId, async (tx) => {
    const { timeZone } = await profileFor(tx, userId);
    const to = localDateOf(now, null, timeZone);
    const from = addDays(to, -(days - 1));
    const samples = (await loadSamples(tx, userId, from, to)).map(({ t, mgDl }) => ({ t, mgDl }));
    const meals = await loadMeals(tx, userId, from, to);
    const excursions: Array<MealExcursion & { day: string }> = meals.map((m) => ({ ...mealExcursion(samples, { at: m.at, label: m.label }), day: m.day }));
    return {
      from,
      to,
      meals: repeatedMeals(excursions),
      note: 'Descriptive comparison of the same meal label on different days: pre-meal baseline (30 min), 2-hour peak and incremental area. No causal claim; sleep, activity, timing and portion differ between days.',
    };
  });
}

function toAnnotation(r: { id: string; kind: string; at: Date; end_at: Date | null; local_date: string; label: string; details: Record<string, unknown>; created_at: Date }): Annotation {
  return { id: r.id, kind: r.kind as Annotation['kind'], at: new Date(r.at).toISOString(), endAt: r.end_at ? new Date(r.end_at).toISOString() : null, localDate: r.local_date, label: r.label, details: r.details ?? {}, createdAt: new Date(r.created_at).toISOString() };
}

const ANNOTATION_COLS = 'id, kind, at, end_at, local_date::text as local_date, label, details, created_at';

export async function listAnnotations(pool: pg.Pool, userId: string, from: string, to: string): Promise<Annotation[]> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query(`select ${ANNOTATION_COLS} from public.annotations where user_id = $1 and local_date between $2 and $3 order by at`, [userId, from, to]);
    return r.rows.map(toAnnotation);
  });
}

export async function createAnnotation(pool: pg.Pool, userId: string, input: AnnotationInput): Promise<Annotation> {
  return withUser(pool, userId, async (tx) => {
    const { timeZone } = await profileFor(tx, userId);
    const localDate = localDateOf(input.at, null, timeZone);
    const r = await tx.query(
      `insert into public.annotations (user_id, kind, at, end_at, local_date, label, details) values ($1, $2, $3, $4, $5, $6, $7) returning ${ANNOTATION_COLS}`,
      [userId, input.kind, input.at, input.endAt ?? null, localDate, input.label, JSON.stringify(input.details ?? {})],
    );
    return toAnnotation(r.rows[0]);
  });
}

export async function deleteAnnotation(pool: pg.Pool, userId: string, id: string): Promise<boolean> {
  return withUser(pool, userId, async (tx) => {
    const r = await tx.query('delete from public.annotations where user_id = $1 and id = $2', [userId, id]);
    return (r.rowCount ?? 0) > 0;
  });
}
