import { NextResponse } from 'next/server';
import { API_BASE_URL, AUTH_MODE, SESSION_COOKIE } from '@/lib/config';

/** Local-mode login: exchanges an email for a dev token at the API and stores it in an httpOnly cookie. */
export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { email?: string; accessToken?: string; expiresAt?: string };
  let token: string | undefined;
  let expiresAt: string | undefined;
  if (AUTH_MODE === 'local') {
    if (!body.email) return NextResponse.json({ error: 'email required' }, { status: 400 });
    const res = await fetch(`${API_BASE_URL}/v1/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: body.email }) });
    if (!res.ok) return NextResponse.json({ error: 'login failed', detail: await res.text() }, { status: 502 });
    const data = (await res.json()) as { accessToken: string; expiresAt: string };
    token = data.accessToken;
    expiresAt = data.expiresAt;
  } else {
    // Supabase mode: the browser signs in with Supabase Auth and hands the access token here.
    token = body.accessToken;
    expiresAt = body.expiresAt;
    if (!token) return NextResponse.json({ error: 'accessToken required' }, { status: 400 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires: expiresAt ? new Date(expiresAt) : undefined });
  return response;
}

export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', expires: new Date(0) });
  return response;
}
