/**
 * Tests for src/utils/totp-crypto.js
 *
 * Exported functions:
 * - encryptSecret(plaintext) → "iv:ciphertext:tag" (hex-encoded, AES-256-GCM)
 * - decryptSecret(encryptedString) → original plaintext
 *
 * Key is read from TOTP_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 * Module throws at load time if key is missing or wrong length.
 */

const VALID_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

// ─── Module-load validation ────────────────────────────────────────

describe('module load validation', () => {
  const originalKey = process.env.TOTP_ENCRYPTION_KEY;

  afterEach(() => {
    // Restore env and purge module cache so each test gets a fresh load
    if (originalKey === undefined) {
      delete process.env.TOTP_ENCRYPTION_KEY;
    } else {
      process.env.TOTP_ENCRYPTION_KEY = originalKey;
    }
    jest.resetModules();
  });

  it('throws a clear error when TOTP_ENCRYPTION_KEY is missing', () => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    expect(() => require('../../src/utils/totp-crypto')).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it('throws a clear error when TOTP_ENCRYPTION_KEY is too short', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(62);
    expect(() => require('../../src/utils/totp-crypto')).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it('throws a clear error when TOTP_ENCRYPTION_KEY is too long', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(66);
    expect(() => require('../../src/utils/totp-crypto')).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it('does not throw when TOTP_ENCRYPTION_KEY is exactly 64 hex chars', () => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    expect(() => require('../../src/utils/totp-crypto')).not.toThrow();
  });
});

// ─── Helpers — load module with a known valid key ──────────────────

function loadWithKey(key) {
  process.env.TOTP_ENCRYPTION_KEY = key;
  jest.resetModules();
  return require('../../src/utils/totp-crypto');
}

// ─── encryptSecret ────────────────────────────────────────────────

describe('encryptSecret()', () => {
  beforeEach(() => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('returns a string', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    expect(typeof encryptSecret('JBSWY3DPEHPK3PXP')).toBe('string');
  });

  it('returns exactly three colon-separated parts (iv:ciphertext:tag)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const result = encryptSecret('JBSWY3DPEHPK3PXP');
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
  });

  it('all three parts are non-empty hex strings', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const result = encryptSecret('JBSWY3DPEHPK3PXP');
    const [iv, ciphertext, tag] = result.split(':');
    expect(iv).toMatch(/^[0-9a-f]+$/i);
    expect(ciphertext).toMatch(/^[0-9a-f]+$/i);
    expect(tag).toMatch(/^[0-9a-f]+$/i);
  });

  it('IV is 24 hex chars (12 bytes)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const [iv] = encryptSecret('JBSWY3DPEHPK3PXP').split(':');
    expect(iv).toHaveLength(24);
  });

  it('auth tag is 32 hex chars (16 bytes)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const parts = encryptSecret('JBSWY3DPEHPK3PXP').split(':');
    expect(parts[2]).toHaveLength(32);
  });

  it('two encryptions of the same plaintext produce different ciphertexts (IV uniqueness)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const a = encryptSecret('JBSWY3DPEHPK3PXP');
    const b = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
  });

  it('two different secrets produce different ciphertexts', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const a = encryptSecret('SECRET_ONE');
    const b = encryptSecret('SECRET_TWO');
    expect(a).not.toBe(b);
  });
});

// ─── decryptSecret ────────────────────────────────────────────────

describe('decryptSecret()', () => {
  it('round-trip: decrypting an encrypted secret returns the original plaintext', () => {
    const { encryptSecret, decryptSecret } = loadWithKey(VALID_KEY);
    const original = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(original);
    expect(decryptSecret(encrypted)).toBe(original);
  });

  it('round-trip works for arbitrary UTF-8 secrets', () => {
    const { encryptSecret, decryptSecret } = loadWithKey(VALID_KEY);
    const secrets = ['AAAA BBBB CCCC', 'short', 'a'.repeat(100), '12345678901234567890'];
    for (const secret of secrets) {
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    }
  });

  it('throws when decrypting with a different key (wrong key)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const encrypted = encryptSecret('JBSWY3DPEHPK3PXP');

    const DIFFERENT_KEY = 'b'.repeat(64);
    const { decryptSecret: decryptWithWrongKey } = loadWithKey(DIFFERENT_KEY);
    expect(() => decryptWithWrongKey(encrypted)).toThrow();
  });

  it('throws when the encrypted string is malformed (missing parts)', () => {
    const { decryptSecret } = loadWithKey(VALID_KEY);
    expect(() => decryptSecret('onlyone')).toThrow();
    expect(() => decryptSecret('only:two')).toThrow();
  });

  it('throws when the encrypted string is tampered (corrupted ciphertext)', () => {
    const { encryptSecret, decryptSecret } = loadWithKey(VALID_KEY);
    const [iv, , tag] = encryptSecret('JBSWY3DPEHPK3PXP').split(':');
    // Replace ciphertext with garbage of same length
    const garbage = 'deadbeef'.repeat(4);
    expect(() => decryptSecret(`${iv}:${garbage}:${tag}`)).toThrow();
  });
});
