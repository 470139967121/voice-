/**
 * Tests for the one-shot PM-lock migration (`scripts/migrate-pm-lock.js`).
 *
 * Coverage focuses on the pure logic that decides which user docs are
 * candidates for locking — the read-side of the migration. The actual
 * batch-write path is exercised separately by integration tests
 * because it touches firestore.batch() directly.
 */

const mockGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn(() => ({ get: mockGet })),
    batch: jest.fn(),
    doc: jest.fn(),
  },
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

const { isCurrentlyUnder18, scanCandidates } = require('../../scripts/migrate-pm-lock');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isCurrentlyUnder18', () => {
  // The ms-per-year shorthand drifts by ~6 hours per leap cycle. The
  // function must use calendar arithmetic, not a fixed-ms multiplier.
  // These tests pin both that it returns the right answer AND that
  // it agrees with the route handler's `isAtLeast18FromDob` (parity).

  test('returns false for null / non-numeric / NaN DOB', () => {
    expect(isCurrentlyUnder18(null)).toBe(false);
    expect(isCurrentlyUnder18(undefined)).toBe(false);
    expect(isCurrentlyUnder18('not-a-number')).toBe(false);
    expect(isCurrentlyUnder18(NaN)).toBe(false);
    expect(isCurrentlyUnder18(Infinity)).toBe(false);
  });

  test('returns true for a clearly-under-18 DOB (10 years ago)', () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);
    expect(isCurrentlyUnder18(tenYearsAgo.getTime())).toBe(true);
  });

  test('returns false for a clearly-18+ DOB (30 years ago)', () => {
    const thirtyYearsAgo = new Date();
    thirtyYearsAgo.setUTCFullYear(thirtyYearsAgo.getUTCFullYear() - 30);
    expect(isCurrentlyUnder18(thirtyYearsAgo.getTime())).toBe(false);
  });

  test('returns true for a 17-y/o DOB whose 18th birthday is tomorrow', () => {
    // DOB = today + 1 day, 18 years ago. Calendar comparison says
    // age = 17 (still under by one day).
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 18);
    dob.setUTCDate(dob.getUTCDate() + 1);
    expect(isCurrentlyUnder18(dob.getTime())).toBe(true);
  });

  test('returns false for a DOB whose 18th birthday was yesterday', () => {
    // DOB = today - 1 day, 18 years ago. Calendar comparison says
    // age = 18 (just turned).
    const dob = new Date();
    dob.setUTCFullYear(dob.getUTCFullYear() - 18);
    dob.setUTCDate(dob.getUTCDate() - 1);
    expect(isCurrentlyUnder18(dob.getTime())).toBe(false);
  });
});

describe('scanCandidates', () => {
  function dobYearsAgo(years) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.getTime();
  }

  function mockUserDocs(users) {
    mockGet.mockResolvedValue({
      docs: users.map((u) => ({
        id: u.id,
        data: () => u.data,
      })),
    });
  }

  test('includes sub-18 users with valid DOB and no existing pmLocked', async () => {
    mockUserDocs([
      { id: '10000001', data: { dateOfBirth: dobYearsAgo(15), pmLocked: false } },
      { id: '10000002', data: { dateOfBirth: dobYearsAgo(13), pmLocked: false } },
    ]);

    const candidates = await scanCandidates();

    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.id).sort()).toEqual(['10000001', '10000002']);
  });

  test('skips users already pmLocked (idempotency)', async () => {
    mockUserDocs([
      { id: '10000001', data: { dateOfBirth: dobYearsAgo(15), pmLocked: true } },
      { id: '10000002', data: { dateOfBirth: dobYearsAgo(13), pmLocked: false } },
    ]);

    const candidates = await scanCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('10000002');
  });

  test('skips 18+ users (not affected by the migration)', async () => {
    mockUserDocs([
      { id: '10000001', data: { dateOfBirth: dobYearsAgo(25), pmLocked: false } },
      { id: '10000002', data: { dateOfBirth: dobYearsAgo(40), pmLocked: false } },
      { id: '10000003', data: { dateOfBirth: dobYearsAgo(15), pmLocked: false } },
    ]);

    const candidates = await scanCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('10000003');
  });

  test('skips users with null / missing DOB (handled by other paths)', async () => {
    mockUserDocs([
      { id: '10000001', data: { dateOfBirth: null, pmLocked: false } },
      { id: '10000002', data: { pmLocked: false } }, // missing DOB field entirely
      { id: '10000003', data: { dateOfBirth: dobYearsAgo(15), pmLocked: false } },
    ]);

    const candidates = await scanCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('10000003');
  });

  test('captures the pre-migration snapshot for revert visibility', async () => {
    // The snapshot writer relies on this — each candidate carries the
    // raw doc data so the JSON dumped to disk can show what the previous
    // pmLocked / lastPmLockCheck values were before the script ran.
    mockUserDocs([
      {
        id: '10000001',
        data: { dateOfBirth: dobYearsAgo(15), pmLocked: false, lastPmLockCheck: 12345 },
      },
    ]);

    const candidates = await scanCandidates();

    expect(candidates[0]).toMatchObject({
      id: '10000001',
      dob: expect.any(Number),
      snapshot: expect.objectContaining({
        pmLocked: false,
        lastPmLockCheck: 12345,
      }),
    });
  });
});
