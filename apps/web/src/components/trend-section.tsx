'use client';

/**
 * 7-day and 30-day BP trend charts. Session averages are plotted as points,
 * daily means as a 2px line, systolic (blue) and diastolic (orange) — the
 * two-slot palette is CVD-validated for light and dark surfaces. One
 * morning/evening toggle scopes both charts. The y-axis spans at least
 * 60–160 mmHg so variation is never visually exaggerated. All values are
 * also reachable without hover via the session list and history table.
 */

import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type { BpSummaryDto } from '@benhealth/shared';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  bpAxisDomain,
  bpAxisTicks,
  dailyMeansFromPoints,
  inDayPart,
  type DayPart,
  type SessionPoint,
} from '@/lib/bp-data';
import { formatClock, formatShortDate } from '@/lib/format';

interface ChartRow {
  t: number;
  kind: 'session' | 'daily';
  sSys?: number;
  sDia?: number;
  dSys?: number;
  dDia?: number;
  tz?: string | null;
  localDate?: string;
  sessionCount?: number;
}

const SERIES_META: Record<string, { label: string; colorVar: string }> = {
  sSys: { label: 'Systolic · session avg', colorVar: 'var(--series-sys)' },
  dSys: { label: 'Systolic · daily mean', colorVar: 'var(--series-sys)' },
  sDia: { label: 'Diastolic · session avg', colorVar: 'var(--series-dia)' },
  dDia: { label: 'Diastolic · daily mean', colorVar: 'var(--series-dia)' },
};

function dayTicks(fromMs: number, toMs: number, stepDays: number): number[] {
  const ticks: number[] = [];
  for (let t = toMs; t >= fromMs; t -= stepDays * 86_400_000) ticks.push(t);
  return ticks.reverse();
}

/** Session-point mark: >=8px dot with a 2px surface ring. */
function pointShape(colorVar: string) {
  return function PointShape(props: unknown): ReactElement {
    const { cx, cy } = props as { cx?: number; cy?: number };
    if (typeof cx !== 'number' || typeof cy !== 'number' || !Number.isFinite(cy)) {
      return <g />;
    }
    return (
      <circle cx={cx} cy={cy} r={4} fill={colorVar} stroke="var(--surface)" strokeWidth={2} />
    );
  };
}

