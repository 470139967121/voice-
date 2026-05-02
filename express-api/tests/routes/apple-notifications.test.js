const express = require('express');
const request = require('supertest');

// ── Firebase mock ────────────────────────────────────────────────
const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
let mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

// Transaction tracking: every `tx.update`/`tx.set` call inside the
// runTransaction callback is recorded against these mocks so tests can
// assert what the atomic state mutation contained.
const mockTxGet = jest.fn();
const mockTxUpdate = jest.fn();
const mockTxSet = jest.fn();
// Each runTransaction call returns the callback's return value, mirroring
// the real Firestore SDK contract so the helper can branch on whether
// the dedupe check short-circuited (false) or the side effect ran (true).
const mockRunTransaction = jest.fn(async (fn) => {
  return fn({ get: mockTxGet, update: mockTxUpdate, set: mockTxSet });
});

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
    })),
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: mockDocGet,
        set: mockDocSet,
      })),
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: mockCollectionGet,
        })),
      })),
    })),
    runTransaction: mockRunTransaction,
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
  },
}));

// ── Log mock ─────────────────────────────────────────────────────
jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ── Helpers mock (deterministic ids/timestamps) ──────────────────
jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'tx-refund-123',
  now: () => 1709913600000,
}));

// ── Apple verifiers ──────────────────────────────────────────────
const mockVerifyAppleNotification = jest.fn();
const mockVerifyAppleSignedTransaction = jest.fn();

jest.mock('../../src/utils/appleStore', () => ({
  verifyAppleNotification: mockVerifyAppleNotification,
  verifyAppleSignedTransaction: mockVerifyAppleSignedTransaction,
}));

// ── Alert manager ────────────────────────────────────────────────
const mockCreateAlert = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/alertManagerInstance', () => ({
  createAlert: mockCreateAlert,
}));

const appleNotificationsRouter = require('../../src/routes/apple-notifications');
const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
  mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
  // Default: inside-transaction dedupe check sees no prior row (proceed
  // with the side effect). Tests for the race-resolved-duplicate path
  // override with `mockTxGet.mockResolvedValueOnce({ exists: true })`.
  mockTxGet.mockResolvedValue({ exists: false });
  // Re-bind the runTransaction mock so each test starts with the default
  // pass-through behaviour after `clearAllMocks` resets it to a bare fn.
  mockRunTransaction.mockImplementation(async (fn) => {
    return fn({ get: mockTxGet, update: mockTxUpdate, set: mockTxSet });
  });
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', appleNotificationsRouter);
  return app;
}

// ─── Validation ──────────────────────────────────────────────────

describe('POST /api/apple-notifications/v2 — validation', () => {
  test('returns 400 when signedPayload is missing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/apple-notifications/v2').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signedPayload required/i);
  });

  test('returns 400 when JWS verification fails', async () => {
    mockVerifyAppleNotification.mockRejectedValueOnce(new Error('Invalid signature'));

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'bad-jws' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid notification signature/i);
    expect(log.warn).toHaveBeenCalled();
  });

  test('returns 400 when notification missing notificationUUID', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      // notificationUUID intentionally absent
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/notificationUUID/i);
  });

  test('returns 400 when embedded transaction signature fails', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-bad-tx',
      data: { signedTransactionInfo: 'mock-bad-jws' },
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockVerifyAppleSignedTransaction.mockRejectedValueOnce(new Error('Bad tx sig'));

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid embedded transaction/i);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});

// ─── Idempotency ─────────────────────────────────────────────────

