/**
 * Local auth mode (contracts §1): the platform service owns auth.
 *
 * - Passwords: argon2id (the 'argon2' package's default parameters).
 * - Sessions: HS256 JWT, 24 h expiry, claims { sub: user_id, email }.
 * - Bootstrap: on boot, ensure BOOTSTRAP_USER_EMAIL/PASSWORD exists
 *   (demo defaults demo@benhealth.local / demo-password).
 *
 * User ids are deterministic per email (src/directory.ts) so every lookup —
 * including "does this user exist yet?" at boot and "find user for login" —
 * runs inside a normal RLS-scoped transaction.
 */

import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { Db } from './db.js';
import { userIdForEmail, type UserDirectory } from './directory.js';

const JWT_TTL_SECONDS = 24 * 60 * 60; // 24 h per contracts §1

export interface AuthUser {
  id: string;
  email: string;
}

export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    private readonly db: Db,
    private readonly directory: UserDirectory,
    jwtSecret: string,
  ) {
    this.secret = new TextEncoder().encode(jwtSecret);
  }

  /**
   * Idempotently create a user with the deterministic id for `email`.
   * Registers the user in the directory either way.
   */
  async ensureUser(email: string, password: string): Promise<AuthUser> {
    const normalized = email.trim().toLowerCase();
    const id = userIdForEmail(normalized);
    const user = await this.db.withUserTx(id, async (client) => {
      const existing = await client.query<{ id: string; email: string }>(
        'select id, email from app_user where id = $1',
        [id],
      );
      const row = existing.rows[0];
      if (row !== undefined) return { id: row.id, email: row.email };
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await client.query('insert into app_user (id, email, password_hash) values ($1, $2, $3)', [
        id,
        normalized,
        passwordHash,
      ]);
      return { id, email: normalized };
    });
    this.directory.register(user.id, user.email);
    return user;
  }

  /** Verify credentials; returns a signed JWT + user or null on failure. */
  async login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
    const normalized = email.trim().toLowerCase();
    const id = userIdForEmail(normalized);
    const row = await this.db.withUserTx(id, async (client) => {
      const res = await client.query<{ id: string; email: string; password_hash: string | null }>(
        'select id, email, password_hash from app_user where id = $1 and email = $2',
        [id, normalized],
      );
      return res.rows[0];
    });
    if (row === undefined || row.password_hash === null) return null;
    const ok = await argon2.verify(row.password_hash, password).catch(() => false);
    if (!ok) return null;
    this.directory.register(row.id, row.email);
    const token = await new SignJWT({ email: row.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(row.id)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS)
      .sign(this.secret);
    return { token, user: { id: row.id, email: row.email } };
  }

  /** Verify a Bearer JWT; returns the authenticated user or null. */
  async verifyToken(token: string): Promise<AuthUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
      return { id: payload.sub, email: payload.email };
    } catch {
      return null;
    }
  }
}
