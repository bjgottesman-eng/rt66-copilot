/** POST /auth/login (public, rate-limited) and GET /auth/me (authenticated). */

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError, badRequest } from '../errors.js';

export function registerPublicAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const body = req.body as { email?: unknown; password?: unknown } | null;
      if (
        body === null ||
        typeof body !== 'object' ||
        typeof body.email !== 'string' ||
        typeof body.password !== 'string'
      ) {
        throw badRequest('email and password are required');
      }
      const result = await ctx.auth.login(body.email, body.password);
      if (result === null) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'email or password is incorrect');
      }
      return { token: result.token, user: result.user };
    },
  );
}

export function registerAuthRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get('/auth/me', async (req) => ({ id: req.userId, email: req.userEmail }));
}
