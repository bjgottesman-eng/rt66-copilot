import { createHash, randomBytes } from 'node:crypto';

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE S256 pair (verifier 43–128 chars). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(randomBytes(24));
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ISO instant */
  expiresAt: string;
  scope: string | null;
  /** Provider user id when the token response carries it (Withings userid). */
  externalUserId?: string | null;
  raw?: Record<string, unknown>;
}
