/**
 * Tests for the age-verification audit-log reconciliation cron
 * (`src/cron/ageVerificationAuditReconcile.js`).
 *
 * Pin the back-fill behaviour: scan submissions decided in the last
 * 7 days, skip those with a matching audit row, write a remediation
 * entry for the gaps. Idempotent on a second run via the
 * `details.fromSubmissionId` marker.
 */

// ─── Firebase mock ────────────────────────────────────────────────

const mockSubmissionsGet = jest.fn();
const mockTaggedAuditGet = jest.fn();
const mockOriginalAuditGet = jest.fn();
const mockAuditAdd = jest.fn().mockResolvedValue();

// `db.collection(name).where(...).where(...)?.limit(...)?.get()` —
// we route by collection name + the query shape.
const mockSubmissionsCollection = {
  where: (field, op, value) => ({
    get: () => mockSubmissionsGet({ field, op, value }),
  }),
};

// `jest.mock()` is hoisted; only references that start with `mock`
// (case-insensitive) are allowed. Naming this `mockBuild...` rather
// than `buildAuditCollection` so Jest's hoist-safety check accepts.
const mockBuildAuditCollection = () => ({
  add: (...args) => mockAuditAdd(...args),
  where: function whereFn(field, op, value) {
    // Route the two query shapes to dedicated mocks so a test can
    // stub them independently:
    //   1) `details.fromSubmissionId` == X  → tagged-row idempotency
    //   2) `actionType` == X (chained with another `where`) → original
    if (field === 'details.fromSubmissionId') {
      return {
        limit: () => ({ get: () => mockTaggedAuditGet({ value }) }),
      };
    }
    // actionType / targetId chain — return another `where`-like
    // that captures both clauses then resolves via mockOriginalAuditGet.
    const captured = [{ field, op, value }];
    return {
      where: (f2, o2, v2) => {
        captured.push({ field: f2, op: o2, value: v2 });
        return {
          limit: () => ({ get: () => mockOriginalAuditGet({ captured }) }),
        };
      },
    };
  },
});

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn((name) => {
      if (name === 'ageVerificationSubmissions') return mockSubmissionsCollection;
      if (name === 'auditLog') return mockBuildAuditCollection();
      throw new Error(`Unexpected collection: ${name}`);
    }),
  },
}));

