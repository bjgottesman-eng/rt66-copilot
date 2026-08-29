/**
 * Route-level auth gate (Next 16 proxy — the middleware.ts successor).
 *
 * Checks COOKIE PRESENCE ONLY: unauthenticated visitors are redirected to
 * /login; visitors with a bh_token cookie are let through. The platform
 * service verifies the JWT itself on every proxied call, so a forged or
 * expired cookie still yields 401s (mapped to a session-expired redirect by
 * the /api/platform handler and the server pages).
 */

import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'bh_token';

export default function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const authed = request.cookies.has(SESSION_COOKIE);
  const isLogin = pathname === '/login' || pathname.startsWith('/login/');

  if (!authed && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (authed && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: API routes handle auth themselves (401 JSON, not a redirect),
  // and _next assets / files with extensions are public.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
