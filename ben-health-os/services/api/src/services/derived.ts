import type pg from 'pg';
import type { DeriveResult, Signal, TrendsResponse } from '@bho/contracts';
import { METRIC_CATALOG, metricById } from '@bho/shared-config';
import { addDays, compareBaseline, confidenceFromCoverage, detectSignals, estimateMaxHeartRate, estimateZoneMinutes, localDateOf, percentileRank, rankSignals, windowStats, zoneBounds, type DailyPoint } from '@bho/analytics';
import { withService, withUser, type Tx } from '../db/pool.js';
import { buildMetricCard, loadConnections, loadDaily } from './dashboard.js';

const WINDOWS = [7, 28, 90, 365] as const;
const WINDOW_ALGO = { algorithm: 'window_stats', version: 1 };
const BASELINE_ALGO = { algorithm: 'baseline_7_vs_28', version: 1 };
const SIGNAL_VERSION = 1;
const ZONE2_VERSION = 1;

interface ProfilePhys {
  time_zone: string;
  birth_date: string | null;
  max_heart_rate: number | null;
}

async function profile(tx: Tx, userId: string): Promise<ProfilePhys> {
  const r = await tx.query<{ time_zone: string; birth_date: Date | null; max_heart_rate: number | null }>('select time_zone, birth_date, max_heart_rate from public.profiles where id = $1', [userId]);
  const p = r.rows[0];
  return { time_zone: p?.time_zone ?? 'UTC', birth_date: p?.birth_date ? new Date(p.birth_date).toISOString().slice(0, 10) : null, max_heart_rate: p?.max_heart_rate ?? null };
}

async function upsertDerived(tx: Tx, userId: string, metricId: string, algo: { algorithm: string; version: number }, windowFrom: string, windowTo: string, row: { coverage: number | null; n: number; value: number | null; unit: string; result: unknown; confidence: 'LOW' | 'MEDIUM' | 'HIGH'; flags: string[]; inputRefs: unknown }): Promise<void> {
  await tx.query(
    `insert into public.derived_metrics (user_id, metric_id, algorithm, algorithm_version, window_from, window_to, coverage, observation_count, value, unit, result, confidence, quality_flags, input_refs, computed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
     on conflict (user_id, metric_id, algorithm, algorithm_version, window_from, window_to) do update set coverage = excluded.coverage, observation_count = excluded.observation_count, value = excluded.value, unit = excluded.unit, result = excluded.result, confidence = excluded.confidence, quality_flags = excluded.quality_flags, input_refs = excluded.input_refs, computed_at = now()`,
    [userId, metricId, algo.algorithm, algo.version, windowFrom, windowTo, row.coverage, row.n, row.value, row.unit, JSON.stringify(row.result), row.confidence, row.flags, JSON.stringify(row.inputRefs)],
  );
}