// Pin `now` so timestamp math is deterministic. 2026-05-04T12:00:00Z.
jest.mock('../../src/utils/helpers', () => ({
  now: () => 1777896000000,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const ageVerificationAuditReconcile = require('../../src/cron/ageVerificationAuditReconcile');

function submission(overrides = {}) {
  return {
    id: 'sub-1',
    data: () => ({
      userId: '10000050',
      idMethod: 'passport',
      status: 'approved',
      decisionAt: 1777896000000 - 60_000, // 1 min before now
      decidedBy: 10000001,
      ...overrides,
    }),
  };
}

// ─── Empty / no-op cases ──────────────────────────────────────────

describe('ageVerificationAuditReconcile — empty + idempotency', () => {
  test('returns zero counts when no decided submissions are in the window', async () => {
    mockSubmissionsGet.mockResolvedValue({ docs: [] });

    const result = await ageVerificationAuditReconcile();

    expect(result).toEqual({
      scanned: 0,
      reconciled: 0,
      skippedPending: 0,
      skippedAlreadyAudited: 0,
      skippedUnknownStatus: 0,
      failed: 0,
    });
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });

  test('skips a submission whose audit row is already tagged with fromSubmissionId (idempotent re-run)', async () => {
    mockSubmissionsGet.mockResolvedValue({ docs: [submission()] });
    // Tagged-row query returns a hit → already reconciled.
    mockTaggedAuditGet.mockResolvedValue({ empty: false, docs: [{ id: 'audit-tagged' }] });

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(result.skippedAlreadyAudited).toBe(1);
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });

  test('skips a submission whose original audit row matches on actionType + targetId + timestamp window', async () => {
    mockSubmissionsGet.mockResolvedValue({ docs: [submission()] });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    // Original audit row, timestamp within ±10 min of decisionAt.
    mockOriginalAuditGet.mockResolvedValue({
      docs: [
        {
          data: () => ({ timestamp: 1777896000000 - 30_000 }), // 30s before now
        },
      ],
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(result.skippedAlreadyAudited).toBe(1);
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });
});

// ─── Reconciliation paths ─────────────────────────────────────────

describe('ageVerificationAuditReconcile — back-fill', () => {
  test('writes a remediation entry when no audit row exists for an approved decision', async () => {
    mockSubmissionsGet.mockResolvedValue({ docs: [submission()] });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    mockOriginalAuditGet.mockResolvedValue({ docs: [] });

    const result = await ageVerificationAuditReconcile();

    expect(result.reconciled).toBe(1);
    expect(mockAuditAdd).toHaveBeenCalledTimes(1);
    const entry = mockAuditAdd.mock.calls[0][0];
    expect(entry.action).toBe('age_verification_approved');
    expect(entry.actionType).toBe('age_verification_approved');
    expect(entry.targetId).toBe('10000050');
    expect(entry.adminUid).toBe(10000001);
    expect(entry.details.fromSubmissionId).toBe('sub-1');
    expect(entry.details.method).toBe('passport');
    expect(entry.details.note).toMatch(/Reconciled by ageVerificationAuditReconcile/);
  });

  test('rejected status maps to age_verification_rejected', async () => {
    mockSubmissionsGet.mockResolvedValue({
      docs: [submission({ status: 'rejected' })],
    });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    mockOriginalAuditGet.mockResolvedValue({ docs: [] });

    await ageVerificationAuditReconcile();

    const entry = mockAuditAdd.mock.calls[0][0];
    expect(entry.action).toBe('age_verification_rejected');
    // Method is approve-only metadata — must NOT leak into reject entries.
    expect(entry.details.method).toBeUndefined();
  });

  test('modify-dob status maps to age_verification_dob_modified + adds DOB-delta caveat', async () => {
    mockSubmissionsGet.mockResolvedValue({
      docs: [submission({ status: 'modify-dob' })],
    });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    mockOriginalAuditGet.mockResolvedValue({ docs: [] });

    await ageVerificationAuditReconcile();

    const entry = mockAuditAdd.mock.calls[0][0];
    expect(entry.action).toBe('age_verification_dob_modified');
    expect(entry.details.note).toMatch(/DOB delta not captured/);
  });

  test('original-audit timestamp OUTSIDE the ±10 min window does not match — back-fill happens', async () => {
    mockSubmissionsGet.mockResolvedValue({ docs: [submission()] });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    // Timestamp 11 min before now — outside the window.
    mockOriginalAuditGet.mockResolvedValue({
      docs: [{ data: () => ({ timestamp: 1777896000000 - 11 * 60_000 }) }],
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.reconciled).toBe(1);
  });

  test('falls back to adminUid=0 when decidedBy is missing (legacy / corrupted submission)', async () => {
    mockSubmissionsGet.mockResolvedValue({
      docs: [submission({ decidedBy: undefined })],
    });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    mockOriginalAuditGet.mockResolvedValue({ docs: [] });

    await ageVerificationAuditReconcile();

    const entry = mockAuditAdd.mock.calls[0][0];
    expect(entry.adminUid).toBe(0);
  });
});

// ─── Defensive / unknown status ───────────────────────────────────

describe('ageVerificationAuditReconcile — defensive', () => {
  test('skips submissions with an unrecognised status without throwing', async () => {
    mockSubmissionsGet.mockResolvedValue({
      docs: [submission({ status: 'pending' })], // shouldn't be returned by query but defend anyway
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.skippedPending).toBe(1);
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });

  test('skips submissions with a status not in STATUS_ACTION_MAP', async () => {
    mockSubmissionsGet.mockResolvedValue({
      docs: [submission({ status: 'expired' })],
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.skippedUnknownStatus).toBe(1);
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });

  test('skips submissions missing decisionAt (partially-committed transaction)', async () => {
    mockSubmissionsGet.mockResolvedValue({
      docs: [submission({ decisionAt: undefined })],
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.skippedPending).toBe(1);
  });
});

// ─── Per-doc isolation: one bad doc must not abort remediation ────

describe('ageVerificationAuditReconcile — per-doc isolation', () => {
  test('one failing doc does not abort the rest — failed counter increments, others reconciled', async () => {
    const goodDoc = submission({ id: 'sub-good' });
    const badDoc = {
      id: 'sub-bad',
      data: () => ({
        userId: '10000051',
        idMethod: 'passport',
        status: 'approved',
        decisionAt: 1777896000000 - 60_000,
        decidedBy: 10000001,
      }),
    };
    // Two docs in the scan; the second triggers a Firestore failure
    // when its `auditLog` add is attempted.
    mockSubmissionsGet.mockResolvedValue({ docs: [goodDoc, badDoc] });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    mockOriginalAuditGet.mockResolvedValue({ docs: [] });
    // First add succeeds, second throws.
    mockAuditAdd.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Firestore unavailable'));

    const result = await ageVerificationAuditReconcile();

    expect(result.scanned).toBe(2);
    expect(result.reconciled).toBe(1);
    expect(result.failed).toBe(1);
    // The good doc was still written even though the bad one failed.
    expect(mockAuditAdd).toHaveBeenCalledTimes(2);
  });

  test('a doc whose data() throws is counted as failed, not as a hard crash', async () => {
    const exploding = {
      id: 'sub-explode',
      data: () => {
        throw new Error('corrupted snapshot');
      },
    };
    const good = submission({ id: 'sub-ok' });
    mockSubmissionsGet.mockResolvedValue({ docs: [exploding, good] });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    mockOriginalAuditGet.mockResolvedValue({ docs: [] });

    const result = await ageVerificationAuditReconcile();

    expect(result.failed).toBe(1);
    expect(result.reconciled).toBe(1);
  });
});

// ─── Firestore Timestamp coercion ─────────────────────────────────

describe('ageVerificationAuditReconcile — Firestore Timestamp shapes', () => {
  test('decisionAt as Firestore Timestamp ({ toMillis() }) is matched against the audit-row window', async () => {
    const decisionMs = 1777896000000 - 60_000;
    mockSubmissionsGet.mockResolvedValue({
      docs: [
        submission({
          decisionAt: { toMillis: () => decisionMs },
        }),
      ],
    });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    // Original audit row 30s before the Timestamp-shaped decisionAt.
    mockOriginalAuditGet.mockResolvedValue({
      docs: [{ data: () => ({ timestamp: { toMillis: () => decisionMs - 30_000 } }) }],
    });

    const result = await ageVerificationAuditReconcile();

    // Match found via the Timestamp coercion path.
    expect(result.skippedAlreadyAudited).toBe(1);
    expect(result.reconciled).toBe(0);
  });

  test('decisionAt as { seconds, nanoseconds } shape (plain-object Timestamp) is coerced', async () => {
    const decisionMs = 1777896000000 - 60_000;
    mockSubmissionsGet.mockResolvedValue({
      docs: [
        submission({
          decisionAt: { seconds: Math.floor(decisionMs / 1000), nanoseconds: 0 },
        }),
      ],
    });
    mockTaggedAuditGet.mockResolvedValue({ empty: true, docs: [] });
    mockOriginalAuditGet.mockResolvedValue({ docs: [] });

    const result = await ageVerificationAuditReconcile();

    // No matching audit row → back-fill happens, proving decisionAt
    // was successfully coerced (otherwise it would have skipped as
    // "no decisionAt").
    expect(result.reconciled).toBe(1);
  });

  test('decisionAt as a string is treated as missing — submission is skipped, not back-filled', async () => {
    mockSubmissionsGet.mockResolvedValue({
      docs: [submission({ decisionAt: 'not-a-timestamp' })],
    });

    const result = await ageVerificationAuditReconcile();

    expect(result.skippedPending).toBe(1);
    expect(mockAuditAdd).not.toHaveBeenCalled();
  });
});

// ─── toMillis helper ──────────────────────────────────────────────

describe('toMillis', () => {
  const { toMillis } = ageVerificationAuditReconcile;

  test('returns numbers unchanged when finite', () => {
    expect(toMillis(1777896000000)).toBe(1777896000000);
    expect(toMillis(0)).toBe(0);
  });

  test('returns null for non-finite numbers', () => {
    expect(toMillis(NaN)).toBeNull();
    expect(toMillis(Infinity)).toBeNull();
  });

  test('calls .toMillis() on Firestore-Timestamp-like objects', () => {
    expect(toMillis({ toMillis: () => 1234567890 })).toBe(1234567890);
  });

  test('returns null when .toMillis() returns a non-finite value', () => {
    expect(toMillis({ toMillis: () => NaN })).toBeNull();
  });

  test('coerces { seconds, nanoseconds } to ms', () => {
    expect(toMillis({ seconds: 1777896, nanoseconds: 500_000_000 })).toBe(1777896 * 1000 + 500);
  });

  test('returns null for unknown shapes', () => {
    expect(toMillis(null)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis('1777896000000')).toBeNull();
    expect(toMillis({})).toBeNull();
  });
});

// ─── Internal helper exports ──────────────────────────────────────

describe('exports', () => {
  test('exposes constants for the cron registration site to schedule a window-aware run', () => {
    expect(ageVerificationAuditReconcile.SCAN_WINDOW_MS).toBe(7 * 86_400_000);
    expect(ageVerificationAuditReconcile.STATUS_ACTION_MAP.approved).toBe(
      'age_verification_approved',
    );
    expect(ageVerificationAuditReconcile.STATUS_ACTION_MAP.rejected).toBe(
      'age_verification_rejected',
    );
    expect(ageVerificationAuditReconcile.STATUS_ACTION_MAP['modify-dob']).toBe(
      'age_verification_dob_modified',
    );
    // The status string actually written by the route handler.
    expect(ageVerificationAuditReconcile.STATUS_ACTION_MAP.dob_modified).toBe(
      'age_verification_dob_modified',
    );
  });

  test('exposes toMillis for callers that need to coerce timestamp shapes', () => {
    expect(typeof ageVerificationAuditReconcile.toMillis).toBe('function');
  });
});
