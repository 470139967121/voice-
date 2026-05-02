// Mock the Apple library before requiring the validator. The real
// `SignedDataVerifier` needs Apple root CA certs + a signed JWS to verify
// against — neither of which is practical to produce in CI. Our wrapper's
// job is the validation logic ON TOP of `verifyAndDecodeTransaction`'s
// output (productId match, revocation, subscription expiry, bundleId), so
// we mock the library and unit-test our wrapper.

const mockVerifyAndDecodeTransaction = jest.fn();

jest.mock('@apple/app-store-server-library', () => ({
  SignedDataVerifier: jest.fn().mockImplementation(() => ({
    verifyAndDecodeTransaction: mockVerifyAndDecodeTransaction,
  })),
  Environment: { PRODUCTION: 'PRODUCTION', SANDBOX: 'SANDBOX' },
  VerificationException: class VerificationException extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  },
  VerificationStatus: {
    OK: 0,
    INVALID_SIGNATURE: 1,
    INVALID_CERTIFICATE: 2,
    INVALID_CHAIN_LENGTH: 3,
    INVALID_CHAIN: 4,
  },
}));

jest.mock('node:fs', () => ({
  readdirSync: jest.fn().mockReturnValue(['AppleRootCA-G3.cer']),
  readFileSync: jest.fn().mockReturnValue(Buffer.from('mock-cert')),
  existsSync: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { verifyApplePurchase, _resetVerifier } = require('../../src/utils/appleStore');
const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
  _resetVerifier();
  process.env.APPLE_ROOT_CERTS_DIR = '/mock/apple-certs';
  process.env.APPLE_APP_STORE_ENV = 'sandbox';
});

afterEach(() => {
  delete process.env.APPLE_ROOT_CERTS_DIR;
  delete process.env.APPLE_APP_STORE_ENV;
});

// ─── Happy paths ──────────────────────────────────────────────

describe('verifyApplePurchase — consumable (one-shot purchase)', () => {
  test('returns normalised purchase data on valid JWS', async () => {
    const jws = 'mock-jws-payload';
    mockVerifyAndDecodeTransaction.mockResolvedValueOnce({
      transactionId: '2000000123456789',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
      purchaseDate: 1700000000000,
      expiresDate: undefined,
      revocationReason: undefined,
    });

    const result = await verifyApplePurchase('medium_pack', jws, false);

    expect(result.orderId).toBe('2000000123456789');
    expect(result.productId).toBe('medium_pack');
    expect(result.purchaseDate).toBe(1700000000000);
    expect(mockVerifyAndDecodeTransaction).toHaveBeenCalledWith(jws);
  });
});

describe('verifyApplePurchase — subscription (auto-renewable)', () => {
  test('returns normalised purchase data on valid active subscription', async () => {
    const jws = 'mock-jws-sub';
    const expiresDate = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    mockVerifyAndDecodeTransaction.mockResolvedValueOnce({
      transactionId: '2000000999999999',
      productId: 'super_shy_monthly',
      bundleId: 'com.shyden.shytalk',
      purchaseDate: Date.now(),
      expiresDate,
      revocationReason: undefined,
    });

    const result = await verifyApplePurchase('super_shy_monthly', jws, true);

    expect(result.orderId).toBe('2000000999999999');
    expect(result.productId).toBe('super_shy_monthly');
    expect(result.expiresDate).toBe(expiresDate);
  });
});

// ─── Rejection paths ──────────────────────────────────────────

describe('verifyApplePurchase — rejection paths', () => {
  test('rejects when productId in JWS does not match expected', async () => {
    mockVerifyAndDecodeTransaction.mockResolvedValueOnce({
      transactionId: '2000000111111111',
      productId: 'small_pack',
      bundleId: 'com.shyden.shytalk',
      purchaseDate: 1700000000000,
    });

    await expect(verifyApplePurchase('large_pack', 'mock-jws', false)).rejects.toThrow(
      /productId mismatch/i,
    );
    expect(log.warn).toHaveBeenCalled();
  });

  test('rejects when transaction is revoked (refund or family-share revoke)', async () => {
    mockVerifyAndDecodeTransaction.mockResolvedValueOnce({
      transactionId: '2000000222222222',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
      purchaseDate: 1700000000000,
      revocationReason: 1, // Apple: refund
    });

    await expect(verifyApplePurchase('medium_pack', 'mock-jws', false)).rejects.toThrow(/revoked/i);
  });

  test('rejects expired subscription', async () => {
    mockVerifyAndDecodeTransaction.mockResolvedValueOnce({
      transactionId: '2000000333333333',
      productId: 'super_shy_monthly',
      bundleId: 'com.shyden.shytalk',
      purchaseDate: 1700000000000,
      expiresDate: 1700000000000, // way in the past
    });

    await expect(verifyApplePurchase('super_shy_monthly', 'mock-jws', true)).rejects.toThrow(
      /expired/i,
    );
  });

  test('rejects bundleId mismatch (defence-in-depth — verifier already enforces this)', async () => {
    mockVerifyAndDecodeTransaction.mockResolvedValueOnce({
      transactionId: '2000000444444444',
      productId: 'medium_pack',
      bundleId: 'com.example.spoofed',
      purchaseDate: 1700000000000,
    });

    await expect(verifyApplePurchase('medium_pack', 'mock-jws', false)).rejects.toThrow(
      /bundleId mismatch/i,
    );
  });

  test('propagates VerificationException from the Apple library', async () => {
    const { VerificationException } = require('@apple/app-store-server-library');
    mockVerifyAndDecodeTransaction.mockRejectedValueOnce(
      new VerificationException('Invalid signature', 1),
    );

    await expect(verifyApplePurchase('medium_pack', 'bad-jws', false)).rejects.toThrow(
      /Invalid signature/,
    );
  });
});

// ─── Configuration ────────────────────────────────────────────

describe('verifyApplePurchase — configuration', () => {
  test('throws fast when APPLE_ROOT_CERTS_DIR is unset', async () => {
    delete process.env.APPLE_ROOT_CERTS_DIR;
    _resetVerifier();

    await expect(verifyApplePurchase('medium_pack', 'mock-jws', false)).rejects.toThrow(
      /APPLE_ROOT_CERTS_DIR/,
    );
  });

  test('uses PRODUCTION environment when APPLE_APP_STORE_ENV=production', async () => {
    process.env.APPLE_APP_STORE_ENV = 'production';
    process.env.APPLE_APP_STORE_APP_ID = '1234567890';
    _resetVerifier();
    const { SignedDataVerifier } = require('@apple/app-store-server-library');

    mockVerifyAndDecodeTransaction.mockResolvedValueOnce({
      transactionId: 'x',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
      purchaseDate: 1,
    });

    await verifyApplePurchase('medium_pack', 'mock-jws', false);

    // SignedDataVerifier(rootCerts, performRevocationChecking, environment, bundleId, appAppleId)
    expect(SignedDataVerifier).toHaveBeenCalledWith(
      expect.any(Array),
      true,
      'PRODUCTION',
      'com.shyden.shytalk',
      1234567890,
    );
  });

  test('throws when APPLE_APP_STORE_ENV=production but APPLE_APP_STORE_APP_ID unset', async () => {
    process.env.APPLE_APP_STORE_ENV = 'production';
    delete process.env.APPLE_APP_STORE_APP_ID;
    _resetVerifier();

    await expect(verifyApplePurchase('medium_pack', 'mock-jws', false)).rejects.toThrow(
      /APPLE_APP_STORE_APP_ID/,
    );
  });

  test('throws when APPLE_APP_STORE_APP_ID is non-numeric', async () => {
    process.env.APPLE_APP_STORE_ENV = 'production';
    process.env.APPLE_APP_STORE_APP_ID = 'not-a-number';
    _resetVerifier();

    await expect(verifyApplePurchase('medium_pack', 'mock-jws', false)).rejects.toThrow(
      /must be numeric/,
    );
  });

  test('uses SANDBOX environment by default (no appAppleId required)', async () => {
    delete process.env.APPLE_APP_STORE_ENV;
    delete process.env.APPLE_APP_STORE_APP_ID;
    _resetVerifier();
    const { SignedDataVerifier } = require('@apple/app-store-server-library');

    mockVerifyAndDecodeTransaction.mockResolvedValueOnce({
      transactionId: 'x',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
      purchaseDate: 1,
    });

    await verifyApplePurchase('medium_pack', 'mock-jws', false);

    expect(SignedDataVerifier).toHaveBeenCalledWith(
      expect.any(Array),
      true,
      'SANDBOX',
      'com.shyden.shytalk',
      undefined,
    );
  });
});
