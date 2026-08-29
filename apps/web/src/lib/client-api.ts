/**
 * Client-side API access — always via the same-origin /api/platform proxy
 * (the JWT lives in an httpOnly cookie; client JS never sees it). A 401
 * (SESSION_EXPIRED from the proxy) sends the browser back to /login.
 */

export class ApiRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    `/api/platform${path}`,
    body === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  if (res.status === 401) {
    window.location.assign('/login?expired=1');
    throw new ApiRequestError(401, 'session expired');
  }
  const json = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok) {
    throw new ApiRequestError(res.status, json?.error?.message ?? `request failed (${res.status})`);
  }
  return json as T;
}
