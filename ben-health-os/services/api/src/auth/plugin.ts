import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AppConfig } from '../config.js';
import { withService, withUser } from '../db/pool.js';
import { AuthError, type AuthenticatedUser, type TokenVerifier } from './jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string;
  time_zone: string;
  demo_mode: boolean;
  ai_sharing: { enabled: boolean; excludedConnectors: string[] };
  created_at: string;
  birth_date: Date | string | null;
  max_heart_rate: number | null;
  glucose_range: { lowMgDl: number; highMgDl: number; source?: string } | null;
  nutrition_targets: Record<string, unknown> | null;
}

/** Ensures auth.users (local mode only) and profiles rows exist for a verified user. */
export async function ensureProfile(pool: pg.Pool, cfg: AppConfig, user: AuthenticatedUser): Promise<ProfileRow> {
  if (cfg.AUTH_MODE === 'local') {
    await withService(pool, async (tx) => {
      await tx.query('insert into auth.users (id, email) values ($1, $2) on conflict (id) do update set email = coalesce(excluded.email, auth.users.email)', [user.userId, user.email]);
    });
  }
  return withUser(pool, user.userId, async (tx) => {
    const existing = await tx.query<ProfileRow>('select id, email, display_name, time_zone, demo_mode, ai_sharing, created_at, birth_date, max_heart_rate, glucose_range, nutrition_targets from public.profiles where id = $1', [user.userId]);
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await tx.query<ProfileRow>(
      'insert into public.profiles (id, email) values ($1, $2) on conflict (id) do update set email = coalesce(excluded.email, public.profiles.email) returning id, email, display_name, time_zone, demo_mode, ai_sharing, created_at, birth_date, max_heart_rate, glucose_range, nutrition_targets',
      [user.userId, user.email],
    );
    return inserted.rows[0]!;
  });
}

export function registerAuth(app: FastifyInstance, verifier: TokenVerifier): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      request.user = null;
      return;
    }
    try {
      request.user = await verifier.verify(header.slice('Bearer '.length).trim());
    } catch (e) {
      if (e instanceof AuthError) {
        request.user = null;
        (request as FastifyRequest & { authError?: string }).authError = e.message;
        return;
      }
      throw e;
    }
  });
}

export function requireUser(request: FastifyRequest, reply: FastifyReply): AuthenticatedUser | null {
  if (!request.user) {
    const detail = (request as FastifyRequest & { authError?: string }).authError;
    void reply.code(401).send({ error: 'unauthorized', message: detail ?? 'missing bearer token' });
    return null;
  }
  return request.user;
}
