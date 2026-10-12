import type { MeResponse } from '@bho/contracts';
import { NavLink } from './NavLink';
import { ThemeToggle } from './ThemeToggle';
import { SignOutButton } from './SignOutButton';

const NAV = [
  ['/today', 'Today'],
  ['/trends', 'Trends'],
  ['/health-ceo', 'Health CEO'],
  ['/inbox', 'Inbox'],
  ['/labs', 'Labs'],
  ['/training', 'Training'],
  ['/nutrition', 'Nutrition'],
  ['/experiments', 'Experiments'],
  ['/medications', 'Medications'],
  ['/preventive', 'Preventive'],
  ['/physician-brief', 'Physician brief'],
  ['/sources', 'Data Sources'],
  ['/settings', 'Settings'],
] as const;

export function AppShell({ me, children }: { me: MeResponse; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
      <aside className="border-b border-line bg-surface md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Ben Health OS</p>
            <p className="mt-1 text-sm text-muted">{me.displayName}</p>
          </div>
          <div className="flex items-center gap-2 md:mt-3">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3 md:pb-6" aria-label="Primary">
          {NAV.map(([href, label]) => (
            <NavLink key={href} href={href} label={label} />
          ))}
        </nav>
        {me.demoMode && <div className="mx-3 mb-4 hidden rounded-lg bg-watch/15 px-3 py-2 text-xs text-watch md:block">Demo mode: synthetic data only.</div>}
      </aside>
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
