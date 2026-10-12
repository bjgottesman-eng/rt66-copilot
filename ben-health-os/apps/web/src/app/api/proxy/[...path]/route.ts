import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API_BASE_URL, SESSION_COOKIE } from '@/lib/config';

/** Forwards browser requests to the API with the httpOnly session token. Only /v1/* paths are allowed. */
async function forward(req: Request, params: Promise<{ path: string[] }>): Promise<NextResponse> {
  const { path } = await params;
  if (!path?.length || path[0] !== 'v1') return NextResponse.json({ error: 'not allowed' }, { status: 404 });
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const target = `${API_BASE_URL}/${path.join('/')}${url.search}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  const res = await fetch(target, { method: req.method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body, cache: 'no-store' });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', ...(res.headers.get('content-disposition') ? { 'content-disposition': res.headers.get('content-disposition')! } : {}) } });
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function PATCH(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
export async function DELETE(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, ctx.params);
}
