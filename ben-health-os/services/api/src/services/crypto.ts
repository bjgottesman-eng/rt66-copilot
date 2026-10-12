import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for OAuth tokens at rest (Phase 2 connectors). Key: TOKEN_ENCRYPTION_KEY,
 * base64 of 32 bytes. Output layout: 12-byte IV || 16-byte tag || ciphertext.
 */
export class TokenCipher {
  private readonly key: Buffer;
  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
    this.key = key;
  }
  static generateKey(): string {
    return randomBytes(32).toString('base64');
  }
  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]);
  }
  decrypt(blob: Buffer): string {
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ct = blob.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}