/** Recomputes Zone 2 minutes per canonical workout from heart-rate samples. Returns workouts updated. */
export async function deriveZone2(tx: Tx, userId: string, phys: ProfilePhys, asOf: string): Promise<number> {
  const maxHr = estimateMaxHeartRate({ maxHeartRate: phys.max_heart_rate, birthDate: phys.birth_date, asOf });
  // Remove derived zone-2 rows whose workout is gone or no longer canonical, or when no max HR is known.
  await tx.query(`delete from public.observations o where o.user_id = $1 and o.metric_id = 'zone2_minutes' and (o.group_id is null or not exists (select 1 from public.workouts w where w.id = o.group_id and w.canonical and w.deleted_at is null))`, [userId]);
  if (!maxHr) {
    await tx.query(`delete from public.observations where user_id = $1 and metric_id = 'zone2_minutes'`, [userId]);
    return 0;
  }
  const workouts = await tx.query<{ id: string; start_at: Date; end_at: Date; local_date: string; connector: string; data_origin: string | null; external_id: string; raw_event_id: string | null; device_id: string | null }>(
    `select id, start_at, end_at, local_date::text as local_date, connector, data_origin, external_id, raw_event_id, device_id from public.workouts where user_id = $1 and canonical and deleted_at is null and local_date >= $2::date - 365`,
    [userId, asOf],
  );
  let updated = 0;
  for (const w of workouts.rows) {
    const samples = await tx.query<{ measured_at: Date; value: number }>(
      `select measured_at, value::float8 as value from public.observations where user_id = $1 and metric_id = 'heart_rate' and deleted_at is null and measured_at between $2 and $3 order by measured_at`,
      [userId, w.start_at, w.end_at],
    );
    const est = estimateZoneMinutes({ startAt: new Date(w.start_at).toISOString(), endAt: new Date(w.end_at).toISOString() }, samples.rows.map((s) => ({ time: new Date(s.measured_at).toISOString(), bpm: Number(s.value) })), maxHr.value);
    if (!est) {
      await tx.query(`delete from public.observations where user_id = $1 and metric_id = 'zone2_minutes' and group_id = $2`, [userId, w.id]);
      continue;
    }
    await tx.query(
      `insert into public.observations (user_id, metric_id, value, unit, measured_at, start_at, end_at, local_date, connector, data_origin, device_id, external_id, raw_event_id, group_id, recording_method, quality_flags)
       values ($1, 'zone2_minutes', $2, 'min', $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'UNKNOWN', $12)
       on conflict (user_id, connector, external_id, metric_id) do update set value = excluded.value, quality_flags = excluded.quality_flags, measured_at = excluded.measured_at, end_at = excluded.end_at, local_date = excluded.local_date, deleted_at = null, updated_at = now()`,
      [userId, est.minutes, w.start_at, w.end_at, w.local_date, w.connector, w.data_origin, w.device_id, `${w.external_id}#zone2`, w.raw_event_id, w.id, [`DERIVED:zone2_minutes:v${ZONE2_VERSION}`, `MAX_HR:${maxHr.value}:${maxHr.source}`, `HR_SAMPLES:${est.samples}`]],
    );
    updated++;
  }
  return updated;
}

