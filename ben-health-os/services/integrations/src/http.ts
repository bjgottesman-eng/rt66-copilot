/** Minimal HTTP helper with retry/backoff for 429 and 5xx, honouring Retry-After. Injectable fetch for tests. */
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly body: string, public readonly retryAfterSeconds: number | null = null) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

export interface HttpOptions {
  fetchImpl?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function requestText(url: string, init: RequestInit, opts: HttpOptions = {}): Promise<{ status: number; text: string; headers: Headers }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (attempt < retries) {
        attempt++;
        await sleep(base * 2 ** (attempt - 1));
        continue;
      }
      throw e;
    }
    clearTimeout(timer);
    const text = await res.text();
    if (res.ok) return { status: res.status, text, headers: res.headers };
    const retryAfter = res.headers.get('retry-after');
    const retryAfterSeconds = retryAfter ? Number(retryAfter) || null : null;
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      attempt++;
      await sleep(retryAfterSeconds ? retryAfterSeconds * 1000 : base * 2 ** (attempt - 1));
      continue;
    }
    throw new HttpError(res.status, text, retryAfterSeconds);
  }
}

export async function requestJson<T>(url: string, init: RequestInit, opts: HttpOptions = {}): Promise<T> {
  const { text } = await requestText(url, init, opts);
  return (text ? JSON.parse(text) : {}) as T;
}

export function formBody(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p.toString();
}
