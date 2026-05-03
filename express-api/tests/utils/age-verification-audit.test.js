/**
 * Tests for the age-verification audit-log helper. Three decision
 * shapes — approved / rejected / DOB-modified — each must produce an
 * auditLog entry with the contracted fields so the admin "audit
 * trail" tab can render them consistently with all other audit
 * actions (suggestion_merge, dispute_resolve, etc.).
 *
 * Schema (per `auditLog` collection):
 *   {
 *     adminUid:   number      // admin's uniqueId — NOT firebaseUid
 *     action:     string      // canonical action name (snake_case)
 *     actionType: string      // === action (legacy duplicate)
 *     targetType: 'user'      // verification always targets a user
 *     targetId:   string      // target user's uniqueId, stringified
 *     details:    object      // action-specific payload (see below)
 *     timestamp:  number      // ms epoch (from `now()`)
 *   }
 *
 * details payload per action:
 *   age_verification_approved   → { method: 'passport'|'drivers-license'|'national-id' }
 *   age_verification_rejected   → { reason: string }
 *   age_verification_dob_modified → { oldDob: number|null, newDob: number, reason: string }
 *
 * Image content is NEVER logged — the spec requires images to be
 * deleted on decision and only metadata persisted.
 */

const mockAdd = jest.fn().mockResolvedValue();
const mockCollection = jest.fn(() => ({ add: mockAdd }));

const fakeDb = {
  collection: mockCollection,
};

jest.mock('../../src/utils/helpers', () => ({
  now: () => 1709913600000,
}));

const {
  logVerificationApproved,
  logVerificationRejected,
  logVerificationDobModified,
  AGE_VERIFICATION_ACTIONS,
} = require('../../src/utils/age-verification-audit');

beforeEach(() => {
  mockAdd.mockClear();
  mockCollection.mockClear();
});

describe('AGE_VERIFICATION_ACTIONS constants', () => {
  test('exposes the three action names as snake_case strings', () => {
    expect(AGE_VERIFICATION_ACTIONS.APPROVED).toBe('age_verification_approved');
    expect(AGE_VERIFICATION_ACTIONS.REJECTED).toBe('age_verification_rejected');
    expect(AGE_VERIFICATION_ACTIONS.DOB_MODIFIED).toBe('age_verification_dob_modified');
  });
});

describe('logVerificationApproved', () => {
  test('writes a typed approval entry to auditLog', async () => {
    await logVerificationApproved(fakeDb, {
      adminUid: 10000001,
      targetUserId: '10000050',
      method: 'passport',
    });

    expect(mockCollection).toHaveBeenCalledWith('auditLog');
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith({
      adminUid: 10000001,
      action: 'age_verification_approved',
      actionType: 'age_verification_approved',
      targetType: 'user',
      targetId: '10000050',
      details: { method: 'passport' },
      timestamp: 1709913600000,
    });
  });

  test('rejects unknown method values', async () => {
    // Method must be one of the three approved id types — the admin
    // panel picks from a dropdown but a hand-rolled API call could
    // pass anything. Fail loudly so a stray value can't be persisted
    // to the auditLog (which is the source of truth for compliance
    // reviews).
    await expect(
      logVerificationApproved(fakeDb, {
        adminUid: 10000001,
        targetUserId: '10000050',
        method: 'birth-certificate',
      }),
    ).rejects.toThrow(/method/i);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('rejects missing required fields', async () => {
    await expect(logVerificationApproved(fakeDb, {})).rejects.toThrow();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('logVerificationRejected', () => {
  test('writes a typed rejection entry to auditLog', async () => {
    await logVerificationRejected(fakeDb, {
      adminUid: 10000001,
      targetUserId: '10000050',
      reason: 'Image was unreadable',
    });

    expect(mockAdd).toHaveBeenCalledWith({
      adminUid: 10000001,
      action: 'age_verification_rejected',
      actionType: 'age_verification_rejected',
      targetType: 'user',
      targetId: '10000050',
      details: { reason: 'Image was unreadable' },
      timestamp: 1709913600000,
    });
  });

  test('rejects an empty reason (admin must justify)', async () => {
    // The user spec explicitly required: "Yes reason is required".
    // A typed audit entry with an empty reason would let an admin
    // dodge the policy via API without going through the panel.
    await expect(
      logVerificationRejected(fakeDb, {
        adminUid: 10000001,
        targetUserId: '10000050',
        reason: '',
      }),
    ).rejects.toThrow(/reason/i);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('rejects whitespace-only reason', async () => {
    await expect(
      logVerificationRejected(fakeDb, {
        adminUid: 10000001,
        targetUserId: '10000050',
        reason: '   ',
      }),
    ).rejects.toThrow(/reason/i);
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('logVerificationDobModified', () => {
  test('writes a typed dob-modified entry with both old and new DOB', async () => {
    await logVerificationDobModified(fakeDb, {
      adminUid: 10000001,
      targetUserId: '10000050',
      oldDob: 946684800000, // 2000-01-01
      newDob: 978307200000, // 2001-01-01
      reason: 'User submitted ID with different DOB than profile',
    });

    expect(mockAdd).toHaveBeenCalledWith({
      adminUid: 10000001,
      action: 'age_verification_dob_modified',
      actionType: 'age_verification_dob_modified',
      targetType: 'user',
      targetId: '10000050',
      details: {
        oldDob: 946684800000,
        newDob: 978307200000,
        reason: 'User submitted ID with different DOB than profile',
      },
      timestamp: 1709913600000,
    });
  });

  test('accepts null oldDob (for users with no prior DOB on record)', async () => {
    // Legacy accounts predate the required-DOB enforcement and may
    // have null DOB. The audit entry should record the null
    // explicitly rather than omitting the field — preserves the
    // shape so a reader doesn't have to special-case missing keys.
    await logVerificationDobModified(fakeDb, {
      adminUid: 10000001,
      targetUserId: '10000050',
      oldDob: null,
      newDob: 978307200000,
      reason: 'First DOB recorded via verification',
    });

    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ oldDob: null }),
      }),
    );
  });

  test('rejects empty reason on DOB modification', async () => {
    await expect(
      logVerificationDobModified(fakeDb, {
        adminUid: 10000001,
        targetUserId: '10000050',
        oldDob: 946684800000,
        newDob: 978307200000,
        reason: '',
      }),
    ).rejects.toThrow(/reason/i);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('rejects when newDob is missing', async () => {
    await expect(
      logVerificationDobModified(fakeDb, {
        adminUid: 10000001,
        targetUserId: '10000050',
        oldDob: 946684800000,
        reason: 'Just changing it',
      }),
    ).rejects.toThrow();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
