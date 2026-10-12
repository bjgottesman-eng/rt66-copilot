'use client';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ChartPoint {
  minutes: number;
  mgDl: number | null;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

export function GlucoseDayChart({ points, range, meals, workouts }: { points: ChartPoint[]; range: { lowMgDl: number; highMgDl: number }; meals: Array<{ minutes: number; label: string }>; workouts: Array<{ start: number; end: number; label: string }> }) {
  if (points.every((p) => p.mgDl === null)) return <div className="mt-4 flex h-64 items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted" data-testid="glucose-chart">No glucose samples on this day.</div>;
  return (
    <div className="mt-4 h-72 w-full" data-testid="glucose-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="minutes" type="number" domain={[0, 1440]} ticks={[0, 180, 360, 540, 720, 900, 1080, 1260, 1440]} tickFormatter={hhmm} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis domain={['auto', 'auto']} width={44} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} labelFormatter={(m) => hhmm(Number(m))} formatter={(v) => [`${Number(v).toFixed(0)} mg/dL`, 'glucose']} />
          <ReferenceArea y1={range.lowMgDl} y2={range.highMgDl} fill="var(--good)" fillOpacity={0.08} stroke="none" />
          {workouts.map((w, i) => (
            <ReferenceArea key={`w${i}`} x1={w.start} x2={w.end} fill="var(--watch)" fillOpacity={0.14} stroke="none" label={{ value: w.label, position: 'insideTop', fontSize: 10, fill: 'var(--muted)' }} />
          ))}
          {meals.map((m, i) => (
            <ReferenceLine key={`m${i}`} x={m.minutes} stroke="var(--accent)" strokeDasharray="3 3" label={{ value: m.label, position: 'top', fontSize: 10, fill: 'var(--muted)' }} />
          ))}
          <Line type="monotone" dataKey="mgDl" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