describe('POST /api/apple-notifications/v2 — idempotency', () => {
  test('returns deduped:true when notificationUUID was already seen', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-already-seen',
    });
    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deduped: true });
    expect(mockVerifyAppleSignedTransaction).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  test('side effect + dedupe row commit atomically inside a single transaction', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-atomic',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: '2000atomic',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'receipt-atom',
          data: () => ({
            userId: 'user-atom',
            isSubscription: false,
            orderId: '2000atomic',
            coinsGranted: 500,
            bonusCoinsGranted: 0,
          }),
        },
      ],
    });

    const app = createApp();
    await request(app).post('/api/apple-notifications/v2').send({ signedPayload: 'mock' });

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    // The transaction must include the dedupe-row write so a partial
    // commit can never leave the side effect applied without the
    // dedupe row (or vice versa). Concurrent retries are serialised by
    // Firestore on the dedupe-ref read.
    expect(mockTxSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        notificationType: 'REFUND',
        notificationUUID: 'uuid-atomic',
        orderId: '2000atomic',
      }),
    );
  });

  test('inside-transaction dedupe sees concurrent retry → side effect skipped (race resolved)', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-race',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'race-tx',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });
    // Outer dedupe check passes (concurrent request hasn't yet written),
    // but by the time we're inside the transaction the OTHER concurrent
    // request has already written the dedupe row.
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockTxGet.mockResolvedValueOnce({ exists: true });
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'r-race',
          data: () => ({
            userId: 'user-race',
            isSubscription: false,
            orderId: 'race-tx',
            coinsGranted: 500,
            bonusCoinsGranted: 0,
          }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    // Side effect must NOT have been applied — the concurrent request
    // already did it. No update, no transaction row write.
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });
});

// ─── REFUND — coin pack ──────────────────────────────────────────

describe('POST /api/apple-notifications/v2 — REFUND coin pack', () => {
  test('reverses coin-pack entitlement using receipt.coinsGranted (not live coinPackages)', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-refund-1',
      data: { signedTransactionInfo: 'mock-jws' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: '2000000123456789',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });

    mockDocGet.mockResolvedValueOnce({ exists: false }); // dedupe absent

    // Receipt with persisted coinsGranted — refund must use 500 (receipt)
    // even if today's coinPackages config says 600.
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'receipt-1',
          data: () => ({
            userId: 'user-A',
            productId: 'medium_pack',
            isSubscription: false,
            orderId: '2000000123456789',
            coinsGranted: 500,
            bonusCoinsGranted: 0,
          }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shyCoins: 'increment(-500)' }),
    );
    expect(mockTxSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'REFUND',
        amount: -500,
        currency: 'COINS',
        originOrderId: '2000000123456789',
      }),
    );
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  test('legacy receipt (no coinsGranted) falls back to live coinPackages with logged warning', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-legacy',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'legacy-tx',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });

    mockDocGet.mockResolvedValueOnce({ exists: false }); // dedupe

    // Two collection.where lookups: 1) purchaseReceipts, 2) coinPackages fallback
    let callCount = 0;
    mockCollectionGet = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 'receipt-legacy',
              data: () => ({
                userId: 'user-legacy',
                productId: 'medium_pack',
                isSubscription: false,
                orderId: 'legacy-tx',
                // coinsGranted intentionally absent
              }),
            },
          ],
        });
      }
      return Promise.resolve({
        empty: false,
        docs: [
          { id: 'pkg', data: () => ({ productId: 'medium_pack', coins: 500, bonusCoins: 0 }) },
        ],
      });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(log.warn).toHaveBeenCalledWith(
      'apple-notifications',
      expect.stringContaining('Legacy receipt'),
      expect.any(Object),
    );
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shyCoins: 'increment(-500)' }),
    );
  });

  test('legacy receipt with unknown product writes dedupe + alerts ops, no balance change', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-orphan-pkg',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'orphan-pkg-tx',
      productId: 'discontinued_pack',
      bundleId: 'com.shyden.shytalk',
    });

    mockDocGet.mockResolvedValueOnce({ exists: false }); // dedupe

    let callCount = 0;
    mockCollectionGet = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 'receipt-d',
              data: () => ({
                userId: 'user-d',
                productId: 'discontinued_pack',
                isSubscription: false,
                orderId: 'orphan-pkg-tx',
              }),
            },
          ],
        });
      }
      return Promise.resolve({ empty: true, docs: [] }); // coinPackages empty
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(mockCreateAlert).toHaveBeenCalledWith(
      'refund_coin_pack_failed',
      'high',
      expect.any(String),
      expect.stringContaining('unknown_product'),
      expect.any(Object),
    );
    // Balance must NOT change — but dedupe row IS written so Apple stops retrying.
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockDocSet).toHaveBeenCalled();
  });
});

