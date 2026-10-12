'use client';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Point = { date: string; value: number | null; phase: 'BASELINE' | 'INTERVENTION' | 'WASHOUT' | null };
const FILL: Record<string, string> = { BASELINE: 'var(--chip)', INTERVENTION: 'var(--accent-soft)', WASHOUT: 'var(--line)' };

export function ExperimentChart({ daily, unit }: { daily: Point[]; unit: string }) {
  if (!daily.some((d) => d.value !== null)) return <p className="mt-2 text-xs text-muted">No outcome values in the experiment window yet.</p>;
  // Contiguous phase bands
  const bands: Array<{ from: string; to: string; phase: string }> = [];
  for (const d of daily) {
    if (!d.phase) continue;
    const last = bands[bands.length - 1];
    if (last && last.phase === d.phase) last.to = d.date;
    else bands.push({ from: d.date, to: d.date, phase: d.phase });
  }
  return (
    <div className="mt-3 h-44 w-full" data-testid="experiment-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          {bands.map((b) => <ReferenceArea key={`${b.phase}-${b.from}`} x1={b.from} x2={b.to} fill={FILL[b.phase] ?? 'transparent'} fillOpacity={0.6} strokeOpacity={0} label={{ value: b.phase.toLowerCase(), position: 'insideTop', fontSize: 10, fill: 'var(--muted)' }} />)}
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(d: string) => d.slice(5)} minTickGap={28} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} width={40} domain={['auto', 'auto']} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${Number(v).toLocaleString()} ${unit}`, 'daily']} />
          <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={1.5} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
