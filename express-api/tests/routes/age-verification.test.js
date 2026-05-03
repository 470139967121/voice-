/**
 * Tests for the user-facing age-verification routes:
 *   - POST /api/age-verification/upload-url
 *   - POST /api/age-verification/submit
 *
 * Admin-side routes (list / approve / reject / modify-DOB) ship in PR
 * 4b — out of scope here.
 *
 * The 18+ gating logic (sub-18 users cannot submit) is enforced
 * server-side in addition to the client-side gate, since a malicious
 * client could call this API directly. Tests pin both paths.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock (path-aware) ─────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockCollectionAdd = jest.fn();
const mockCollectionWhere = jest.fn();
const mockCollectionGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      set: (...args) => mockDocSet(path, ...args),
    })),
    collection: jest.fn((name) => ({
      add: (...args) => mockCollectionAdd(name, ...args),
      where: (...args) => {
        mockCollectionWhere(name, ...args);
        return {
          where: (...inner) => {
            mockCollectionWhere(name, ...inner);
            return { limit: () => ({ get: () => mockCollectionGet() }) };
          },
          limit: () => ({ get: () => mockCollectionGet() }),
          get: () => mockCollectionGet(),
        };
      },
    })),
  },
}));

const mockGetSignedPutUrl = jest.fn();
jest.mock('../../src/utils/r2', () => ({
  getSignedPutUrl: (...args) => mockGetSignedPutUrl(...args),
}));

jest.mock('../../src/utils/helpers', () => ({
  now: () => 1709913600000,
  generateId: () => 'gen-id-abc',
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSignedPutUrl.mockResolvedValue('https://r2-signed/abc');
  mockDocGet.mockResolvedValue({ exists: false });
  mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
  mockCollectionAdd.mockResolvedValue({ id: 'new-submission-id' });
});

// ─── App setup ──────────────────────────────────────────────────────

const ageVerificationRouter = require('../../src/routes/age-verification');

/**
 * Creates a test app with injected auth.
 * @param {Object} authOverride
 * @param {Object} userDoc Body returned by mockDocGet for users/<uid>
 */
function createApp(authOverride = {}, userDoc = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = {
      uid: 'fb-uid-1',
      uniqueId: 10000001,
      token: {},
      ...authOverride,
    };
    next();
  });

  if (userDoc !== null) {
    mockDocGet.mockImplementation((path) => {
      if (path === `users/${10000001}`) {
        return Promise.resolve({ exists: true, data: () => userDoc });
      }
      return Promise.resolve({ exists: false });
    });
  }

  app.use('/api', ageVerificationRouter);
  return app;
}

// ─── POST /api/age-verification/upload-url ──────────────────────────

