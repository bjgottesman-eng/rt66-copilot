/**
 * Server-component data access: fetches the platform API directly (no hop
 * through /api/platform) with the JWT from the httpOnly cookie. Returns a
 * Result union instead of throwing so pages can distinguish "session
 * expired" (redirect to /login) from "platform unreachable" (error panel)
 * without try/catch gymnastics around Next's control-flow errors.
 */

import { cookies } from 'next/headers';
import { platformUrl } from './env';

export type PlatformResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'unauthorized' | 'unreachable' | 'error'; status: number; message: string };

export async function platformGet<T>(path: string): Promise<PlatformResult<T>> {
  const token = (await cookies()).get('bh_token')?.value;
  if (token === undefined || token === '') {
    return { ok: false, kind: 'unauthorized', status: 401, message: 'not signed in' };
  }

  let res: Response;
  try {
    res = await fetch(`${platformUrl()}/api/v1${path}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      kind: 'unreachable',
      status: 502,
      message: 'platform service is unreachable',
    };
  }

  if (res.status === 401) {
    return { ok: false, kind: 'unauthorized', status: 401, message: 'session expired' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    return {
      ok: false,
      kind: 'error',
      status: res.status,
      message: body?.error?.message ?? `request failed (${res.status})`,
    };
  }
  return { ok: true, data: (await res.json()) as T };
}
