'use client';
import type { SeriesResponse } from '@bho/contracts';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ComposedChart } from 'recharts';

export function TrendChart({ series, unit, precision }: { series: SeriesResponse; unit: string; precision: number }) {
  const daily = series.daily.map((d) => ({ date: d.date, value: d.value }));
  const raw = series.points.map((p) => ({ t: p.t, date: p.localDate, raw: p.value, canonical: p.canonical }));
  const hasData = daily.some((d) => d.value !== null);
  if (!hasData) return <div className="mt-6 flex h-64 items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">No observations in this window.</div>;
  return (
    <div className="mt-4 h-72 w-full" data-testid="trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={48} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(precision)} />
          <Tooltip
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [`${Number(v).toFixed(precision)} ${unit}`, 'daily']}
          />
          <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          {raw.length <= 600 && (
            <Scatter data={raw.filter((r) => r.canonical)} dataKey="raw" fill="var(--accent)" opacity={0.35} isAnimationActive={false} />
          )}
          {raw.length <= 600 && <Scatter data={raw.filter((r) => !r.canonical)} dataKey="raw" fill="transparent" stroke="var(--muted)" isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
      {/* LineChart import kept for type parity with recharts 3 tree-shaking */}
      <span className="hidden">{LineChart.name}</span>
    </div>
  );
}
