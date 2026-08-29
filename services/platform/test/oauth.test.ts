/**
 * Full OAuth connect flow against WithingsFake: state persisted + validated
 * (wrong state 403, single-use, expiring), tokens stored ENCRYPTED, userid
 * persisted, appli=4 subscription, and the connect-time historical backfill.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptToken } from '../src/crypto.js';
import { adminCount, authHeaders, createHarness, type Harness } from './helpers.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('Withings OAuth connect flow', () => {
  it('rejects an unknown state with 403 and no side effects', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/integrations/withings/callback?code=x&state=bogus-state',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'INVALID_STATE', message: expect.any(String) },
    });
    expect(await adminCount(h, 'select count(*) as n from oauth_token')).toBe(0);
  });

  it('connect returns the authorize URL with a server-persisted state nonce', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/connect',
      headers: authHeaders(h.token),
    });
    expect(res.statusCode).toBe(200);
    const { authorizeUrl } = res.json() as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('user.metrics');
    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();

    const stored = await h.admin.query<{ state: string }>(
      `select metadata->'oauthState'->>'value' as state from source_connection
        where provider = 'withings'`,
    );
    expect(stored.rows[0]?.state).toBe(state);
  });

  it('rejects an expired state (10-minute TTL)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/connect',
      headers: authHeaders(h.token),
    });
    const state = new URL((res.json() as { authorizeUrl: string }).authorizeUrl).searchParams.get(
      'state',
    )!;
    await h.admin.query(
      `update source_connection
          set metadata = jsonb_set(metadata, '{oauthState,expiresAt}', to_jsonb($1::text))
        where provider = 'withings'`,
      [new Date(Date.now() - 1000).toISOString()],
    );
    const cb = await h.app.inject({
      method: 'GET',
      url: `/api/v1/integrations/withings/callback?code=demo-code&state=${state}`,
    });
    expect(cb.statusCode).toBe(403);
  });

  it('completes the callback: encrypted tokens, userid, subscription, backfill', async () => {
    const connect = await h.app.inject({
      method: 'POST',
      url: '/api/v1/sources/withings/connect',
      headers: authHeaders(h.token),
    });
    const state = new URL(
      (connect.json() as { authorizeUrl: string }).authorizeUrl,
    ).searchParams.get('state')!;
    const cb = await h.app.inject({
      method: 'GET',
      url: `/api/v1/integrations/withings/callback?code=demo-code&state=${state}`,
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain('http://localhost:3000');

    // Connection state + persisted Withings userid.
    const conn = await h.admin.query<{ status: string; external_user_id: string }>(
      `select status, external_user_id from source_connection where provider = 'withings'`,
    );
    expect(conn.rows[0]).toEqual({ status: 'connected', external_user_id: 'demo-withings-user' });

    // Tokens at rest: bytea is NOT plaintext, and decrypts with TOKEN_ENC_KEY.
    const tokens = await h.admin.query<{ access: Buffer; refresh: Buffer }>(
      'select access_token_enc as access, refresh_token_enc as refresh from oauth_token',
    );
    expect(tokens.rows).toHaveLength(1);
    const { access, refresh } = tokens.rows[0]!;
    for (const enc of [access, refresh]) {
      expect(enc.toString('utf8')).not.toContain('fake-');
      expect(enc.toString('latin1')).not.toContain('fake-');
    }
    expect(decryptToken(h.config.tokenEncKey, access)).toBe('fake-access-1');
    expect(decryptToken(h.config.tokenEncKey, refresh)).toBe('fake-refresh-1');

    // appli=4 subscription against the configured webhook URL.
    expect(h.fake.subscriptions).toEqual([
      { callbackUrl: h.config.withings.webhookUrl, appli: 4 },
    ]);

    // Historical backfill imported the full fixture history.
    expect(
      await adminCount(
        h,
        `select count(*) as n from blood_pressure_reading where source = 'withings_api'`,
      ),
    ).toBe(427);

    // State is single-use: replaying the callback fails.
    const replay = await h.app.inject({
      method: 'GET',
      url: `/api/v1/integrations/withings/callback?code=demo-code&state=${state}`,
    });
    expect(replay.statusCode).toBe(403);
  });
});
