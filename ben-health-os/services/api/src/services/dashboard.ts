import type pg from 'pg';
import type { DomainCard, MetricCard, SeriesResponse, TodayResponse } from '@bho/contracts';
import { CONNECTORS, DOMAINS, DOMAIN_LABELS, HEALTH_CONNECT_ORIGINS, metricById, type Domain } from '@bho/shared-config';
import { addDays, coefficientOfVariationPct, compareBaseline, computeFreshness, dailyAggregate, domainStatus, localDateOf, resolveDailySteps, sparkline, type ConnectionHealth, type DailyPoint } from '@bho/analytics';
import { withUser, type Tx } from '../db/pool.js';

export const DASHBOARD_METRICS: Record<Domain, string[]> = {
  recovery: ['sleep_duration', 'sleep_efficiency', 'hrv_rmssd', 'resting_heart_rate', 'respiratory_rate', 'spo2'],
  cardio: ['blood_pressure_systolic', 'pulse', 'steps', 'exercise_minutes', 'active_calories', 'vo2_max'],
  strength_body: ['weight', 'body_fat_pct', 'resistance_sessions'],
  metabolic_nutrition: ['blood_glucose', 'glucose_variability', 'calories', 'protein_g', 'fiber_g', 'saturated_fat_g', 'sodium_mg', 'potassium_mg'],
  clinical_preventive: ['lab_result'],
};

export const DISCLAIMER = 'Ben Health OS organizes and compares your own measurements. It does not diagnose disease, prescribe or change medication, or replace your clinicians. Discuss anything concerning with your physician.';

const PRIORITY_CLASS = new Set(['steps', 'distance_m', 'active_calories', 'total_calories']);

interface ObsRow {
  id: string;
  metric_id: string;
  value: number;
  measured_at: Date;
  local_date: string;
  connector: string;
  data_origin: string | null;
  group_id: string | null;
  canonical: boolean;
  quality_flags: string[];
  source_modified_at: Date | null;
  ingested_at: Date;
  device_label: string | null;
}

export interface LatestInfo {
  value: number;
  measuredAt: string;
  connector: string;
  dataOrigin: string | null;
  deviceLabel: string | null;
  sourceModifiedAt: string | null;
  ingestedAt: string | null;
  qualityFlags: string[];
  companions?: Record<string, number>;
}

function toIso(d: Date | string | null): string | null {
  if (!d) return null;
  return new Date(d).toISOString();
}

