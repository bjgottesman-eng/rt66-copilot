import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';
import { isDemo } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Ben Health OS', template: '%s — Ben Health OS' },
  description: 'Private, source-aware personal health dashboard',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const authed = (await cookies()).has('bh_token');
  return (
    <html lang="en">
      <body>
        {isDemo() ? <div className="demo-banner">Demo data (synthetic persona)</div> : null}
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="brand">
              Ben Health OS
            </Link>
            {authed ? (
              <>
                <nav className="site-nav" aria-label="Primary">
                  <Link href="/">Blood pressure</Link>
                  <Link href="/sources">Sources</Link>
                </nav>
                <LogoutButton />
              </>
            ) : null}
          </div>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
