/**
 * Log redaction: drive login, the OAuth callback, a webhook delivery, a
 * HealthKit batch, and a manual entry through an app whose pino stream is
 * captured — then assert the logs carry no password, no token material, no
 * OAuth code, and no BP payload fields at all (bodies are never logged).
 */

import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeaders, connectWithings, createHarness, postWebhook, type Harness } from './helpers.js';

class CaptureStream extends Writable {
  chunks: string[] = [];
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.chunks.push(chunk.toString('utf8'));
    cb();
  }
  get output(): string {
    return this.chunks.join('');
  }
}

let h: Harness;
let capture: CaptureStream;
let jwt: string;

beforeAll(async () => {
  capture = new CaptureStream();
  h = await createHarness({ loggerStream: capture });
  jwt = h.token;

  // Traffic across every sensitive surface:
  await connectWithings(h); // OAuth callback (?code&state), token exchange + storage
  await postWebhook(h, {
    userid: 'demo-withings-user',
    appli: 4,
    startdate: 1787967430,
    enddate: 1787967573,
  });
  await h.app.inject({
    method: 'POST',
    url: '/api/v1/ingest/healthkit',
    headers: authHeaders(jwt),
    payload: {
      samples: [
        {
          hkUuid: 'redact-1111-4222-8333-444455556666',
          measuredAt: '2026-08-29T08:00:00Z',
          systolic: 222,
          diastolic: 111,
          pulse: 99,
          sourceApp: 'Health Mate',
          sourceDevice: 'BPM Connect',
          sourceBundleId: 'com.withings.wiScaleNG',
        },
      ],
    },
  });
  await h.app.inject({
    method: 'POST',
    url: '/api/v1/bp/manual',
    headers: authHeaders(jwt),
    payload: {
      systolic: 144,
      diastolic: 88,
      pulse: 77,
      measuredAt: '2026-08-29T09:00:00Z',
      note: 'redaction-canary-note',
    },
  });
  // Trigger an auth failure too (error paths must not echo credentials).
  await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: h.config.bootstrapUserEmail, password: 'wrong-canary-password' },
  });
});
afterAll(async () => {
  await h.close();
});

describe('log redaction', () => {
  it('logged something (requests are logged)', () => {
    expect(capture.output).toContain('incoming request');
    expect(capture.output).toContain('/api/v1/bp/manual');
  });

  it('contains no passwords or JWTs', () => {
    const logs = capture.output;
    expect(logs).not.toContain('demo-password');
    expect(logs).not.toContain('wrong-canary-password');
    // The JWT itself (or any recognizable slice of it) never appears.
    expect(logs).not.toContain(jwt);
    expect(logs).not.toContain(jwt.slice(20, 40));
    expect(logs).not.toContain(h.config.authJwtSecret);
  });

  it('contains no OAuth tokens, codes, or states', () => {
    const logs = capture.output;
    expect(logs).not.toContain('fake-access');
    expect(logs).not.toContain('fake-refresh');
    expect(logs).not.toContain('demo-code');
    // Query strings (the callback's ?code=&state=) are stripped wholesale.
    expect(logs).toContain('/api/v1/integrations/withings/callback?[redacted]');
    expect(logs).not.toMatch(/callback\?code=/);
  });

  it('contains no BP payload fields or health values (bodies never logged)', () => {
    const logs = capture.output;
    for (const marker of [
      'systolic',
      'diastolic',
      '"pulse"',
      'redaction-canary-note',
      'measuregrps',
      'redact-1111', // hkUuid
    ]) {
      expect(logs).not.toContain(marker);
    }
  });
});
