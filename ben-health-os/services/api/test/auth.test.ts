import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { login, testApp, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await testApp();
});
afterAll(async () => {
  await app.close();
});

describe('auth', () => {
  it('health endpoint pings the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
  it('rejects requests without a token and with a bad token', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });
  it('dev-login creates a user and /v1/me returns the profile', async () => {
    const email = uniqueEmail('auth');
    const { auth, userId } = await login(app, email);
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ userId, email, authMode: 'local', demoMode: false });
    const again = await login(app, email);
    expect(again.userId).toBe(userId);
  });
  it('profile updates validate the time zone and ai sharing defaults exclude Oura', async () => {
    const { auth } = await login(app, uniqueEmail('profile'));
    expect((await app.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { timeZone: 'Mars/Olympus' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { timeZone: 'Europe/Paris', displayName: 'B' } })).statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    expect(me.json()).toMatchObject({ timeZone: 'Europe/Paris', displayName: 'B' });
    const exported = await app.inject({ method: 'GET', url: '/v1/me/export', headers: auth });
    expect(exported.json().profile.ai_sharing).toEqual({ enabled: false, excludedConnectors: ['oura'] });
  });
});
