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
// Used by the submit handler's transaction. The transaction shape is
// `await db.runTransaction(async (tx) => { tx.get(query); tx.set(ref, ...); })`.
// We control the snapshot returned by `tx.get(...)` and capture the
// `tx.set` payload so tests can assert it.
const mockTxGet = jest.fn();
const mockTxSet = jest.fn();
const mockNewDocRef = { id: 'new-submission-id' };

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      set: (...args) => mockDocSet(path, ...args),
    })),
    collection: jest.fn(() => ({
      // For submit: `db.collection(...).doc()` returns a fresh ref.
      doc: jest.fn(() => mockNewDocRef),
      // For submit: `db.collection(...).where(...).where(...).limit(1)`
      // returns a query passed to `tx.get(...)` — we don't need the
      // chain to do anything because the tx mock handles it.
      where: () => ({
        where: () => ({ limit: () => ({}) }),
      }),
    })),
    runTransaction: jest.fn(async (fn) => {
      return fn({
        get: () => mockTxGet(),
        set: (ref, payload) => mockTxSet(ref, payload),
      });
    }),
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
  mockTxGet.mockResolvedValue({ empty: true, docs: [] });
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
    // 25 years ago to be safely past the calendar 18+ boundary.
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);
    const eighteenYearsAgo = dob.getTime();
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
    // 25 years ago to be safely past the calendar 18+ boundary.
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);
    const eighteenYearsAgo = dob.getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    await request(app)
      .post('/api/age-verification/upload-url')
      .send({ contentType: 'application/pdf' })
      .expect(400);

    expect(mockGetSignedPutUrl).not.toHaveBeenCalled();
  });

  test('rejects missing contentType', async () => {
    // 25 years ago to be safely past the calendar 18+ boundary.
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);
    const eighteenYearsAgo = dob.getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    await request(app).post('/api/age-verification/upload-url').send({}).expect(400);
    expect(mockGetSignedPutUrl).not.toHaveBeenCalled();
  });

  test('rejects sub-18 user (cannot start verification)', async () => {
    // User spec: 16-17 cohort cannot submit; tap on restricted feature
    // shows "Contact support" copy. Must enforce server-side too.
    const sixteen = new Date();
    sixteen.setUTCFullYear(sixteen.getUTCFullYear() - 16);
    const app = createApp({}, { dateOfBirth: sixteen.getTime(), ageVerified: false });

    const res = await request(app)
      .post('/api/age-verification/upload-url')
      .send({ contentType: 'image/jpeg' })
      .expect(403);

    expect(res.body.error).toMatch(/18/);
    expect(mockGetSignedPutUrl).not.toHaveBeenCalled();
  });

  test('rejects already-verified user (no re-submission needed)', async () => {
    // 25 years ago to be safely past the calendar 18+ boundary.
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);
    const eighteenYearsAgo = dob.getTime();
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
  // Helper — 25 years ago is safely past the calendar 18+ boundary
  // and avoids leap-year drift that the 365.25*MS approximation
  // produced. See `isAtLeast18FromDob` calendar-aware comparison.
  function dobAge(years) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.getTime();
  }

  test('creates pending submission for valid 18+ unverified user', async () => {
    // Use 25 years ago to be safely past the calendar 18+ boundary.
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);
    const app = createApp({}, { dateOfBirth: dob.getTime(), ageVerified: false });

    const res = await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/abc.jpg', idMethod: 'passport' })
      .expect(200);

    expect(res.body.submissionId).toBe('new-submission-id');
    expect(res.body.status).toBe('pending');

    expect(mockTxSet).toHaveBeenCalledWith(
      mockNewDocRef,
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
    // 25 years ago to be safely past the calendar 18+ boundary.
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);
    const eighteenYearsAgo = dob.getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'x', idMethod: 'birth-certificate' })
      .expect(400);

    expect(mockTxSet).not.toHaveBeenCalled();
  });

  test("rejects r2Key not under user prefix (cannot upload someone else's image)", async () => {
    // The signed URL forces the prefix on upload; pin server-side
    // re-validation so a hand-rolled API call can't smuggle a key
    // under another user's prefix.
    // 25 years ago to be safely past the calendar 18+ boundary.
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);
    const eighteenYearsAgo = dob.getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: false });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/99999999/abc.jpg', idMethod: 'passport' })
      .expect(403);

    expect(mockTxSet).not.toHaveBeenCalled();
  });

  test('rejects sub-18 user', async () => {
    const app = createApp({}, { dateOfBirth: dobAge(16), ageVerified: false });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/abc.jpg', idMethod: 'passport' })
      .expect(403);

    expect(mockTxSet).not.toHaveBeenCalled();
  });

  test('rejects already-verified user', async () => {
    // 25 years ago to be safely past the calendar 18+ boundary.
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 25);
    const eighteenYearsAgo = dob.getTime();
    const app = createApp({}, { dateOfBirth: eighteenYearsAgo, ageVerified: true });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/abc.jpg', idMethod: 'passport' })
      .expect(409);

    expect(mockTxSet).not.toHaveBeenCalled();
  });

  test('rejects when there is already a pending submission (only 1 at a time)', async () => {
    // User spec: "can only submit 1 attempt at a time". Now enforced
    // atomically inside `db.runTransaction` so the check is consistent
    // with the create — a check-then-add TOCTOU window can't let
    // duplicates through.
    const app = createApp({}, { dateOfBirth: dobAge(25), ageVerified: false });
    mockTxGet.mockResolvedValue({ empty: false, docs: [{ id: 'existing-pending' }] });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/abc.jpg', idMethod: 'passport' })
      .expect(409);

    expect(mockTxSet).not.toHaveBeenCalled();
  });

  test('allows re-submission after a previous submission was rejected', async () => {
    // User spec: "Retry as many times as they want." A rejected
    // submission has status 'rejected', which the 'pending'-only
    // query inside the transaction does NOT match, so a fresh
    // submit succeeds.
    const app = createApp({}, { dateOfBirth: dobAge(25), ageVerified: false });
    // tx.get returns empty (no pending) — same default as setup; the
    // rejected historical doc would be at a different status.
    mockTxGet.mockResolvedValue({ empty: true, docs: [] });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/retry.jpg', idMethod: 'national-id' })
      .expect(200);

    expect(mockTxSet).toHaveBeenCalled();
  });

  test('rejects path-traversal attempt in r2Key (cannot escape user prefix)', async () => {
    // The startsWith() check passes for `age-verification/<uid>/../<other>/x.jpg`
    // — pin the explicit `..` rejection that defends against R2 / CDN
    // path normalisation collapsing the segment.
    const app = createApp({}, { dateOfBirth: dobAge(25), ageVerified: false });

    await request(app)
      .post('/api/age-verification/submit')
      .send({
        r2Key: 'age-verification/10000001/../99999999/img.jpg',
        idMethod: 'passport',
      })
      .expect(403);

    expect(mockTxSet).not.toHaveBeenCalled();
  });

  test('rejects multi-segment r2Key under user prefix (must be single file)', async () => {
    // `age-verification/<uid>/sub/dir/x.jpg` could escape into
    // unintended bucket areas if a CDN config strips the prefix
    // boundary. Require a single segment after the prefix.
    const app = createApp({}, { dateOfBirth: dobAge(25), ageVerified: false });

    await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/sub/x.jpg', idMethod: 'passport' })
      .expect(403);

    expect(mockTxSet).not.toHaveBeenCalled();
  });

  test('returns errorId in 500 response so support can correlate logs', async () => {
    // A Firestore failure inside the transaction propagates here.
    // Pin that the response body includes `errorId: 'AGE_VERIF_SUBMIT'`
    // so a user reporting a failure can quote it to support and the
    // engineer can find the pm2 log entry by the same code.
    const app = createApp({}, { dateOfBirth: dobAge(25), ageVerified: false });
    mockTxGet.mockRejectedValue(new Error('firestore-down'));

    const res = await request(app)
      .post('/api/age-verification/submit')
      .send({ r2Key: 'age-verification/10000001/abc.jpg', idMethod: 'passport' })
      .expect(500);

    expect(res.body).toMatchObject({ errorId: 'AGE_VERIF_SUBMIT' });
  });
});
