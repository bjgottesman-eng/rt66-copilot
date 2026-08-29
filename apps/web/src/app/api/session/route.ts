/**
 * Session management. POST logs in against the platform's /api/v1/auth/login
 * and stores the JWT in an httpOnly cookie; DELETE clears it. The token is
 * NEVER returned to client JS — only the user object is echoed back.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { platformUrl } from '@/lib/env';

const SESSION_COOKIE = 'bh_token';
/** Matches the platform JWT expiry (24 h). */
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

function cookieOptions() {
  return {
    httpOnly: true,
    // Secure everywhere except plain-http local dev, where browsers such as
    // Safari (and curl) drop Secure cookies. Any deployed environment is
    // HTTPS and gets the Secure flag.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'body must be JSON' } },
      { status: 400 },
    );
  }
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'email and password are required' } },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${platformUrl()}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'PLATFORM_UNREACHABLE', message: 'platform service is unreachable' } },
      { status: 502 },
    );
  }

  const payload = (await upstream.json().catch(() => null)) as {
    token?: string;
    user?: { id: string; email: string };
    error?: { code: string; message: string };
  } | null;

  if (!upstream.ok || payload === null || typeof payload.token !== 'string') {
    return NextResponse.json(
      {
        error: payload?.error ?? { code: 'LOGIN_FAILED', message: 'login failed' },
      },
      { status: upstream.ok ? 502 : upstream.status },
    );
  }

  const response = NextResponse.json({ user: payload.user ?? null });
  response.cookies.set(SESSION_COOKIE, payload.token, {
    ...cookieOptions(),
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
  return response;
}
