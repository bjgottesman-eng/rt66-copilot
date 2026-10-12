import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AppConfig } from '../config.js';

export interface AuthenticatedUser {
  userId: string;
  email: string | null;
  claims: JWTPayload;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthenticatedUser>;
}

function toUser(payload: JWTPayload): AuthenticatedUser {
  if (!payload.sub) throw new AuthError('token has no subject');
  const email = typeof payload.email === 'string' ? payload.email : null;
  return { userId: payload.sub, email, claims: payload };
}

/** Local development verifier: HS256 with LOCAL_JWT_SECRET. Never used in production. */
export function localVerifier(cfg: AppConfig): TokenVerifier & { sign(userId: string, email: string | null, ttlSeconds?: number): Promise<{ token: string; expiresAt: string }> } {
  const key = new TextEncoder().encode(cfg.LOCAL_JWT_SECRET);
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: 'ben-health-os-local' });
        return toUser(payload);
      } catch (e) {
        throw new AuthError(`invalid token: ${(e as Error).message}`);
      }
    },
    async sign(userId, email, ttlSeconds = 60 * 60 * 24 * 30) {
      const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
      const token = await new SignJWT({ email: email ?? undefined, role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('ben-health-os-local')
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(key);
      return { token, expiresAt: new Date(exp * 1000).toISOString() };
    },
  };
}

/**
 * Supabase Auth verifier. Preferred: asymmetric keys via the project's JWKS endpoint
 * (https://<project>.supabase.co/auth/v1/.well-known/jwks.json). Fallback: legacy HS256 secret.
 */
export function supabaseVerifier(cfg: AppConfig): TokenVerifier {
  const jwksUrl = cfg.SUPABASE_JWKS_URL ?? (cfg.SUPABASE_URL ? `${cfg.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json` : null);
  const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;
  const legacyKey = cfg.SUPABASE_JWT_SECRET ? new TextEncoder().encode(cfg.SUPABASE_JWT_SECRET) : null;
  const issuer = cfg.SUPABASE_URL ? `${cfg.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` : undefined;
  return {
    async verify(token) {
      let lastError: Error | null = null;
      if (jwks) {
        try {
          const { payload } = await jwtVerify(token, jwks, { algorithms: ['ES256', 'RS256'], ...(issuer ? { issuer } : {}) });
          return toUser(payload);
        } catch (e) {
          lastError = e as Error;
        }
      }
      if (legacyKey) {
        try {
          const { payload } = await jwtVerify(token, legacyKey, { algorithms: ['HS256'], ...(issuer ? { issuer } : {}) });
          return toUser(payload);
        } catch (e) {
          lastError = e as Error;
        }
      }
      throw new AuthError(`invalid token: ${lastError?.message ?? 'no verifier configured'}`);
    },
  };
}

export function createVerifier(cfg: AppConfig): TokenVerifier {
  return cfg.AUTH_MODE === 'local' ? localVerifier(cfg) : supabaseVerifier(cfg);
}
