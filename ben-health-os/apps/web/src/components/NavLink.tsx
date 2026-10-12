'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={clsx('whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors', active ? 'bg-accent-soft text-accent font-medium' : 'text-muted hover:bg-surface-2 hover:text-ink')} aria-current={active ? 'page' : undefined}>
      {label}
    </Link>
  );
}
