const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
    })),
    collection: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      startAfter: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
    })),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  now: jest.fn(() => 1700000000000),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // Allow all requests
}));

// ─── App setup ──────────────────────────────────────────────────

const adminEconomyRouter = require('../../src/routes/admin-economy');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', adminEconomyRouter);
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('POST /api/users/:uid/luck', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  it('should accept valid numeric luckScore', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: 50 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should accept valid string numeric luckScore', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: '75' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should reject NaN luckScore', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('luckScore must be a number');
  });

  it('should reject NaN pityCounter', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({ pityCounter: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('pityCounter must be a number');
  });

  it('should clamp luckScore between 0 and 100', async () => {
    const { db } = require('../../src/utils/firebase');

    await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: 200 });

    // Check the update call received clamped value
    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.luckScore).toBe(100);
  });

  it('should clamp negative luckScore to 0', async () => {
    await request(app)
      .post('/api/users/user-1/luck')
      .send({ luckScore: -50 });

    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.luckScore).toBe(0);
  });

  it('should clamp negative pityCounter to 0', async () => {
    await request(app)
      .post('/api/users/user-1/luck')
      .send({ pityCounter: -10 });

    const updateCall = mockDocUpdate.mock.calls[0]?.[0];
    expect(updateCall?.pityCounter).toBe(0);
  });

  it('should return 400 when no fields provided', async () => {
    const res = await request(app)
      .post('/api/users/user-1/luck')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No fields to update');
  });
});
