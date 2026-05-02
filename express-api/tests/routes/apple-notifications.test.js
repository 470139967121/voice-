const express = require('express');
const request = require('supertest');

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
let mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

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
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'tx-refund-123',
  now: () => 1709913600000,
}));

const mockVerifyAppleNotification = jest.fn();
const mockVerifyAppleSignedTransaction = jest.fn();

jest.mock('../../src/utils/appleStore', () => ({
  verifyAppleNotification: mockVerifyAppleNotification,
  verifyAppleSignedTransaction: mockVerifyAppleSignedTransaction,
}));

const appleNotificationsRouter = require('../../src/routes/apple-notifications');
const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
  mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
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
  });
});

// ─── REFUND handling ─────────────────────────────────────────────

describe('POST /api/apple-notifications/v2 — REFUND', () => {
  test('reverses coin-pack entitlement: decrements coins + writes REFUND transaction', async () => {
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

    // Dedupe doc absent
    mockDocGet
      .mockResolvedValueOnce({ exists: false })
      // user doc post-update for balanceAfter
      .mockResolvedValueOnce({ exists: true, data: () => ({ shyCoins: -500 }) });

    // First collection lookup: purchaseReceipts (find by orderId)
    // Second collection lookup: coinPackages
    let callCount = 0;
    mockCollectionGet = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // purchaseReceipts lookup
        return Promise.resolve({
          empty: false,
          docs: [
            {
              id: 'receipt-1',
              data: () => ({
                userId: 'user-A',
                productId: 'medium_pack',
                isSubscription: false,
                orderId: '2000000123456789',
              }),
            },
          ],
        });
      }
      // coinPackages lookup
      return Promise.resolve({
        empty: false,
        docs: [
          {
            id: 'pkg-medium',
            data: () => ({ productId: 'medium_pack', coins: 500, bonusCoins: 0 }),
          },
        ],
      });
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ shyCoins: 'increment(-500)' }),
    );
    // REFUND transaction written
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REFUND',
        amount: -500,
        currency: 'COINS',
        originOrderId: '2000000123456789',
      }),
    );
  });

  test('reverses subscription entitlement: clears isSuperShy + writes REFUND', async () => {
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
          }),
        },
      ],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isSuperShy: false,
        superShyExpiry: null,
        superShyTier: null,
      }),
    );
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REFUND',
        details: expect.stringContaining('Super Shy monthly'),
      }),
    );
  });

  test('logs and continues when no purchaseReceipt matches the orderId', async () => {
    mockVerifyAppleNotification.mockResolvedValueOnce({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-orphan',
      data: { signedTransactionInfo: 'mock' },
    });
    mockVerifyAppleSignedTransaction.mockResolvedValueOnce({
      transactionId: 'unknown-id',
      productId: 'medium_pack',
      bundleId: 'com.shyden.shytalk',
    });
    mockDocGet.mockResolvedValueOnce({ exists: false });
    // purchaseReceipts lookup returns empty
    mockCollectionGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    const app = createApp();
    const res = await request(app)
      .post('/api/apple-notifications/v2')
      .send({ signedPayload: 'mock' });

    expect(res.status).toBe(200);
    expect(log.warn).toHaveBeenCalledWith(
      'apple-notifications',
      expect.stringContaining('No purchaseReceipt'),
      expect.any(Object),
    );
    // No update or transaction write
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});

// ─── EXPIRED / DID_FAIL_TO_RENEW ─────────────────────────────────

describe('POST /api/apple-notifications/v2 — EXPIRED', () => {
  test('clears subscription state when EXPIRED and receipt is a subscription', async () => {
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
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isSuperShy: false,
        superShyExpiry: null,
        superShyTier: null,
      }),
    );
  });
});

// ─── TEST notification ───────────────────────────────────────────

describe('POST /api/apple-notifications/v2 — TEST', () => {
  test('acknowledges TEST notification with 200, no side effect', async () => {
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
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});

// ─── Unknown notification type ───────────────────────────────────

describe('POST /api/apple-notifications/v2 — unknown type', () => {
  test('logs and returns 200 for unhandled notification types (so Apple stops retrying)', async () => {
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
  });
});
