/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * Ciphertext layout (contracts §2, oauth_token.*_enc): `iv || tag || ciphertext`
 * with a 12-byte random IV and a 16-byte GCM auth tag. Any tampering with any
 * of the three segments — or decrypting with the wrong key — fails the GCM tag
 * check and throws.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function assertKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`encryption key must be ${KEY_LENGTH} bytes (got ${key.length})`);
  }
}

/** Encrypt a UTF-8 string; returns `iv || tag || ciphertext`. */
export function encryptToken(key: Buffer, plaintext: string): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/** Decrypt an `iv || tag || ciphertext` buffer produced by {@link encryptToken}. */
export function decryptToken(key: Buffer, data: Buffer): string {
  assertKey(key);
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('ciphertext too short');
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
