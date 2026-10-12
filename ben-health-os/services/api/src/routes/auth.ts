import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { DevLoginRequestSchema, ProfileUpdateSchema, type MeResponse } from '@bho/contracts';
import { isValidTimeZone } from '@bho/analytics';
import type { AppContext } from '../app.js';
import { ensureProfile, requireUser } from '../auth/plugin.js';
import { localVerifier } from '../auth/jwt.js';
import { withService, withUser } from '../db/pool.js';

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  if (ctx.config.AUTH_MODE === 'local') {
    const local = localVerifier(ctx.config);
    // Development-only login: creates (or finds) a local user by email and returns a signed token.
    app.post('/v1/auth/dev-login', async (request, reply) => {
      const body = DevLoginRequestSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid body', details: body.error.issues });
      const email = body.data.email.toLowerCase();
      const userId = await withService(ctx.pool, async (tx) => {
        const found = await tx.query<{ id: string }>('select id from auth.users where email = $1', [email]);
        if (found.rows[0]) return found.rows[0].id;
        const id = randomUUID();
        await tx.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
        return id;
      });
      const profile = await ensureProfile(ctx.pool, ctx.config, { userId, email, claims: {} });
      if (body.data.displayName && body.data.displayName !== profile.display_name) {
        await withUser(ctx.pool, userId, (tx) => tx.query('update public.profiles set display_name = $2 where id = $1', [userId, body.data.displayName]));
      }
      const { token, expiresAt } = await local.sign(userId, email);
      return { accessToken: token, expiresAt, userId };
    });
  }

  app.get('/v1/me', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const profile = await ensureProfile(ctx.pool, ctx.config, user);
    const res: MeResponse = {
      userId: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      timeZone: profile.time_zone,
      demoMode: profile.demo_mode,
      authMode: ctx.config.AUTH_MODE,
      createdAt: profile.created_at ? new Date(profile.created_at).toISOString() : null,
    };
    return res;
  });

  app.patch('/v1/me', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = ProfileUpdateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'invalid body', details: body.error.issues });
    if (body.data.timeZone && !isValidTimeZone(body.data.timeZone)) return reply.code(400).send({ error: 'bad_request', message: 'unknown time zone' });
    await ensureProfile(ctx.pool, ctx.config, user);
    await withUser(ctx.pool, user.userId, async (tx) => {
      if (body.data.displayName) await tx.query('update public.profiles set display_name = $2 where id = $1', [user.userId, body.data.displayName]);
      if (body.data.timeZone) await tx.query('update public.profiles set time_zone = $2 where id = $1', [user.userId, body.data.timeZone]);
      if (body.data.aiSharing) {
        await tx.query(`update public.profiles set ai_sharing = ai_sharing || $2::jsonb where id = $1`, [user.userId, JSON.stringify(body.data.aiSharing)]);
      }
    });
    return reply.code(204).send();
  });
}
