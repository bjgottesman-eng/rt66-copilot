import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../src/crypto.js';

describe('crypto (AES-256-GCM, iv||tag||ciphertext)', () => {
  const key = randomBytes(32);

  it('round-trips a token', () => {
    const plaintext = 'a-very-secret-oauth-token-1234567890';
    const enc = encryptToken(key, plaintext);
    expect(decryptToken(key, enc)).toBe(plaintext);
  });

  it('produces distinct ciphertexts per call (random IV)', () => {
    const a = encryptToken(key, 'same');
    const b = encryptToken(key, 'same');
    expect(a.equals(b)).toBe(false);
    // Layout: 12-byte iv + 16-byte tag + ciphertext
    expect(a.length).toBe(12 + 16 + Buffer.byteLength('same'));
  });

  it('ciphertext does not contain the plaintext', () => {
    const enc = encryptToken(key, 'fake-access-token-visible?');
    expect(enc.toString('utf8')).not.toContain('fake-access-token');
    expect(enc.toString('latin1')).not.toContain('fake-access-token');
  });

  it('throws on tampering with any segment', () => {
    const enc = encryptToken(key, 'tamper-me');
    for (const index of [0, 13, enc.length - 1]) {
      const tampered = Buffer.from(enc);
      tampered[index] = tampered[index]! ^ 0xff;
      expect(() => decryptToken(key, tampered)).toThrow();
    }
  });

  it('throws with the wrong key', () => {
    const enc = encryptToken(key, 'wrong-key-case');
    expect(() => decryptToken(randomBytes(32), enc)).toThrow();
  });

  it('rejects invalid key sizes and truncated ciphertexts', () => {
    expect(() => encryptToken(randomBytes(16), 'x')).toThrow(/32 bytes/);
    expect(() => decryptToken(key, Buffer.alloc(10))).toThrow(/too short/);
  });
});
