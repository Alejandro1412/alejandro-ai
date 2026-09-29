import { decryptSecret, encryptSecret, hmacSha256Hex, safeEqual } from './crypto';

const KEY = 'a'.repeat(64);

describe('crypto', () => {
  it('round-trips AES-256-GCM secrets', () => {
    const enc = encryptSecret('{"refresh_token":"x"}', KEY);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(decryptSecret(enc, KEY)).toBe('{"refresh_token":"x"}');
  });

  it('detects tampering', () => {
    const enc = encryptSecret('secret', KEY);
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow();
  });

  it('computes HMACs and compares in constant time', () => {
    const sig = hmacSha256Hex('k', 'payload');
    expect(safeEqual(sig, hmacSha256Hex('k', 'payload'))).toBe(true);
    expect(safeEqual(sig, hmacSha256Hex('k', 'other'))).toBe(false);
  });
});
