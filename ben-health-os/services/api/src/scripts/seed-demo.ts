/**
 * Seeds the synthetic demo dataset for a local-mode user without going through HTTP.
 * Usage: DATABASE_URL=... pnpm --filter @bho/api seed:demo [email]
 */
import { buildApp } from '../app.js';

const email = process.argv[2] ?? 'ben@example.com';
const app = await buildApp({ AUTH_MODE: 'local' });
const login = await app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload: { email } });
if (login.statusCode !== 200) throw new Error(`dev-login failed: ${login.body}`);
const { accessToken } = login.json() as { accessToken: string };
const seed = await app.inject({ method: 'POST', url: '/v1/demo/seed', headers: { authorization: `Bearer ${accessToken}` }, payload: { replace: true } });
console.log(seed.statusCode, seed.body.slice(0, 600));
await app.close();
