import { createServer, type Server } from 'node:http';

/** Canned Oura + Withings endpoints on one local server (paths do not collide). */
export interface MockState {
  base: string;
  requests: Array<{ method: string; url: string; body: string; headers: Record<string, string | string[] | undefined> }>;
  oura: { refreshToken: string; accessTokens: Set<string>; refreshCount: number; docs: Record<string, Array<Record<string, unknown>>>; subscriptions: Array<Record<string, unknown>> };
  withings: { refreshToken: string; accessToken: string; refreshCount: number; groups: Array<Record<string, unknown>>; subscribeCalls: number };
  close: () => Promise<void>;
}

export async function startMockProviders(): Promise<MockState> {
  const state: MockState = {
    base: '',
    requests: [],
    oura: {
      refreshToken: 'oura-refresh-1',
      accessTokens: new Set(['oura-access-1']),
      refreshCount: 0,
      subscriptions: [],
      docs: {
        sleep: [
          { id: 'sl-1', day: '2026-10-10', type: 'long_sleep', bedtime_start: '2026-10-09T23:05:00-04:00', bedtime_end: '2026-10-10T06:40:00-04:00', total_sleep_duration: 25800, time_in_bed: 27300, efficiency: 94, deep_sleep_duration: 5400, light_sleep_duration: 15000, rem_sleep_duration: 5400, awake_time: 1500, average_hrv: 46, lowest_heart_rate: 50, average_breath: 14.1, sleep_phase_5_min: '422221133', readiness: { score: 84, temperature_deviation: -0.05 } },
          { id: 'sl-2', day: '2026-10-11', type: 'long_sleep', bedtime_start: '2026-10-10T23:30:00-04:00', bedtime_end: '2026-10-11T07:00:00-04:00', total_sleep_duration: 24600, time_in_bed: 27000, efficiency: 91, deep_sleep_duration: 4800, light_sleep_duration: 14400, rem_sleep_duration: 5400, awake_time: 2400, average_hrv: 41, lowest_heart_rate: 53, average_breath: 14.4, sleep_phase_5_min: '4222211333', readiness: { score: 79, temperature_deviation: 0.1 } },
          { id: 'nap-1', day: '2026-10-11', type: 'late_nap', bedtime_start: '2026-10-11T15:00:00-04:00', bedtime_end: '2026-10-11T15:30:00-04:00', total_sleep_duration: 1500, time_in_bed: 1800 },
        ],
        daily_sleep: [{ id: 'ds-1', day: '2026-10-11', timestamp: '2026-10-11T00:00:00-04:00', score: 81 }],
        daily_readiness: [{ id: 'dr-1', day: '2026-10-11', timestamp: '2026-10-11T00:00:00-04:00', score: 79, temperature_deviation: 0.1 }],
        daily_activity: [{ id: 'da-1', day: '2026-10-11', timestamp: '2026-10-11T00:00:00-04:00', score: 74, steps: 9123, active_calories: 455, total_calories: 2610 }],
        daily_spo2: [{ id: 'sp-1', day: '2026-10-11', spo2_percentage: { average: 96.8 } }],
        daily_stress: [{ id: 'st-1', day: '2026-10-11', stress_high: 3600 }],
        vO2_max: [{ id: 'v-1', day: '2026-10-11', timestamp: '2026-10-11T00:00:00-04:00', vo2_max: 44.5 }],
        workout: [{ id: 'w-1', day: '2026-10-11', activity: 'running', start_datetime: '2026-10-11T07:10:00-04:00', end_datetime: '2026-10-11T07:52:00-04:00', calories: 420, distance: 7100, source: 'autodetected' }],
        heartrate: [{ bpm: 58, source: 'awake', timestamp: '2026-10-11T12:00:00+00:00' }, { bpm: 62, source: 'awake', timestamp: '2026-10-11T12:05:00+00:00' }],
      },
    },
    withings: {
      refreshToken: 'w-refresh-1',
      accessToken: 'w-access-1',
      refreshCount: 0,
      subscribeCalls: 0,
      groups: [
        { grpid: 1001, attrib: 5, date: 1791795600, created: 1791795700, modified: 1791795700, category: 1, deviceid: 'dev-1', hash_deviceid: 'hash-1', model: 'BPM Connect', measures: [{ value: 122, type: 10, unit: 0 }, { value: 79, type: 9, unit: 0 }, { value: 60, type: 11, unit: 0 }] },
        { grpid: 1002, attrib: 5, date: 1791795690, created: 1791795800, modified: 1791795800, category: 1, deviceid: 'dev-1', hash_deviceid: 'hash-1', model: 'BPM Connect', measures: [{ value: 119, type: 10, unit: 0 }, { value: 77, type: 9, unit: 0 }, { value: 59, type: 11, unit: 0 }] },
        { grpid: 1003, attrib: 0, date: 1791794400, created: 1791794500, modified: 1791794500, category: 1, deviceid: 'dev-2', hash_deviceid: 'hash-2', model: 'Body+', measures: [{ value: 8120, type: 1, unit: -2 }, { value: 210, type: 6, unit: -1 }] },
      ],
    },
    close: async () => undefined,
  };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.requests.push({ method: req.method!, url: req.url!, body, headers: req.headers });
      const json = (code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const u = new URL(req.url!, 'http://x');
      const form = new URLSearchParams(body);
      const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
      // ---- Oura
      if (u.pathname === '/oauth/token') {
        if (form.get('grant_type') === 'authorization_code') return form.get('code') === 'good' ? json(200, { token_type: 'bearer', access_token: 'oura-access-1', refresh_token: state.oura.refreshToken, expires_in: 86400, scope: 'daily heartrate workout' }) : json(400, { error: 'invalid_grant' });
        if (form.get('grant_type') === 'refresh_token') {
          if (form.get('refresh_token') !== state.oura.refreshToken) return json(401, { error: 'invalid_grant' });
          state.oura.refreshCount++;
          state.oura.refreshToken = `oura-refresh-${state.oura.refreshCount + 1}`;
          const access = `oura-access-${state.oura.refreshCount + 1}`;
          state.oura.accessTokens.add(access);
          return json(200, { token_type: 'bearer', access_token: access, refresh_token: state.oura.refreshToken, expires_in: 86400 });
        }
      }
      if (u.pathname.startsWith('/v2/usercollection/')) {
        if (!state.oura.accessTokens.has(bearer)) return json(401, { detail: 'unauthorized' });
        const rest = u.pathname.replace('/v2/usercollection/', '').split('/');
        const type = rest[0]!;
        if (type === 'personal_info') return json(200, { id: 'oura-user-1', email: 'ben@example.com' });
        const docs = state.oura.docs[type] ?? [];
        if (rest[1]) {
          const d = docs.find((x) => x.id === rest[1]);
          return d ? json(200, d) : json(404, { detail: 'not found' });
        }
        const start = u.searchParams.get('start_date') ?? u.searchParams.get('start_datetime');
        const end = u.searchParams.get('end_date') ?? u.searchParams.get('end_datetime');
        const inRange = docs.filter((d) => {
          const key = String(d.day ?? d.timestamp ?? '');
          return !start || !end || (key.slice(0, 10) >= start.slice(0, 10) && key.slice(0, 10) <= end.slice(0, 10));
        });
        return json(200, { data: inRange, next_token: null });
      }
      if (u.pathname === '/v2/webhook/subscription' && req.method === 'GET') return json(200, state.oura.subscriptions);
      if (u.pathname === '/v2/webhook/subscription' && req.method === 'POST') {
        const sub = { id: `sub-${state.oura.subscriptions.length + 1}`, ...JSON.parse(body), expiration_time: new Date(Date.now() + 90 * 86_400_000).toISOString() };
        state.oura.subscriptions.push(sub);
        return json(201, sub);
      }
      if (u.pathname.startsWith('/v2/webhook/subscription/renew/')) return json(200, { id: 'x', expiration_time: new Date(Date.now() + 90 * 86_400_000).toISOString() });
      // ---- Withings
      if (u.pathname === '/v2/oauth2') {
        if (form.get('grant_type') === 'authorization_code') return form.get('code') === 'good' ? json(200, { status: 0, body: { userid: 777, access_token: state.withings.accessToken, refresh_token: state.withings.refreshToken, expires_in: 10800, scope: 'user.info,user.metrics,user.activity', token_type: 'Bearer' } }) : json(200, { status: 304, error: 'invalid code' });
        if (form.get('grant_type') === 'refresh_token') {
          if (form.get('refresh_token') !== state.withings.refreshToken) return json(200, { status: 342, error: 'invalid refresh token' });
          state.withings.refreshCount++;
          state.withings.refreshToken = `w-refresh-${state.withings.refreshCount + 1}`;
          state.withings.accessToken = `w-access-${state.withings.refreshCount + 1}`;
          return json(200, { status: 0, body: { userid: 777, access_token: state.withings.accessToken, refresh_token: state.withings.refreshToken, expires_in: 10800 } });
        }
      }
      if (u.pathname === '/measure') {
        if (bearer !== state.withings.accessToken) return json(200, { status: 401, error: 'invalid token' });
        const lastupdate = form.get('lastupdate');
        const startdate = form.get('startdate');
        const enddate = form.get('enddate');
        let groups = state.withings.groups;
        if (lastupdate) groups = groups.filter((g) => Number(g.modified) > Number(lastupdate));
        if (startdate) groups = groups.filter((g) => Number(g.date) >= Number(startdate));
        if (enddate) groups = groups.filter((g) => Number(g.date) <= Number(enddate));
        return json(200, { status: 0, body: { updatetime: 1791800000, timezone: 'America/New_York', measuregrps: groups, more: 0, offset: 0 } });
      }
      if (u.pathname === '/v2/user') return json(200, { status: 0, body: { devices: [{ type: 'Blood Pressure Monitor', model: 'BPM Connect', model_id: 45, battery: 'high', deviceid: 'dev-1', hash_deviceid: 'hash-1', timezone: 'America/New_York', last_session_date: 1791795690 }] } });
      if (u.pathname === '/notify') {
        if (form.get('action') === 'subscribe') state.withings.subscribeCalls++;
        return json(200, { status: 0, body: form.get('action') === 'list' ? { profiles: [] } : {} });
      }
      json(404, { error: `no mock for ${req.method} ${u.pathname}` });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  state.base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  state.close = () => new Promise<void>((r) => server.close(() => r()));
  return state;
}
