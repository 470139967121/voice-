const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      set: mockDocSet,
      update: mockDocUpdate,
    })),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
  },
  FieldValue: {
    increment: jest.fn(n => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'gen-id',
  now: () => 1709913600000,
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

const { getDoc } = require('../../src/utils/firestore-helpers');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup ───────────────────────────────────────────────────

const usersRouter = require('../../src/routes/users');

function createApp(uid = 'user-A') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid };
    next();
  });
  app.use('/api', usersRouter);
  return app;
}

// ─── POST /api/users (upsert) ─────────────────────────────────────

describe('POST /api/users', () => {
  test('creates new user with lastSeenAt (not lastSeen)', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    getDoc.mockResolvedValue(null); // no existing doc

    const app = createApp('new-user');
    await request(app)
      .post('/api/users')
      .send({ uid: 'new-user', displayName: 'Alice' })
      .expect(200);

    // Check the set() call uses lastSeenAt
    const setCall = mockDocSet.mock.calls[0];
    const data = setCall[0];
    expect(data.lastSeenAt).toBe(1709913600000);
    expect(data.lastSeen).toBeUndefined();
    expect(data.uid).toBe('new-user');
    expect(data.displayName).toBe('Alice');
  });

  test('updates existing user with lastSeenAt (not lastSeen)', async () => {
    getDoc.mockResolvedValue({ uid: 'user-A', displayName: 'Old' });

    const app = createApp('user-A');
    await request(app)
      .post('/api/users')
      .send({ uid: 'user-A', displayName: 'Alice' })
      .expect(200);

    // Check the update() call uses lastSeenAt
    const updateCall = mockDocUpdate.mock.calls[0];
    const updates = updateCall[0];
    expect(updates.lastSeenAt).toBe(1709913600000);
    expect(updates.lastSeen).toBeUndefined();
  });

  test('rejects creating user for another uid', async () => {
    const app = createApp('user-A');
    await request(app)
      .post('/api/users')
      .send({ uid: 'user-B', displayName: 'Impersonator' })
      .expect(403);
  });

  test('rejects missing uid', async () => {
    const app = createApp('user-A');
    await request(app)
      .post('/api/users')
      .send({ displayName: 'Alice' })
      .expect(400);
  });
});

// ─── PATCH /api/users/:uid ──────────────────────────────────────

describe('PATCH /api/users/:uid', () => {
  test('accepts description and nationality (not bio/country)', async () => {
    const app = createApp('user-A');

    await request(app)
      .patch('/api/users/user-A')
      .send({ description: 'Hello!', nationality: 'US' })
      .expect(200);

    const updateCall = mockDocUpdate.mock.calls[0];
    const updates = updateCall[0];
    expect(updates.description).toBe('Hello!');
    expect(updates.nationality).toBe('US');
  });

  test('rejects bio and country fields (old names stripped, returns 400 with no valid fields)', async () => {
    const app = createApp('user-A');

    // When ONLY old field names are sent, no valid updates remain → 400
    await request(app)
      .patch('/api/users/user-A')
      .send({ bio: 'Hello!', country: 'US' })
      .expect(400);
  });

  test('rejects updating another user', async () => {
    const app = createApp('user-A');
    await request(app)
      .patch('/api/users/user-B')
      .send({ displayName: 'Hacked' })
      .expect(403);
  });
});

// ─── POST /api/users/:uid/record-visit (stalkers) ──────────────

describe('POST /api/users/:uid/record-visit', () => {
  test('skips self-visits', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/users/user-A/record-visit')
      .send({ visitorId: 'user-A' })
      .expect(200);

    expect(res.body.success).toBe(true);
    // No Firestore writes for self-visit
    expect(mockDocUpdate.mock.calls.length).toBe(0);
  });

  test('creates new stalker doc with lastVisitedAt field', async () => {
    getDoc.mockResolvedValue(null); // new visitor
    const app = createApp('visitor-1');

    await request(app)
      .post('/api/users/profile-owner/record-visit')
      .send({ visitorId: 'visitor-1' })
      .expect(200);

    // Check stalker doc was created via batch.set with correct field names
    expect(mockBatchSet).toHaveBeenCalled();
    const setCall = mockBatchSet.mock.calls[0];
    const stalkerData = setCall[1]; // batch.set(ref, data, options) — data is 2nd arg
    expect(stalkerData.visitorId).toBe('visitor-1');
    expect(stalkerData.lastVisitedAt).toBe(1709913600000);
    expect(stalkerData.firstVisitedAt).toBe(1709913600000);
    expect(stalkerData.visitCount).toBe(1);
    // Should NOT have old field name
    expect(stalkerData.visitedAt).toBeUndefined();
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('updates existing stalker with lastVisitedAt', async () => {
    getDoc.mockResolvedValue({ visitorId: 'visitor-1', visitCount: 3 });
    const app = createApp('visitor-1');

    await request(app)
      .post('/api/users/profile-owner/record-visit')
      .send({ visitorId: 'visitor-1' })
      .expect(200);

    // Check update uses lastVisitedAt via batch.update
    expect(mockBatchUpdate).toHaveBeenCalled();
    const updateCall = mockBatchUpdate.mock.calls[0];
    const updates = updateCall[1]; // batch.update(ref, data) — data is 2nd arg
    expect(updates.lastVisitedAt).toBe(1709913600000);
    expect(updates.visitCount).toBe(4);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('rejects missing visitorId', async () => {
    const app = createApp('visitor-1');
    await request(app)
      .post('/api/users/profile-owner/record-visit')
      .send({})
      .expect(400);
  });

  test('rejects impersonation (visitorId must match auth)', async () => {
    const app = createApp('real-user');
    await request(app)
      .post('/api/users/profile-owner/record-visit')
      .send({ visitorId: 'fake-user' })
      .expect(403);
  });
});