describe('POST /api/age-verification/upload-url', () => {
  test('returns a signed URL + r2Key for the authenticated user', async () => {
    const eighteenYearsAgo = new Date(Date.now() - 18 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    const res = await request(app)
      .post('/api/age-verification/upload-url')
      .send({ contentType: 'image/jpeg' })
      .expect(200);

    expect(res.body.uploadUrl).toBe('https://r2-signed/abc');
    expect(res.body.r2Key).toMatch(/^age-verification\/10000001\//);
    expect(res.body.expiresInSec).toBe(300);
    expect(mockGetSignedPutUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^age-verification\/10000001\//),
      'image/jpeg',
    );
  });

  test('rejects unsupported contentType (only image/* allowed)', async () => {
    const eighteenYearsAgo = new Date(Date.now() - 18 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    await request(app)
      .post('/api/age-verification/upload-url')
      .send({ contentType: 'application/pdf' })
      .expect(400);

    expect(mockGetSignedPutUrl).not.toHaveBeenCalled();
  });

  test('rejects missing contentType', async () => {
    const eighteenYearsAgo = new Date(Date.now() - 18 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    await request(app).post('/api/age-verification/upload-url').send({}).expect(400);
    expect(mockGetSignedPutUrl).not.toHaveBeenCalled();
  });

  test('rejects sub-18 user (cannot start verification)', async () => {
    // User spec: 16-17 cohort cannot submit; tap on restricted feature
    // shows "Contact support" copy. Must enforce server-side too.
    const sixteenYearsAgo = new Date(Date.now() - 16 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: sixteenYearsAgo, ageVerified: false });

    const res = await request(app)
      .post('/api/age-verification/upload-url')
      .send({ contentType: 'image/jpeg' })
      .expect(403);

    expect(res.body.error).toMatch(/18/);
    expect(mockGetSignedPutUrl).not.toHaveBeenCalled();
  });

  test('rejects already-verified user (no re-submission needed)', async () => {
    const eighteenYearsAgo = new Date(Date.now() - 18 * 365.25 * 86400 * 1000).getTime();
    const app = createApp(
      {},
      { dateOfBirth: eighteenYearsAgo, ageVerified: true, ageVerifiedAt: 1700000000000 },
    );

    await request(app)
      .post('/api/age-verification/upload-url')
      .send({ contentType: 'image/jpeg' })
      .expect(409);

    expect(mockGetSignedPutUrl).not.toHaveBeenCalled();
  });
});

// ─── POST /api/age-verification/submit ──────────────────────────────

describe('POST /api/age-verification/submit', () => {
  test('creates pending submission for valid 18+ unverified user', async () => {
    const eighteenYearsAgo = new Date(Date.now() - 18 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    const res = await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/abc.jpg', idMethod: 'passport' })
      .expect(200);

    expect(res.body.submissionId).toBe('new-submission-id');
    expect(res.body.status).toBe('pending');

    expect(mockCollectionAdd).toHaveBeenCalledWith(
      'ageVerificationSubmissions',
      expect.objectContaining({
        userId: '10000001',
        status: 'pending',
        idMethod: 'passport',
        r2Key: 'age-verification/10000001/abc.jpg',
        submittedAt: 1709913600000,
      }),
    );
  });

  test('rejects unknown idMethod', async () => {
    const eighteenYearsAgo = new Date(Date.now() - 18 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'x', idMethod: 'birth-certificate' })
      .expect(400);

    expect(mockCollectionAdd).not.toHaveBeenCalled();
  });

  test("rejects r2Key not under user prefix (cannot upload someone else's image)", async () => {
    // The signed URL forces the prefix on upload; pin server-side
    // re-validation so a hand-rolled API call can't smuggle a key
    // under another user's prefix.
    const eighteenYearsAgo = new Date(Date.now() - 18 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/99999999/abc.jpg', idMethod: 'passport' })
      .expect(403);

    expect(mockCollectionAdd).not.toHaveBeenCalled();
  });

  test('rejects sub-18 user', async () => {
    const sixteenYearsAgo = new Date(Date.now() - 16 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: sixteenYearsAgo, ageVerified: false });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/abc.jpg', idMethod: 'passport' })
      .expect(403);

    expect(mockCollectionAdd).not.toHaveBeenCalled();
  });

  test('rejects already-verified user', async () => {
    const eighteenYearsAgo = new Date(Date.now() - 18 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: true });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/abc.jpg', idMethod: 'passport' })
      .expect(409);

    expect(mockCollectionAdd).not.toHaveBeenCalled();
  });

  test('rejects when there is already a pending submission (only 1 at a time)', async () => {
    // User spec: "can only submit 1 attempt at a time".
    const eighteenYearsAgo = new Date(Date.now() - 18 * 365.25 * 86400 * 1000).getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });
    mockCollectionGet.mockResolvedValue({ empty: false, docs: [{ id: 'existing-pending' }] });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/abc.jpg', idMethod: 'passport' })
      .expect(409);

    expect(mockCollectionAdd).not.toHaveBeenCalled();
  });
});
