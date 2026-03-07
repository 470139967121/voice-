// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockCollectionGet = jest.fn();
const mockRefDelete = jest.fn().mockResolvedValue();
const mockSend = jest.fn().mockResolvedValue();

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
  },
  messaging: {
    send: (...args) => mockSend(...args),
  },
}));

const expireBans = require('../../src/cron/expireBans');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('expireBans', () => {
  test('removes expired bans', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    // deviceBans query
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { delete: mockRefDelete },
        },
      ],
    });

    // networkBans query
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'net1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old ip' }),
          ref: { delete: mockRefDelete },
        },
      ],
    });

    // alertConfig/settings
    mockDocGet.mockResolvedValueOnce({ exists: false });

    await expireBans();

    expect(mockRefDelete).toHaveBeenCalledTimes(2);
  });

  test('skips non-expired bans', async () => {
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();

    // deviceBans — not expired
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: futureExpiry, reason: 'active' }),
          ref: { delete: mockRefDelete },
        },
      ],
    });

    // networkBans — not expired
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'net1',
          data: () => ({ expiresAt: futureExpiry, reason: 'active ip' }),
          ref: { delete: mockRefDelete },
        },
      ],
    });

    await expireBans();

    expect(mockRefDelete).not.toHaveBeenCalled();
  });

  test('handles empty collections', async () => {
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });
    mockCollectionGet.mockResolvedValueOnce({ docs: [] });

    await expireBans();

    expect(mockRefDelete).not.toHaveBeenCalled();
  });

  test('sends FCM notification on expiry', async () => {
    const pastExpiry = new Date(Date.now() - 86400000).toISOString();

    // deviceBans — one expired
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'dev1',
          data: () => ({ expiresAt: pastExpiry, reason: 'old' }),
          ref: { delete: mockRefDelete },
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

    // users/adminUser1 — has FCM token
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ fcmToken: 'token-abc' }),
    });

    await expireBans();

    expect(mockRefDelete).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          title: 'Bans Expired',
        }),
        token: 'token-abc',
      }),
    );
  });
});