function renderTooltip(props: unknown): ReactNode {
  const { active, payload } = props as {
    active?: boolean;
    payload?: Array<{ dataKey?: unknown; value?: unknown; payload?: ChartRow }>;
  };
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (row === undefined) return null;

  const when =
    row.kind === 'session'
      ? `${formatShortDate(new Date(row.t), row.tz ?? null)}, ${formatClock(new Date(row.t), row.tz ?? null)}`
      : `${row.localDate ?? formatShortDate(new Date(row.t), null)} · daily mean (${row.sessionCount ?? '?'} session${row.sessionCount === 1 ? '' : 's'})`;

  const rows = payload.filter(
    (entry) =>
      typeof entry.dataKey === 'string' &&
      entry.dataKey in SERIES_META &&
      typeof entry.value === 'number' &&
      Number.isFinite(entry.value),
  );
  if (rows.length === 0) return null;

  return (
    <div className="trend-tooltip">
      <div className="tt-time">{when}</div>
      {rows.map((entry) => {
        const meta = SERIES_META[entry.dataKey as string]!;
        return (
          <div className="tt-row" key={entry.dataKey as string}>
            <span className="tt-key" style={{ background: meta.colorVar }} aria-hidden />
            <span className="tt-value">{entry.value as number}</span>
            <span className="tt-label">{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function TrendChart({
  title,
  points,
  part,
  fromMs,
  toMs,
  tickStepDays,
  tz,
}: {
  title: string;
  points: SessionPoint[];
  part: DayPart;
  fromMs: number;
  toMs: number;
  tickStepDays: number;
  tz: string | null;
}) {
  const { rows, domain, count } = useMemo(() => {
    const inWindow = points.filter((p) => p.t >= fromMs && p.t <= toMs);
    const filtered = inWindow.filter((p) => inDayPart(p.localHour, part));
    const daily = dailyMeansFromPoints(filtered);
    const merged: ChartRow[] = [
      ...filtered.map<ChartRow>((p) => ({
        t: p.t,
        kind: 'session',
        sSys: p.sys,
        sDia: p.dia,
        tz: p.tz,
      })),
      ...daily.map<ChartRow>((d) => ({
        t: d.t,
        kind: 'daily',
        dSys: d.sys,
        dDia: d.dia,
        localDate: d.date,
        sessionCount: d.sessionCount,
      })),
    ].sort((a, b) => a.t - b.t);
    const values = filtered.flatMap((p) => [p.sys, p.dia]);
    return { rows: merged, domain: bpAxisDomain(values), count: filtered.length };
  }, [points, part, fromMs, toMs]);

  const partLabel = part === 'all' ? 'all sessions' : `${part} sessions`;
  const ariaLabel = `${title}: ${count} blood pressure ${partLabel} plotted as systolic and diastolic session averages with daily mean lines, in mmHg.`;

  return (
    <figure style={{ margin: 0 }} role="img" aria-label={ariaLabel}>
      <figcaption className="card-note" style={{ marginBottom: 4 }}>
        {title}
      </figcaption>
      {count === 0 ? (
        <p className="card-note" style={{ padding: '32px 0' }}>
          No {partLabel} in this window.
        </p>
      ) : (
        <div className="chart-scroll">
          <div className="chart-inner">
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={[fromMs, toMs]}
                  ticks={dayTicks(fromMs, toMs, tickStepDays)}
                  tickFormatter={(t: number) => formatShortDate(new Date(t), tz)}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                />
                <YAxis
                  domain={domain}
                  ticks={bpAxisTicks(domain)}
                  width={34}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
                  content={renderTooltip}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="dSys"
                  type="monotone"
                  stroke="var(--series-sys)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  dataKey="dDia"
                  type="monotone"
                  stroke="var(--series-dia)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
                <Scatter dataKey="sSys" shape={pointShape('var(--series-sys)')} isAnimationActive={false} />
                <Scatter dataKey="sDia" shape={pointShape('var(--series-dia)')} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </figure>
  );
}

export function TrendSection({
  points,
  summary7,
  summary30,
  nowMs,
  tz,
}: {
  points: SessionPoint[];
  summary7: BpSummaryDto;
  summary30: BpSummaryDto;
  nowMs: number;
  tz: string | null;
}) {
  const [part, setPart] = useState<DayPart>('all');

  const fmt = (v: number | null) => (v === null ? '—' : String(v));
  const mean = (s: BpSummaryDto) =>
    s.meanSystolic === null || s.meanDiastolic === null
      ? '—'
      : `${s.meanSystolic}/${s.meanDiastolic}`;

  return (
    <section className="card" aria-labelledby="trends-title">
      <h2 className="card-title" id="trends-title">
        Trends
      </h2>
      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">7-day mean</span>
          <span className="stat-value">
            {mean(summary7)} <small>mmHg · {summary7.sessionCount} sessions</small>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">30-day mean</span>
          <span className="stat-value">
            {mean(summary30)} <small>mmHg · {summary30.sessionCount} sessions</small>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">30-day morning</span>
          <span className="stat-value">
            {summary30.morning.meanSystolic === null
              ? '—'
              : `${fmt(summary30.morning.meanSystolic)}/${fmt(summary30.morning.meanDiastolic)}`}{' '}
            <small>mmHg</small>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">30-day evening</span>
          <span className="stat-value">
            {summary30.evening.meanSystolic === null
              ? '—'
              : `${fmt(summary30.evening.meanSystolic)}/${fmt(summary30.evening.meanDiastolic)}`}{' '}
            <small>mmHg</small>
          </span>
        </div>
      </div>

      <div className="toggle-row" role="group" aria-label="Filter sessions by time of day">
        {(
          [
            ['all', 'All sessions'],
            ['morning', 'Morning'],
            ['evening', 'Evening'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="btn"
            aria-pressed={part === value}
            onClick={() => setPart(value)}
          >
            {label}
          </button>
        ))}
        <span className="card-note">
          {part === 'morning'
            ? 'Morning = 04:00–11:59 local time.'
            : part === 'evening'
              ? 'Evening = 17:00–23:59 local time.'
              : 'Points are session averages; lines are daily means.'}
        </span>
      </div>

      <div className="chart-legend" aria-hidden>
        <span className="legend-key">
          <span className="legend-swatch legend-sys" />
          Systolic
        </span>
        <span className="legend-key">
          <span className="legend-swatch legend-dia" />
          Diastolic
        </span>
      </div>

      <div className="grid-half">
        <TrendChart
          title="Last 7 days"
          points={points}
          part={part}
          fromMs={nowMs - 7 * 86_400_000}
          toMs={nowMs}
          tickStepDays={1}
          tz={tz}
        />
        <TrendChart
          title="Last 30 days"
          points={points}
          part={part}
          fromMs={nowMs - 30 * 86_400_000}
          toMs={nowMs}
          tickStepDays={5}
          tz={tz}
        />
      </div>
    </section>
  );
}