// ─── REFUND — subscription ───────────────────────────────────────

describe('POST /api/apple-notifications/v2 — REFUND subscription', () => {
  test('reverses subscription entitlement using receipt.tierGranted', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-refund-sub',
      data: { signedTransactionInfo: 'mock-jws-sub' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: '2000000sub',
      productId: 'super_shy_monthly',
      bundleId: 'com.shyden.shytalk',
    });

    mockDocGet.mockResolvedValueOnce({ exists: false }); // dedupe
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'receipt-2',
          data: () => ({
            userId: 'user-B',
            productId: 'super_shy_monthly',
            isSubscription: true,
            orderId: '2000000sub',
            tierGranted: 'monthly',
            daysGranted: 30,
          }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        isSuperShy: false,
        superShyExpiry: null,
        superShyTier: null,
      }),
    );
    expect(mockTxSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'REFUND',
        details: expect.stringContaining('Super Shy monthly'),
      }),
    );
    expect(mockRunTransaction).toHaveBeenCalled();
  });

  test('subscription not in SUBSCRIPTION_TIERS still clears entitlement defensively + alerts ops', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-unknown-sub',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'unk-sub',
      productId: 'super_shy_quarterly_promo50', // not in SUBSCRIPTION_TIERS
      bundleId: 'com.shyden.shytalk',
    });

    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'r-unk',
          data: () => ({
            userId: 'user-unk',
            isSubscription: true,
            orderId: 'unk-sub',
            // tierGranted intentionally absent (legacy)
          }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    // Defensive clear must still happen.
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isSuperShy: false }),
    );
    expect(mockCreateAlert).toHaveBeenCalledWith(
      'refund_unknown_subscription',
      'high',
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );
  });
});

// ─── REFUND — orphan (no receipt) ────────────────────────────────

describe('POST /api/apple-notifications/v2 — REFUND orphan', () => {
  test('orphan refund persists to orphanRefunds collection + critical-style alert', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-orphan',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'unknown-id',
      originalTransactionId: 'unknown-orig',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'apple-notifications',
      expect.stringContaining('Orphan refund'),
      expect.any(Object),
    );
    expect(mockCreateAlert).toHaveBeenCalledWith(
      'orphan_refund',
      'high',
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );
    // Worklist row written + dedupe row written. Both via mockDocSet.
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'unknown-id',
        productId: 'medium_pack',
        resolved: false,
      }),
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });
});

// ─── REVOKE (same path as REFUND) ────────────────────────────────

describe('POST /api/apple-notifications/v2 — REVOKE', () => {
  test('REVOKE reverses entitlement just like REFUND', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REVOKE',
      notificationUUID: 'uuid-revoke',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'rev-tx',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'r-rev',
          data: () => ({
            userId: 'user-rev',
            isSubscription: false,
            orderId: 'rev-tx',
            coinsGranted: 200,
            bonusCoinsGranted: 0,
          }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shyCoins: 'increment(-200)' }),
    );
  });
});

// ─── REFUND_REVERSED ─────────────────────────────────────────────

describe('POST /api/apple-notifications/v2 — REFUND_REVERSED', () => {
  test('REFUND_REVERSED writes worklist row + critical alert + dedupe (no auto-restore)', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND_REVERSED',
      notificationUUID: 'uuid-rev-rev',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: '2000rev-rev',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'apple-notifications',
      expect.stringContaining('REFUND_REVERSED'),
      expect.any(Object),
    );
    expect(mockCreateAlert).toHaveBeenCalledWith(
      'refund_reversed',
      'critical',
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );
    // No batch commit — the auto-restore is delegated to ops via worklist.
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});

// ─── EXPIRED / DID_FAIL_TO_RENEW / GRACE_PERIOD_EXPIRED ─────────