/** Computes and persists window stats, baseline comparisons, signals and zone-2 minutes for one user. */
export async function deriveForUser(pool: pg.Pool, userId: string, now: Date = new Date()): Promise<DeriveResult> {
  const started = Date.now();
  const nowIso = now.toISOString();
  return withUser(pool, userId, async (tx) => {
    const phys = await profile(tx, userId);
    const asOf = addDays(localDateOf(nowIso, null, phys.time_zone), -1);
    const zone2Workouts = await deriveZone2(tx, userId, phys, asOf);
    const connections = await loadConnections(tx, userId);
    const present = await tx.query<{ metric_id: string }>(`select distinct metric_id from public.observations where user_id = $1 and deleted_at is null and local_date >= $2::date - 365`, [userId, asOf]);
    const presentSet = new Set(present.rows.map((r) => r.metric_id));
    const derivedOnly = new Set(['glucose_variability', 'exercise_minutes', 'resistance_sessions', 'pulse']);
    let metricsComputed = 0;
    let windowsWritten = 0;
    let signalsWritten = 0;
    await tx.query(`delete from public.signals where user_id = $1 and as_of_date = $2 and algorithm_version = $3`, [userId, asOf, SIGNAL_VERSION]);
    for (const def of METRIC_CATALOG) {
      if (def.id === 'lab_result') continue;
      const hasData = presentSet.has(def.id) || (derivedOnly.has(def.id) && (presentSet.has('blood_glucose') || presentSet.has('exercise_minutes') || presentSet.has('blood_pressure_systolic')));
      if (!hasData) continue;
      const { daily } = await loadDaily(tx, userId, def.id, addDays(asOf, -364), asOf);
      if (daily.length === 0) continue;
      metricsComputed++;
      for (const days of WINDOWS) {
        const from = addDays(asOf, -(days - 1));
        const stats = windowStats(daily, from, asOf);
        await upsertDerived(tx, userId, def.id, WINDOW_ALGO, from, asOf, { coverage: stats.coverage, n: stats.n, value: stats.mean, unit: def.unit, result: stats, confidence: confidenceFromCoverage(stats.coverage, stats.n), flags: stats.n === 0 ? ['NO_DATA'] : [], inputRefs: { days, source: 'observations', aggregation: def.dailyAggregation } });
        windowsWritten++;
      }
      const cmp = compareBaseline(def.id, daily, asOf);
      await upsertDerived(tx, userId, def.id, BASELINE_ALGO, cmp.baseline28d.from, cmp.current7d.to, { coverage: cmp.current7d.coverage, n: cmp.current7d.n, value: cmp.delta, unit: def.unit, result: cmp, confidence: cmp.changeClass === 'INSUFFICIENT_EVIDENCE' ? 'LOW' : confidenceFromCoverage(Math.min(cmp.current7d.coverage, cmp.baseline28d.coverage), cmp.current7d.n), flags: [cmp.changeClass], inputRefs: { current: cmp.current7d, baseline: cmp.baseline28d } });
      windowsWritten++;
      const card = await buildMetricCard(tx, userId, def.id, asOf, nowIso, connections);
      const implausible = await tx.query<{ n: number }>(`select count(*)::int as n from public.observations where user_id = $1 and metric_id = $2 and deleted_at is null and 'IMPLAUSIBLE_VALUE' = any(quality_flags) and measured_at > $3::timestamptz - interval '30 days'`, [userId, def.id, nowIso]);
      const signals = rankSignals(detectSignals({ card, daily365: daily, implausibleCount30d: Number(implausible.rows[0]!.n) }));
      for (const s of signals) {
        await tx.query(
          `insert into public.signals (user_id, as_of_date, metric_id, domain, kind, direction, priority, delta, delta_pct, effect_size, explanation, evidence, algorithm_version)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (user_id, as_of_date, metric_id, kind, algorithm_version) do nothing`,
          [userId, asOf, s.metricId, s.domain, s.kind, s.direction, s.priority, s.delta, s.deltaPct, s.effectSize, s.explanation, JSON.stringify(s.evidence), SIGNAL_VERSION],
        );
        signalsWritten++;
      }
    }
    return { asOfDate: asOf, metricsComputed, windowsWritten, signals: signalsWritten, zone2Workouts, durationMs: Date.now() - started };
  });
}

export async function deriveAll(pool: pg.Pool, now: Date = new Date()): Promise<{ users: number; failed: number; results: Array<{ userId: string; result?: DeriveResult; error?: string }> }> {
  const users = await withService(pool, (tx) => tx.query<{ id: string }>('select id from public.profiles'));
  const results: Array<{ userId: string; result?: DeriveResult; error?: string }> = [];
  let failed = 0;
  for (const u of users.rows) {
    try {
      results.push({ userId: u.id, result: await deriveForUser(pool, u.id, now) });
    } catch (e) {
      failed++;
      results.push({ userId: u.id, error: (e as Error).message.slice(0, 200) });
    }
  }
  return { users: users.rows.length, failed, results };
}

