'use client';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function DomainChart({ daily, unit, precision }: { daily: Array<{ date: string; value: number | null }>; unit: string; precision: number }) {
  if (!daily.some((d) => d.value !== null)) return null;
  return (
    <div className="mt-3 h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d: string) => d.slice(5)} minTickGap={32} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} width={44} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(precision)} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${Number(v).toFixed(precision)} ${unit}`, 'daily']} />
          <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