describe('POST /api/apple-notifications/v2 — subscription expiry', () => {
  test('EXPIRED clears subscription state when receipt is a subscription', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'EXPIRED',
      notificationUUID: 'uuid-expired',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: '2000sub',
      productId: 'super_shy_monthly',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'receipt-exp',
          data: () => ({ userId: 'user-C', isSubscription: true, orderId: '2000sub' }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        isSuperShy: false,
        superShyExpiry: null,
        superShyTier: null,
      }),
    );
  });

  test('GRACE_PERIOD_EXPIRED behaves the same as EXPIRED (clears entitlement)', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'GRACE_PERIOD_EXPIRED',
      notificationUUID: 'uuid-grace',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: '2000grace',
      productId: 'super_shy_monthly',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'r-grace',
          data: () => ({ userId: 'user-grace', isSubscription: true, orderId: '2000grace' }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isSuperShy: false }),
    );
  });

  test('EXPIRED for non-subscription receipt logs error + writes dedupe (no clear)', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'EXPIRED',
      notificationUUID: 'uuid-exp-mismatch',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: '2000mis',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'r-mis',
          data: () => ({ userId: 'user-mis', isSubscription: false, orderId: '2000mis' }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      'apple-notifications',
      expect.stringContaining('non-subscription'),
      expect.any(Object),
    );
    // No entitlement mutation.
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('EXPIRED with no matching receipt logs warning + writes dedupe', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'EXPIRED',
      notificationUUID: 'uuid-exp-orphan',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'orphan-exp',
      productId: 'super_shy_monthly',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(log.warn).toHaveBeenCalledWith(
      'apple-notifications',
      expect.stringContaining('expiry with no matching receipt'),
      expect.any(Object),
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });
});

// ─── CONSUMPTION_REQUEST ─────────────────────────────────────────

describe('POST /api/apple-notifications/v2 — CONSUMPTION_REQUEST', () => {
  test('alerts ops with high severity (12h SLA) + writes dedupe', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'CONSUMPTION_REQUEST',
      notificationUUID: 'uuid-consumption',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'cons-tx',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(mockCreateAlert).toHaveBeenCalledWith(
      'consumption_request',
      'high',
      expect.stringContaining('12h'),
      expect.any(String),
      expect.any(Object),
    );
  });
});

// ─── TEST notification ───────────────────────────────────────────

describe('POST /api/apple-notifications/v2 — TEST', () => {
  test('acknowledges TEST with 200, writes dedupe, no alert', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'TEST',
      notificationUUID: 'uuid-test',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(log.info).toHaveBeenCalledWith(
      'apple-notifications',
      expect.stringContaining('TEST notification'),
      expect.any(Object),
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockCreateAlert).not.toHaveBeenCalled();
    // dedupe row IS written.
    expect(mockDocSet).toHaveBeenCalled();
  });
});

// ─── Unknown notification type ───────────────────────────────────

describe('POST /api/apple-notifications/v2 — unknown type', () => {
  test('logs and returns 200 for unhandled notification types (Apple stops retrying)', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'OFFER_REDEEMED',
      notificationUUID: 'uuid-unknown',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: '2000offer',
      productId: 'super_shy_monthly',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(log.info).toHaveBeenCalledWith(
      'apple-notifications',
      expect.stringContaining('Acknowledged'),
      expect.any(Object),
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });
});

// ─── Crash → 500 + alert ─────────────────────────────────────────

describe('POST /api/apple-notifications/v2 — crash handling', () => {
  test('returns 500 + critical alert when batch commit fails (so Apple retries)', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-crash',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'crash-tx',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockCollectionGet = jest.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'r-crash',
          data: () => ({
            userId: 'user-crash',
            isSubscription: false,
            orderId: 'crash-tx',
            coinsGranted: 100,
            bonusCoinsGranted: 0,
          }),
        },
      ],
    });
    mockRunTransaction.mockRejectedValueOnce(new Error('Firestore down'));

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledWith(
      'apple-notifications',
      expect.stringContaining('crashed'),
      expect.objectContaining({
        notificationUUID: 'uuid-crash',
        notificationType: 'REFUND',
      }),
    );
    expect(mockCreateAlert).toHaveBeenCalledWith(
      'apple_notification_crash',
      'critical',
      expect.any(String),
      'Firestore down',
      expect.any(Object),
    );
  });
});