export async function trendsForMetric(pool: pg.Pool, userId: string, metricId: string, now: Date = new Date()): Promise<TrendsResponse> {
  const def = metricById(metricId);
  if (!def) throw Object.assign(new Error(`unknown metric ${metricId}`), { statusCode: 404 });
  const nowIso = now.toISOString();
  return withUser(pool, userId, async (tx) => {
    const phys = await profile(tx, userId);
    const asOf = addDays(localDateOf(nowIso, null, phys.time_zone), -1);
    const { daily } = await loadDaily(tx, userId, metricId, addDays(asOf, -364), asOf);
    const persisted = await tx.query<{ window_from: Date; computed_at: Date; algorithm_version: number }>(`select window_from, computed_at, algorithm_version from public.derived_metrics where user_id = $1 and metric_id = $2 and algorithm = 'window_stats' and window_to = $3`, [userId, metricId, asOf]);
    const windows = WINDOWS.map((days) => {
      const from = addDays(asOf, -(days - 1));
      const stats = windowStats(daily, from, asOf);
      const p = persisted.rows.find((r) => new Date(r.window_from).toISOString().slice(0, 10) === from);
      return { days, stats, confidence: confidenceFromCoverage(stats.coverage, stats.n), algorithmVersion: p?.algorithm_version ?? WINDOW_ALGO.version, computedAt: p ? new Date(p.computed_at).toISOString() : nowIso };
    });
    const comparison = daily.length ? compareBaseline(metricId, daily, asOf) : null;
    const pct = comparison?.current7d.mean != null && daily.length >= 30 ? percentileRank(comparison.current7d.mean, daily.map((d) => d.value)) : null;
    const sig = await tx.query<{ as_of_date: Date; kind: Signal['kind']; direction: Signal['direction']; priority: number; delta: number | null; delta_pct: number | null; effect_size: number | null; explanation: string; evidence: Record<string, unknown>; algorithm_version: number; domain: Signal['domain'] }>(
      `select as_of_date, kind, direction, priority, delta, delta_pct, effect_size, explanation, evidence, algorithm_version, domain from public.signals where user_id = $1 and metric_id = $2 order by as_of_date desc, priority limit 20`,
      [userId, metricId],
    );
    const dailyMap = new Map(daily.map((d) => [d.localDate, d.value]));
    const series: Array<{ date: string; value: number | null }> = [];
    for (let d = addDays(asOf, -364); d <= asOf; d = addDays(d, 1)) series.push({ date: d, value: dailyMap.has(d) ? Number(dailyMap.get(d)!.toFixed(def.precision)) : null });
    const res: TrendsResponse = {
      metricId,
      label: def.label,
      unit: def.unit,
      asOfDate: asOf,
      windows,
      comparison,
      percentile365: pct === null ? null : Number(pct.toFixed(1)),
      daily: series,
      signals: sig.rows.map((r) => ({ metricId, domain: r.domain, kind: r.kind, direction: r.direction, priority: r.priority, delta: r.delta === null ? null : Number(r.delta), deltaPct: r.delta_pct === null ? null : Number(r.delta_pct), effectSize: r.effect_size === null ? null : Number(r.effect_size), explanation: r.explanation, evidence: r.evidence, asOfDate: new Date(r.as_of_date).toISOString().slice(0, 10), algorithmVersion: r.algorithm_version })),
    };
    if (metricId === 'zone2_minutes' || metricId === 'heart_rate') {
      const maxHr = estimateMaxHeartRate({ maxHeartRate: phys.max_heart_rate, birthDate: phys.birth_date, asOf });
      res.zone = { maxHeartRate: maxHr?.value ?? null, source: maxHr?.source ?? null, zone2: maxHr ? zoneBounds(maxHr.value).zone2 : null };
    }
    return res;
  });
}

export async function latestSignals(pool: pg.Pool, userId: string, asOf?: string): Promise<Signal[]> {
  return withUser(pool, userId, async (tx) => {
    const date = asOf ?? (await tx.query<{ d: Date | null }>('select max(as_of_date) as d from public.signals where user_id = $1', [userId])).rows[0]?.d;
    if (!date) return [];
    const r = await tx.query<{ as_of_date: Date; metric_id: string; domain: Signal['domain']; kind: Signal['kind']; direction: Signal['direction']; priority: number; delta: number | null; delta_pct: number | null; effect_size: number | null; explanation: string; evidence: Record<string, unknown>; algorithm_version: number }>(
      `select as_of_date, metric_id, domain, kind, direction, priority, delta, delta_pct, effect_size, explanation, evidence, algorithm_version from public.signals where user_id = $1 and as_of_date = $2 order by priority, kind`,
      [userId, date],
    );
    return r.rows.map((x) => ({ metricId: x.metric_id, domain: x.domain, kind: x.kind, direction: x.direction, priority: x.priority, delta: x.delta === null ? null : Number(x.delta), deltaPct: x.delta_pct === null ? null : Number(x.delta_pct), effectSize: x.effect_size === null ? null : Number(x.effect_size), explanation: x.explanation, evidence: x.evidence, asOfDate: new Date(x.as_of_date).toISOString().slice(0, 10), algorithmVersion: x.algorithm_version }));
  });
}

export type { DailyPoint };
