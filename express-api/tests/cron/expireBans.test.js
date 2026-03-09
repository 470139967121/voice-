// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockCollectionGet = jest.fn();
const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

const mockWhere = jest.fn(() => ({
  get: mockCollectionGet,
}));

const mockCollection = jest.fn(() => ({
  where: (...args) => {
    mockWhere(...args);
    return { get: mockCollectionGet };
  },
}));

const mockDoc = jest.fn(() => ({
  get: mockDocGet,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (...args) => mockCollection(...args),
    doc: (...args) => mockDoc(...args),
    batch: jest.fn(() => ({
      delete: mockBatchDelete,
      commit: mockBatchCommit,
    })),
  },
}));

// Mock FCM utility
const mockSendFcmToTokens = jest.fn().mockResolvedValue([]);
const mockCleanupInvalidTokens = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: (...args) => mockSendFcmToTokens(...args),
  cleanupInvalidTokens: (...args) => mockCleanupInvalidTokens(...args),
}));

const expireBans = require('../../src/cron/expireBans');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('expireBans', () => {
  test('removes expired bans via batch', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    // deviceBans query
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });

    // networkBans query
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'net1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old ip' }),
          ref: { path: 'networkBans/net1' },
        },
      ],
    });

    // alertConfig/settings
    mockDocGet.mockResolvedValueOnce({ exists: false });

    await expireBans();

    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  test('skips non-expired bans', async () => {
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();

    // deviceBans — not expired
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: futureExpiry, reason: 'active' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });

    // networkBans — not expired
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'net1',
          data: () => ({ expiresAt: futureExpiry, reason: 'active ip' }),
          ref: { path: 'networkBans/net1' },
        },
      ],
    });

    await expireBans();

    expect(mockBatchDelete).not.toHaveBeenCalled();
  });

  test('handles empty collections', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    await expireBans();

    expect(mockBatchDelete).not.toHaveBeenCalled();
  });

  test('sends FCM notification via shared utility on expiry', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    // deviceBans — one expired
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { path: 'deviceBans/dev1' },
        },
      ],
    });

    // networkBans — empty
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    // alertConfig/settings — has recipients
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmRecipientUserIds: ['adminUser1'] }),
    });

    // users/adminUser1 — has FCM tokens
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmTokens: ['token-abc', 'token-def'] }),
    });

    await expireBans();

    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
    expect(mockSendFcmToTokens).toHaveBeenCalledWith(
      ['token-abc', 'token-def'],
      expect.objectContaining({
        type: 'admin_notification',
        title: 'Bans Expired',
      }),
    );
  });
});
