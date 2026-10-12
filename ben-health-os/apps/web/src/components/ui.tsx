import clsx from 'clsx';

type Tone = 'good' | 'watch' | 'attention' | 'neutral';
const toneClass: Record<Tone, string> = {
  good: 'bg-good/15 text-good',
  watch: 'bg-watch/15 text-watch',
  attention: 'bg-attention/15 text-attention',
  neutral: 'bg-chip text-muted',
};

export function Chip({ tone = 'neutral', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide', toneClass[tone])}>
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={clsx('rounded-2xl border border-line bg-surface p-5', className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </Card>
  );
}

export function Sparkline({ points, tone = 'neutral', width = 120, height = 32 }: { points: Array<{ date: string; value: number | null }>; tone?: Tone; width?: number; height?: number }) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length < 2) return <svg width={width} height={height} aria-hidden className="opacity-40"><line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeDasharray="2 3" /></svg>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const stepX = width / Math.max(1, points.length - 1);
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
      return;
    }
    const x = i * stepX;
    const y = height - 3 - ((p.value - min) / span) * (height - 6);
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(' '));
  const color = tone === 'good' ? 'var(--good)' : tone === 'watch' ? 'var(--watch)' : tone === 'attention' ? 'var(--attention)' : 'var(--accent)';
  return (
    <svg width={width} height={height} aria-hidden>
      {segments.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export function NotImplemented({ title, phase, body }: { title: string; phase: number; body: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={`Planned for Phase ${phase}`} />
      <Card>
        <Chip tone="neutral">Not implemented</Chip>
        <p className="mt-3 text-sm text-muted">{body}</p>
        <p className="mt-3 text-xs text-muted">This screen is intentionally honest: nothing here is simulated. See docs/roadmap.md for the phase plan.</p>
      </Card>
    </>
  );
}
