/**
 * In-memory directory of user identities known to this service process.
 *
 * WHY THIS EXISTS: RLS is FORCED on `app_user` and every user-data table, and
 * the service role has no unscoped read path (by design — contracts §1). That
 * means the service cannot "look up a user by email" or "find the connection
 * whose external_user_id = X" with a bare query: without `app.user_id` set,
 * every query returns zero rows. Instead:
 *
 * - User ids are DETERMINISTIC (derived from the email, {@link userIdForEmail}),
 *   so login and boot can compute the id, open a user-scoped transaction with
 *   it, and read that user's own row — all inside RLS.
 * - Service-side fan-out (webhook userid → connection, OAuth state → user)
 *   iterates the registered user ids and runs a normal user-scoped query per
 *   user. This is a single-user product (multi-user-safe schema), so the
 *   directory holds the bootstrap user plus any users created through the
 *   auth module in this process; after a restart the bootstrap user is
 *   re-registered from config, which covers the product's real usage.
 */

import { createHash } from 'node:crypto';

/**
 * Deterministic user id for an email: first 16 bytes of
 * sha256('benhealth-user:' + lowercased email), stamped as an RFC 9562
 * version-8 (custom) UUID. Not secret — it only lets the service open the
 * correct RLS scope for a login attempt; authentication is the argon2id hash.
 */
export function userIdForEmail(email: string): string {
  const digest = createHash('sha256')
    .update(`benhealth-user:${email.trim().toLowerCase()}`)
    .digest();
  const b = Buffer.from(digest.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x80; // version 8 (custom / deterministic)
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class UserDirectory {
  private readonly byId = new Map<string, string>(); // id -> email

  register(id: string, email: string): void {
    this.byId.set(id, email.trim().toLowerCase());
  }

  emailFor(id: string): string | undefined {
    return this.byId.get(id);
  }

  /** All registered user ids, for service-scope per-user fan-out queries. */
  userIds(): string[] {
    return [...this.byId.keys()];
  }
}