function dateStr(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

export function sourceLabel(connector: string, dataOrigin: string | null): string {
  if (connector === 'health_connect') return dataOrigin ? `${HEALTH_CONNECT_ORIGINS[dataOrigin]?.label ?? dataOrigin} via Health Connect` : 'Health Connect';
  return CONNECTORS.find((c) => c.id === connector)?.displayName ?? connector;
}

export async function loadConnections(tx: Tx, userId: string): Promise<Map<string, ConnectionHealth>> {
  const rows = await tx.query<{ connector: string; status: string; last_successful_sync_at: Date | null; last_sync_attempt_at: Date | null; last_sync_status: string; last_error: string | null }>(
    'select connector, status, last_successful_sync_at, last_sync_attempt_at, last_sync_status, last_error from public.source_connections where user_id = $1',
    [userId],
  );
  const map = new Map<string, ConnectionHealth>();
  for (const r of rows.rows) {
    const def = CONNECTORS.find((c) => c.id === r.connector);
    map.set(r.connector, {
      status: r.status,
      lastSuccessfulSyncAt: toIso(r.last_successful_sync_at),
      lastSyncAttemptAt: toIso(r.last_sync_attempt_at),
      lastSyncStatus: r.last_sync_status,
      lastError: r.last_error,
      expectedSyncIntervalHours: def?.expectedSyncIntervalHours ?? 24,
      displayName: def?.displayName ?? r.connector,
    });
  }
  return map;
}

export function connectionsForMetric(metricId: string, map: Map<string, ConnectionHealth>, latestConnector?: string | null): ConnectionHealth[] {
  const list = CONNECTORS.filter((c) => c.metrics.includes(metricId)).map((c) => map.get(c.id)).filter((c): c is ConnectionHealth => Boolean(c));
  // The connector that actually delivered the latest value always counts, even if the catalog lags.
  if (latestConnector && map.has(latestConnector) && !list.includes(map.get(latestConnector)!)) list.push(map.get(latestConnector)!);
  return list;
}

async function loadObservations(tx: Tx, userId: string, metricId: string, fromDate: string, toDate: string, onlyCanonical: boolean): Promise<ObsRow[]> {
  const res = await tx.query<ObsRow>(
    `select o.id, o.metric_id, o.value::float8 as value, o.measured_at, o.local_date::text as local_date, o.connector, o.data_origin, o.group_id, o.canonical, o.quality_flags, o.source_modified_at, o.ingested_at, d.label as device_label
     from public.observations o left join public.source_devices d on d.id = o.device_id
     where o.user_id = $1 and o.metric_id = $2 and o.deleted_at is null and o.local_date between $3 and $4 ${onlyCanonical ? 'and o.canonical' : ''}
       and not ('IMPLAUSIBLE_VALUE' = any(o.quality_flags))
     order by o.measured_at`,
    [userId, metricId, fromDate, toDate],
  );
  return res.rows;
}

/** Daily values for a metric honouring catalog aggregation, source priority (steps-class) and derived metrics. */
export async function loadDaily(tx: Tx, userId: string, metricId: string, fromDate: string, toDate: string): Promise<{ daily: DailyPoint[]; latest: LatestInfo | null }> {
  const def = metricById(metricId);
  if (!def) return { daily: [], latest: null };

  if (metricId === 'glucose_variability') {
    const rows = await loadObservations(tx, userId, 'blood_glucose', fromDate, toDate, true);
    const byDay = new Map<string, number[]>();
    for (const r of rows) byDay.set(r.local_date, [...(byDay.get(r.local_date) ?? []), Number(r.value)]);
    const daily: DailyPoint[] = [];
    for (const [localDate, values] of byDay) {
      if (values.length < 24) continue; // require at least 6 hours of 15-minute samples
      const cv = coefficientOfVariationPct(values);
      if (cv !== null) daily.push({ localDate, value: cv });
    }
    daily.sort((a, b) => a.localDate.localeCompare(b.localDate));
    const last = daily[daily.length - 1];
    const lastRow = rows[rows.length - 1];
    return { daily, latest: last && lastRow ? { value: last.value, measuredAt: toIso(lastRow.measured_at)!, connector: lastRow.connector, dataOrigin: lastRow.data_origin, deviceLabel: lastRow.device_label, sourceModifiedAt: toIso(lastRow.source_modified_at), ingestedAt: toIso(lastRow.ingested_at), qualityFlags: [] } : null };
  }

  if (metricId === 'exercise_minutes' || metricId === 'resistance_sessions') {
    const res = await tx.query<{ local_date: string; minutes: number; resistance: number; last_end: Date; connector: string; data_origin: string | null; ingested_at: Date }>(
      `select local_date::text as local_date, sum(duration_min)::float8 as minutes, count(*) filter (where category = 'RESISTANCE')::int as resistance, max(end_at) as last_end, max(connector) as connector, max(data_origin) as data_origin, max(ingested_at) as ingested_at
       from public.workouts where user_id = $1 and canonical and deleted_at is null and local_date between $2 and $3 group by local_date order by local_date`,
      [userId, fromDate, toDate],
    );
    // A day without a workout is a real zero only when the sources were demonstrably recording that
    // day (any other observation exists); days with no data at all stay missing.
    const active = await tx.query<{ local_date: string }>(
      `select distinct local_date::text as local_date from public.observations where user_id = $1 and deleted_at is null and local_date between $2 and $3`,
      [userId, fromDate, toDate],
    );
    const byDay = new Map(res.rows.map((r) => [r.local_date, r]));
    const daily: DailyPoint[] = [];
    for (const a of active.rows) {
      const r = byDay.get(a.local_date);
      daily.push({ localDate: a.local_date, value: r ? (metricId === 'exercise_minutes' ? Number(r.minutes) : Number(r.resistance)) : 0 });
    }
    daily.sort((a, b) => a.localDate.localeCompare(b.localDate));
    const last = res.rows[res.rows.length - 1];
    const lastDay = daily[daily.length - 1];
    return {
      daily,
      latest: last
        ? { value: lastDay?.value ?? 0, measuredAt: toIso(last.last_end)!, connector: last.connector, dataOrigin: last.data_origin, deviceLabel: null, sourceModifiedAt: null, ingestedAt: toIso(last.ingested_at), qualityFlags: [] }
        : null,
    };
  }

  if (metricId === 'pulse') {
    const res = await tx.query<{ local_date: string; pulse: number; measured_at: Date; connector: string; data_origin: string | null; ingested_at: Date; device_label: string | null }>(
      `select b.local_date::text as local_date, b.pulse::float8 as pulse, b.measured_at, b.connector, b.data_origin, b.ingested_at, d.label as device_label
       from public.blood_pressure_readings b left join public.source_devices d on d.id = b.device_id
       where b.user_id = $1 and b.canonical and b.deleted_at is null and b.pulse is not null and b.local_date between $2 and $3 order by b.measured_at`,
      [userId, fromDate, toDate],
    );
    const daily = dailyAggregate(res.rows.map((r) => ({ localDate: r.local_date, value: Number(r.pulse), measuredAt: toIso(r.measured_at)! })), def);
    const last = res.rows[res.rows.length - 1];
    return { daily, latest: last ? { value: Number(last.pulse), measuredAt: toIso(last.measured_at)!, connector: last.connector, dataOrigin: last.data_origin, deviceLabel: last.device_label, sourceModifiedAt: null, ingestedAt: toIso(last.ingested_at), qualityFlags: [] } : null };
  }

  const rows = await loadObservations(tx, userId, metricId, fromDate, toDate, !PRIORITY_CLASS.has(metricId));
  let daily: DailyPoint[];
  if (PRIORITY_CLASS.has(metricId)) {
    // Overlapping origins (phone + ring) are never summed: pick the highest-priority origin per day.
    const byDay = new Map<string, Map<string, { connector: string; dataOrigin: string | null; total: number }>>();
    for (const r of rows) {
      const key = `${r.connector}|${r.data_origin ?? ''}`;
      const m = byDay.get(r.local_date) ?? new Map();
      const cur = m.get(key) ?? { connector: r.connector, dataOrigin: r.data_origin, total: 0 };
      cur.total += Number(r.value);
      m.set(key, cur);
      byDay.set(r.local_date, m);
    }
    daily = [];
    for (const [localDate, m] of byDay) {
      const chosen = resolveDailySteps([...m.values()].map((v) => ({ connector: v.connector, dataOrigin: v.dataOrigin, steps: v.total })));
      if (chosen) daily.push({ localDate, value: chosen.steps });
    }
    daily.sort((a, b) => a.localDate.localeCompare(b.localDate));
  } else {
    daily = dailyAggregate(rows.map((r) => ({ localDate: r.local_date, value: Number(r.value), measuredAt: toIso(r.measured_at)!, canonical: r.canonical })), def);
  }
  const canonicalRows = rows.filter((r) => r.canonical);
  const last = canonicalRows[canonicalRows.length - 1];
  let latest: LatestInfo | null = null;
  if (last) {
    // Accumulating metrics (steps, calories, protein…) present the latest day's total, not one record.
    const lastDaily = daily[daily.length - 1];
    const value = def.dailyAggregation === 'sum' && lastDaily ? lastDaily.value : Number(last.value);
    latest = { value, measuredAt: toIso(last.measured_at)!, connector: last.connector, dataOrigin: last.data_origin, deviceLabel: last.device_label, sourceModifiedAt: toIso(last.source_modified_at), ingestedAt: toIso(last.ingested_at), qualityFlags: last.quality_flags ?? [] };
    if (metricId === 'blood_pressure_systolic' && last.group_id) {
      const comp = await tx.query<{ diastolic: number; pulse: number | null }>('select diastolic::float8 as diastolic, pulse::float8 as pulse from public.blood_pressure_readings where id = $1', [last.group_id]);
      if (comp.rows[0]) latest.companions = { blood_pressure_diastolic: Number(comp.rows[0].diastolic), ...(comp.rows[0].pulse != null ? { pulse: Number(comp.rows[0].pulse) } : {}) };
    }
  }
  return { daily, latest };
}

export async function buildMetricCard(tx: Tx, userId: string, metricId: string, asOfDate: string, nowIso: string, connections: Map<string, ConnectionHealth>): Promise<MetricCard> {
  const def = metricById(metricId)!;
  const fromDate = addDays(asOfDate, -34);
  const latestWindowFrom = addDays(asOfDate, -365);
  const { daily, latest } = await loadDaily(tx, userId, metricId, fromDate, addDays(asOfDate, 1));
  let latestInfo = latest;
  if (!latestInfo && metricId !== 'glucose_variability') {
    // Look further back for the latest value so freshness can explain how old it is.
    const older = await loadDaily(tx, userId, metricId, latestWindowFrom, fromDate);
    latestInfo = older.latest;
  }
  const comparison = daily.length > 0 ? compareBaseline(metricId, daily, asOfDate) : null;
  const freshness = computeFreshness({
    metricId,
    now: nowIso,
    latestMeasuredAt: latestInfo?.measuredAt ?? null,
    sourceUpdatedAt: latestInfo?.sourceModifiedAt ?? null,
    ingestedAt: latestInfo?.ingestedAt ?? null,
    connections: connectionsForMetric(metricId, connections, latestInfo?.connector ?? null),
  });
  const qualityFlags = new Set<string>(latestInfo?.qualityFlags ?? []);
  if (comparison && comparison.current7d.coverage < 1 && comparison.changeClass !== 'INSUFFICIENT_EVIDENCE') qualityFlags.add('PARTIAL_COVERAGE_7D');
  return {
    metricId,
    label: def.label,
    unit: def.unit,
    domain: def.domain,
    latest: latestInfo
      ? {
          value: Number(latestInfo.value.toFixed(def.precision)),
          unit: def.unit,
          measuredAt: latestInfo.measuredAt,
          connector: latestInfo.connector as MetricCard['latest'] extends infer _ ? any : never,
          dataOrigin: latestInfo.dataOrigin,
          sourceLabel: sourceLabel(latestInfo.connector, latestInfo.dataOrigin),
          deviceLabel: latestInfo.deviceLabel,
          ...(latestInfo.companions ? { companions: latestInfo.companions } : {}),
        }
      : null,
    freshness,
    comparison,
    sparkline: sparkline(daily, addDays(asOfDate, -27), asOfDate),
    qualityFlags: [...qualityFlags],
  };
}

function domainSummary(status: DomainCard['status'], label: string, evidence: string[]): string {
  switch (status) {
    case 'NOT_CONNECTED':
      return `${label}: no connected source yet.`;
    case 'INSUFFICIENT_DATA':
      return `${label}: not enough days of data for a baseline comparison yet.`;
    case 'ATTENTION':
      return `${label}: a meaningful unfavourable change versus your 28-day baseline.`;
    case 'WATCH':
      return `${label}: a directional change worth watching; not yet meaningful.`;
    case 'IMPROVING':
      return `${label}: a meaningful favourable change versus your 28-day baseline.`;
    default:
      return evidence.length > 1 ? `${label}: steady versus baseline.` : `${label}: steady versus your 28-day baseline.`;
  }
}

export async function buildToday(pool: pg.Pool, userId: string, now: Date = new Date()): Promise<TodayResponse> {
  const nowIso = now.toISOString();
  return withUser(pool, userId, async (tx) => {
    const prof = await tx.query<{ time_zone: string; display_name: string; demo_mode: boolean }>('select time_zone, display_name, demo_mode from public.profiles where id = $1', [userId]);
    const timeZone = prof.rows[0]?.time_zone ?? 'UTC';
    const localToday = localDateOf(nowIso, null, timeZone);
    const asOfDate = addDays(localToday, -1); // latest COMPLETE local day
    const connections = await loadConnections(tx, userId);

    const domains: DomainCard[] = [];
    for (const domain of DOMAINS) {
      const cards: MetricCard[] = [];
      for (const metricId of DASHBOARD_METRICS[domain]) cards.push(await buildMetricCard(tx, userId, metricId, asOfDate, nowIso, connections));
      const { status, evidence } = domainStatus(cards);
      domains.push({ domain, label: DOMAIN_LABELS[domain], status, summary: domainSummary(status, DOMAIN_LABELS[domain], evidence), evidence, metrics: cards });
    }

    const allCards = domains.flatMap((d) => d.metrics);
    const whatChanged = allCards
      .filter((c) => c.comparison && (c.comparison.changeClass === 'MEANINGFUL' || c.comparison.changeClass === 'DIRECTIONAL'))
      .sort((a, b) => (a.comparison!.changeClass === 'MEANINGFUL' ? -1 : 1) - (b.comparison!.changeClass === 'MEANINGFUL' ? -1 : 1))
      .slice(0, 6)
      .map((c) => `${c.label}: ${c.comparison!.explanation}`);

    const whatMatters: string[] = [];
    for (const d of domains) if (d.status === 'ATTENTION') whatMatters.push(`${d.label} needs attention: ${d.evidence[0] ?? 'see details'}`);
    const problemSources = new Map<string, string>();
    for (const c of allCards) if (c.freshness.status === 'SYNC_ERROR' || c.freshness.status === 'STALE') problemSources.set(c.label, c.freshness.reason);
    for (const [label, reason] of [...problemSources].slice(0, 3)) whatMatters.push(`${label} is not current: ${reason}`);

    const doToday: string[] = [];
    const bp = allCards.find((c) => c.metricId === 'blood_pressure_systolic');
    if (bp && ['STALE', 'SOURCE_DELAYED', 'INSUFFICIENT_DATA'].includes(bp.freshness.status)) doToday.push('Take a seated blood-pressure reading this morning (two readings, one minute apart) so the cardiovascular trend stays current.');
    const sleep = allCards.find((c) => c.metricId === 'sleep_duration');
    if (sleep && ['STALE', 'SOURCE_DELAYED', 'INSUFFICIENT_DATA'].includes(sleep.freshness.status)) doToday.push('Open the Oura app so last night’s sleep syncs to Health Connect.');
    const errored = allCards.find((c) => c.freshness.status === 'SYNC_ERROR');
    if (errored) doToday.push(`Fix the failing source under Data Sources (${errored.label}: ${errored.freshness.reason.split('.')[0]}).`);
    for (const d of domains) if (d.status === 'ATTENTION') doToday.push(`${d.label}: review the evidence and, if the change persists for several days, note it for your physician.`);
    if (doToday.length === 0) doToday.push('No data-driven actions today. Keep sleep, training and meals on their usual schedule.');

    const steadyCount = domains.filter((d) => d.status === 'STEADY' || d.status === 'IMPROVING').length;
    const attention = domains.filter((d) => d.status === 'ATTENTION').map((d) => d.label);
    const headline = attention.length ? `${attention.join(', ')} ${attention.length > 1 ? 'need' : 'needs'} attention; ${steadyCount} of ${domains.length} domains steady.` : `${steadyCount} of ${domains.length} domains steady or improving versus your 28-day baseline.`;

    const q = await tx.query<{ observations: number; dups: number; implausible: number }>(
      `select count(*) filter (where canonical)::int as observations, count(*) filter (where not canonical)::int as dups, count(*) filter (where 'IMPLAUSIBLE_VALUE' = any(quality_flags))::int as implausible
       from public.observations where user_id = $1 and deleted_at is null and measured_at > $2::timestamptz - interval '30 days'`,
      [userId, nowIso],
    );
    const connected = [...connections.values()].filter((c) => c.status === 'CONNECTED').length;
    const staleSources = new Set(allCards.filter((c) => ['STALE', 'SYNC_ERROR'].includes(c.freshness.status)).map((c) => c.latest?.sourceLabel ?? c.label)).size;
    const notes: string[] = [];
    if (prof.rows[0]?.demo_mode) notes.push('Demo mode: all data shown is synthetic.');
    if (Number(q.rows[0]!.implausible) > 0) notes.push(`${q.rows[0]!.implausible} value(s) in the last 30 days are flagged implausible: kept in the raw record, excluded from trends. Review them under Trends (raw view).`);
    if (Number(q.rows[0]!.dups) > 0) notes.push(`${q.rows[0]!.dups} cross-source duplicate(s) linked in the last 30 days (counted once).`);

    return {
      generatedAt: nowIso,
      timeZone,
      localDate: localToday,
      demoMode: Boolean(prof.rows[0]?.demo_mode),
      headline,
      whatChanged,
      whatMatters: whatMatters.length ? whatMatters : ['Nothing needs attention based on the available data.'],
      doToday,
      domains,
      dataQuality: { connectedSources: connected, staleSources, observations30d: Number(q.rows[0]!.observations), crossSourceDuplicates30d: Number(q.rows[0]!.dups), implausibleValues30d: Number(q.rows[0]!.implausible), notes },
      disclaimer: DISCLAIMER,
    };
  });
}

export async function buildSeries(pool: pg.Pool, userId: string, metricId: string, from: string, to: string, bucket: 'raw' | 'day'): Promise<SeriesResponse> {
  const def = metricById(metricId);
  if (!def) throw Object.assign(new Error(`unknown metric ${metricId}`), { statusCode: 404 });
  return withUser(pool, userId, async (tx) => {
    const prof = await tx.query<{ time_zone: string }>('select time_zone from public.profiles where id = $1', [userId]);
    const tz = prof.rows[0]?.time_zone ?? 'UTC';
    const fromDate = localDateOf(from, null, tz);
    const toDate = localDateOf(to, null, tz);
    const { daily } = await loadDaily(tx, userId, metricId, fromDate, toDate);
    let points: SeriesResponse['points'] = [];
    if (bucket === 'raw') {
      if (metricId === 'pulse' || metricId === 'blood_pressure_systolic' || metricId === 'blood_pressure_diastolic') {
        const rows = await tx.query<{ measured_at: Date; local_date: string; systolic: number; diastolic: number; pulse: number | null; connector: string; data_origin: string | null; canonical: boolean }>(
          `select measured_at, local_date::text as local_date, systolic::float8 as systolic, diastolic::float8 as diastolic, pulse::float8 as pulse, connector, data_origin, canonical from public.blood_pressure_readings where user_id = $1 and deleted_at is null and measured_at between $2 and $3 order by measured_at`,
          [userId, from, to],
        );
        points = rows.rows
          .filter((r) => metricId !== 'pulse' || r.pulse != null)
          .map((r) => ({ t: toIso(r.measured_at)!, localDate: r.local_date, value: metricId === 'pulse' ? Number(r.pulse) : metricId === 'blood_pressure_systolic' ? Number(r.systolic) : Number(r.diastolic), connector: r.connector as any, dataOrigin: r.data_origin, canonical: r.canonical, companions: { blood_pressure_systolic: Number(r.systolic), blood_pressure_diastolic: Number(r.diastolic), ...(r.pulse != null ? { pulse: Number(r.pulse) } : {}) } }));
      } else if (metricId !== 'glucose_variability' && metricId !== 'exercise_minutes' && metricId !== 'resistance_sessions') {
        const rows = await loadObservations(tx, userId, metricId, fromDate, toDate, false);
        points = rows.map((r) => ({ t: toIso(r.measured_at)!, localDate: r.local_date, value: Number(r.value), connector: r.connector as any, dataOrigin: r.data_origin, canonical: r.canonical }));
      }
    }
    const dailyMap = new Map(daily.map((d) => [d.localDate, d.value]));
    const counts = new Map<string, number>();
    for (const p of points) if (p.canonical) counts.set(p.localDate, (counts.get(p.localDate) ?? 0) + 1);
    const days: string[] = [];
    for (let d = fromDate; d <= toDate; d = addDays(d, 1)) days.push(d);
    return {
      metricId,
      unit: def.unit,
      from,
      to,
      bucket,
      points,
      daily: days.map((date) => ({ date, value: dailyMap.has(date) ? Number(dailyMap.get(date)!.toFixed(def.precision)) : null, n: counts.get(date) ?? (dailyMap.has(date) ? 1 : 0) })),
    };
  });
}

export { dateStr };
