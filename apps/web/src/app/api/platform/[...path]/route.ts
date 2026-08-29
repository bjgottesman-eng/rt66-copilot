/**
 * Authenticated proxy to the platform API: forwards GET/POST to
 * PLATFORM_URL/api/v1/<path> with the JWT from the httpOnly cookie as a
 * Bearer header, and streams the JSON response back. An upstream 401 is
 * mapped to a session-expired signal (401 + SESSION_EXPIRED + cookie
 * cleared) that client code turns into a /login redirect.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { platformUrl } from '@/lib/env';

const SESSION_COOKIE = 'bh_token';
/** Path segments the proxy will forward (no slashes, dots-only tricks, etc.). */
const SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;

type RouteContext = { params: Promise<{ path: string[] }> };

function sessionExpired(): NextResponse {
  const response = NextResponse.json(
    { error: { code: 'SESSION_EXPIRED', message: 'session expired — sign in again' } },
    { status: 401 },
  );
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

async function forward(
  request: NextRequest,
  context: RouteContext,
  method: 'GET' | 'POST',
): Promise<NextResponse> {
  const { path } = await context.params;
  if (path.length === 0 || !path.every((segment) => SEGMENT_RE.test(segment))) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid path' } },
      { status: 400 },
    );
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === '') return sessionExpired();

  const url = new URL(`${platformUrl()}/api/v1/${path.join('/')}`);
  url.search = request.nextUrl.search;

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (method === 'POST') {
    // Forward the content-type only alongside a non-empty body — Fastify
    // (correctly) rejects "application/json" with an empty body.
    const text = await request.text();
    if (text !== '') {
      body = text;
      headers['content-type'] = request.headers.get('content-type') ?? 'application/json';
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { method, headers, body, cache: 'no-store' });
  } catch {
    return NextResponse.json(
      { error: { code: 'PLATFORM_UNREACHABLE', message: 'platform service is unreachable' } },
      { status: 502 },
    );
  }

  if (upstream.status === 401) return sessionExpired();

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return forward(request, context, 'GET');
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return forward(request, context, 'POST');
}
