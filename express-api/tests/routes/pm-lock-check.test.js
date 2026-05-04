/**
 * Tests for the PM-lock first-of-day auto-unlock endpoint.
 *
 *   POST /api/users/:uniqueId/pm-lock-check
 *
 * Called by the client AFTER successful sign-in. Server-side because
 * Firestore rules deny client writes to `pmLocked` / `lastPmLockCheck`
 * (PR 11 spec — those are server-only). The endpoint reads the user
 * doc, decides whether the lock should lift (user has aged in to 18+
 * since the lock was applied), and writes the unlock atomically.
 *
 * Throttling: skips the calendar age recompute when
 * `lastPmLockCheck` is in the same UTC day as `now()`. Saves the
 * Firestore quota on active users without taking a daily-cron hit
 * for dormant accounts (per the user's "minimize Firestore ops" rule
 * and the 2026-05-04 spec answer #4).
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ─────────────────────────────────────────────────

const mockTxGet = jest.fn();
const mockTxUpdate = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({ _path: path })),
    runTransaction: jest.fn(async (fn) => {
      return fn({
        get: (ref) => mockTxGet(ref?._path),
        update: (ref, payload) => mockTxUpdate(ref?._path, payload),
      });
    }),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  // Pinned to a fixed timestamp so the day-bucket calculation is
  // deterministic across runs. 2026-05-04T12:00:00Z = 1777896000000.
  now: () => 1777896000000,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const pmLockRouter = require('../../src/routes/pm-lock-check');

function createApp({ uniqueId = 10000050 } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId, token: {} };
    next();
  });
  app.use('/api', pmLockRouter);
  return app;
}

const TODAY_UTC_START = Date.UTC(2026, 4, 4); // 2026-05-04 00:00:00 UTC
const YESTERDAY_UTC_START = TODAY_UTC_START - 86_400_000;

function dobYearsAgo(years) {
  const d = new Date('2026-05-04T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.getTime();
}

// ── Happy path: aged-in user gets unlocked ──────────────────────

describe('POST /api/users/:uniqueId/pm-lock-check', () => {
  test('unlocks pmLocked=true user who is now 18+ and has not been checked today', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(18), // just turned 18
        pmLocked: true,
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({ pmLocked: false, unlocked: true });
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({ pmLocked: false, lastPmLockCheck: 1777896000000 }),
    );
  });

  test('keeps lock for sub-18 user but updates lastPmLockCheck (throttle)', async () => {
    // 16-y/o user: still locked but the day-bucket bump means we don't
    // re-scan again until tomorrow. Pin the no-unlock + throttle bump.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(16),
        pmLocked: true,
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({ pmLocked: true, unlocked: false });
    // The doc is still updated — but only the throttle stamp, not the lock state
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({ lastPmLockCheck: 1777896000000 }),
    );
    // Verify pmLocked was NOT downgraded
    const updateArgs = mockTxUpdate.mock.calls[0][1];
    expect(updateArgs.pmLocked).not.toBe(false);
  });

  test('skips Firestore write when already checked today (idempotent + cheap)', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(20),
        pmLocked: true,
        lastPmLockCheck: TODAY_UTC_START + 100, // earlier today
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({ pmLocked: true, unlocked: false, alreadyCheckedToday: true });
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('no-op for users who are not pmLocked (most common case)', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(25),
        pmLocked: false,
        lastPmLockCheck: null,
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({ pmLocked: false, unlocked: false });
    // No Firestore write at all — already-unlocked users don't need
    // their throttle stamp bumped because the next read won't change
    // outcome. (Would change if we ever needed to re-lock; not today.)
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('rejects request from a different user (uniqueId mismatch)', async () => {
    // /api/users/10000050/pm-lock-check called by user 10000099 →
    // 403. Defends against a malicious client unlocking another
    // user's PMs (would be moot since rules deny client writes
    // anyway, but gate at the route layer too — defence in depth).
    const app = createApp({ uniqueId: 10000099 });
    await request(app).post('/api/users/10000050/pm-lock-check').expect(403);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('returns 404 for missing user doc', async () => {
    mockTxGet.mockResolvedValue({ exists: false });
    const app = createApp();
    await request(app).post('/api/users/10000050/pm-lock-check').expect(404);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('null DOB → no unlock, throttle bumped', async () => {
    // Null DOB users are routed to RequiredDOBScreen / blocked at
    // sign-in (PR 5b). If somehow they reach this endpoint, just
    // bump the throttle stamp and don't touch lock state.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ dateOfBirth: null, pmLocked: true, lastPmLockCheck: null }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);
    expect(res.body).toMatchObject({ pmLocked: true, unlocked: false });
  });
});
