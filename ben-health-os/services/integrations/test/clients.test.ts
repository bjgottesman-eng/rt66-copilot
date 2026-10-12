import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { OuraClient, WithingsApiError, WithingsClient, HttpError, requestJson } from '../src/index.js';

let server: Server;
let base: string;
const seen: Array<{ method: string; url: string; body: string; auth: string | undefined }> = [];
let ouraRefresh = 'oura-refresh-1';
let withingsRefresh = 'w-refresh-1';
let failuresLeft = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, body, auth: req.headers.authorization });
      const json = (code: number, obj: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(code, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(obj));
      };
      const form = new URLSearchParams(body);
      if (req.url === '/oauth/token') {
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good') return json(200, { token_type: 'bearer', access_token: 'oura-access-1', refresh_token: ouraRefresh, expires_in: 86400 });
        if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === ouraRefresh) {
          ouraRefresh = `oura-refresh-${Date.now()}`;
          return json(200, { token_type: 'bearer', access_token: 'oura-access-2', refresh_token: ouraRefresh, expires_in: 86400 });
        }
        return json(401, { error: 'invalid_grant' });
      }
      if (req.url!.startsWith('/v2/usercollection/sleep')) {
        const u = new URL(req.url!, 'http://x');
        if (u.searchParams.get('next_token') === 'p2') return json(200, { data: [{ id: 'b' }], next_token: null });
        return json(200, { data: [{ id: 'a' }], next_token: 'p2' });
      }
      if (req.url!.startsWith('/v2/usercollection/flaky')) {
        if (failuresLeft > 0) {
          failuresLeft--;
          return json(429, { detail: 'slow down' }, { 'retry-after': '0' });
        }
        return json(200, { data: [{ id: 'ok' }], next_token: null });
      }
      if (req.url === '/v2/oauth2') {
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good') return json(200, { status: 0, body: { userid: 777, access_token: 'w-access-1', refresh_token: withingsRefresh, expires_in: 10800, scope: 'user.metrics' } });
        if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === withingsRefresh) {
          withingsRefresh = `w-refresh-${Date.now()}`;
          return json(200, { status: 0, body: { userid: 777, access_token: 'w-access-2', refresh_token: withingsRefresh, expires_in: 10800 } });
        }
        return json(200, { status: 342, error: 'invalid refresh token' });
      }
      if (req.url === '/measure') {
        if (req.headers.authorization !== 'Bearer w-access-1') return json(200, { status: 401, error: 'invalid token' });
        const offset = form.get('offset');
        if (!offset) return json(200, { status: 0, body: { updatetime: 1791800000, timezone: 'America/New_York', measuregrps: [{ grpid: 1, attrib: 0, date: 1791795600, created: 1, modified: 1, category: 1, deviceid: 'd', hash_deviceid: 'h', model: 'BPM Connect', measures: [{ value: 120, type: 10, unit: 0 }, { value: 80, type: 9, unit: 0 }] }], more: 1, offset: 1 } });
        return json(200, { status: 0, body: { updatetime: 1791800000, timezone: 'America/New_York', measuregrps: [{ grpid: 2, attrib: 0, date: 1791795660, created: 1, modified: 1, category: 1, deviceid: 'd', hash_deviceid: 'h', model: 'BPM Connect', measures: [{ value: 8000, type: 1, unit: -2 }] }], more: 0, offset: 0 } });
      }
      if (req.url === '/notify') return json(200, { status: 0, body: {} });
      json(404, { error: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('OuraClient', () => {
  it('builds the authorize URL with PKCE and exchanges/refreshes tokens (single-use refresh)', async () => {
    const c = new OuraClient({ clientId: 'id', clientSecret: 'sec', redirectUri: 'https://app/cb', apiBase: base, authBase: base });
    const url = new URL(c.authorizeUrl({ state: 's', codeChallenge: 'ch' }));
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('daily');
    const t = await c.exchangeCode('good', 'verifier');
    expect(t.accessToken).toBe('oura-access-1');
    const first = t.refreshToken!;
    const r = await c.refresh(first);
    expect(r.accessToken).toBe('oura-access-2');
    expect(r.refreshToken).not.toBe(first);
    await expect(c.refresh(first)).rejects.toBeInstanceOf(HttpError);
  });
  it('follows next_token pagination and retries on 429 with Retry-After', async () => {
    const c = new OuraClient({ clientId: 'id', clientSecret: 'sec', redirectUri: 'https://app/cb', apiBase: base, authBase: base }, { sleep: async () => undefined });
    const docs = await c.listDocuments('tok', 'sleep', { start: '2026-10-01', end: '2026-10-11' });
    expect(docs.map((d) => d.id)).toEqual(['a', 'b']);
    failuresLeft = 2;
    const flaky = await c.listDocuments('tok', 'flaky' as never, { start: '2026-10-01', end: '2026-10-11' });
    expect(flaky.map((d) => d.id)).toEqual(['ok']);
    failuresLeft = 10;
    await expect(requestJson(`${base}/v2/usercollection/flaky`, {}, { retries: 1, sleep: async () => undefined })).rejects.toMatchObject({ status: 429 });
    failuresLeft = 0;
  });
});

describe('WithingsClient', () => {
  it('exchanges codes, rotates refresh tokens and surfaces status envelopes as errors', async () => {
    const c = new WithingsClient({ clientId: 'id', clientSecret: 'sec', redirectUri: 'https://app/cb', apiBase: base, accountBase: base });
    expect(new URL(c.authorizeUrl({ state: 'st' })).searchParams.get('scope')).toBe('user.info,user.metrics,user.activity');
    const t = await c.exchangeCode('good');
    expect(t.externalUserId).toBe('777');
    const first = t.refreshToken!;
    const r = await c.refresh(first);
    expect(r.accessToken).toBe('w-access-2');
    await expect(c.refresh(first)).rejects.toSatisfy((e: unknown) => e instanceof WithingsApiError && e.isAuthError);
  });
  it('pages getmeas via more/offset and keeps updatetime', async () => {
    const c = new WithingsClient({ clientId: 'id', clientSecret: 'sec', redirectUri: 'https://app/cb', apiBase: base, accountBase: base });
    const res = await c.getMeasures('w-access-1', { lastupdate: 0 });
    expect(res.groups.map((g) => g.grpid)).toEqual([1, 2]);
    expect(res.updatetime).toBe(1791800000);
    const calls = seen.filter((s) => s.url === '/measure');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(new URLSearchParams(calls[calls.length - 1]!.body).get('offset')).toBe('1');
    await expect(c.getMeasures('bad', {})).rejects.toSatisfy((e: unknown) => e instanceof WithingsApiError && e.isAuthError);
  });
});
