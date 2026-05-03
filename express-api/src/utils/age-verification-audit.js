/**
 * Audit-log helper for the three age-verification admin decisions
 * (approve / reject / dob-modify).
 *
 * Schema lives in `tests/utils/age-verification-audit.test.js`. The
 * helper exists so callers (admin routes added in PR 4) write the
 * exact same shape every time — drift between the three call sites
 * is the failure mode this guards against.
 *
 * Image / submission contents are NEVER passed in. The user spec
 * required image deletion on decision; only metadata is persisted.
 * The helper signatures only accept the named typed params below;
 * extra fields on the input object are silently ignored (pinned by
 * the "unknown fields ignored" test) so a caller cannot inject
 * `imageUrl` / `imageBase64` / etc. via a stray spread.
 *
 * IMPORTANT — callers MUST `await` these helpers. Each returns the
 * Firestore `add()` Promise so a write failure (rules violation,
 * network drop) propagates to the caller. Unhandled rejection means
 * "decision made but audit not written" — a compliance gap. The
 * helpers also `.catch()` and re-throw with a logger entry so a
 * silent Firestore failure surfaces in pm2 logs even if a caller
 * forgets the await chain.
 */

const log = require('./log');
const { now } = require('./helpers');

const APPROVED = 'age_verification_approved';
const REJECTED = 'age_verification_rejected';
const DOB_MODIFIED = 'age_verification_dob_modified';

const AGE_VERIFICATION_ACTIONS = Object.freeze({
  APPROVED,
  REJECTED,
  DOB_MODIFIED,
});

const APPROVED_METHODS = ['passport', 'drivers-license', 'national-id'];

// Lower bound: 1900-01-01 (oldest plausible DOB for a living user).
// Upper bound: now (DOB cannot be in the future). The wider ms epoch
// range allows distant-past / distant-future values that no real
// user would have, masking mis-typed inputs as data instead of
// surfacing them as errors. Reject anything outside.
const MIN_PLAUSIBLE_DOB_MS = -2208988800000; // 1900-01-01T00:00:00Z

function requireNonBlankString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`age-verification-audit: ${name} must be a non-blank string`);
  }
}

function requirePositiveInteger(value, name) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`age-verification-audit: ${name} must be a positive integer`);
  }
}

function requirePlausibleDob(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`age-verification-audit: ${name} must be a number (ms epoch)`);
  }
  if (value < MIN_PLAUSIBLE_DOB_MS) {
    throw new Error(`age-verification-audit: ${name} predates 1900 — implausible`);
  }
  if (value > now()) {
    throw new Error(`age-verification-audit: ${name} is in the future — implausible`);
  }
}

function writeEntry(db, action, adminUid, targetUserId, details) {
  requirePositiveInteger(adminUid, 'adminUid');
  requireNonBlankString(targetUserId, 'targetUserId');
  const entry = {
    adminUid,
    action,
    actionType: action,
    targetType: 'user',
    targetId: targetUserId,
    details,
    timestamp: now(),
  };
  return db
    .collection('auditLog')
    .add(entry)
    .catch((err) => {
      // Surface in pm2 logs even if a caller forgets to await — a
      // silent Firestore-rules / network failure here is a
      // compliance gap (decision made, audit not written).
      log.error('age-verification-audit', 'Failed to write audit entry', {
        action,
        targetId: targetUserId,
        error: err?.message,
      });
      throw err; // re-throw so awaiting callers still see the failure
    });
}

/**
 * @param {Object} db Firestore database instance.
 * @param {Object} params
 * @param {number} params.adminUid Admin's uniqueId (positive integer).
 * @param {string} params.targetUserId Target user's uniqueId, stringified.
 * @param {('passport'|'drivers-license'|'national-id')} params.method
 * @returns {Promise} Caller MUST await — see file header.
 */
async function logVerificationApproved(db, { adminUid, targetUserId, method }) {
  if (!APPROVED_METHODS.includes(method)) {
    throw new Error(
      `age-verification-audit: method must be one of ${APPROVED_METHODS.join(', ')}; got "${method}"`,
    );
  }
  return writeEntry(db, APPROVED, adminUid, targetUserId, { method });
}

/**
 * @param {Object} db
 * @param {Object} params
 * @param {number} params.adminUid
 * @param {string} params.targetUserId
 * @param {string} params.reason Non-blank justification (admin policy).
 * @returns {Promise} Caller MUST await.
 */
async function logVerificationRejected(db, { adminUid, targetUserId, reason }) {
  requireNonBlankString(reason, 'reason');
  return writeEntry(db, REJECTED, adminUid, targetUserId, { reason });
}

/**
 * @param {Object} db
 * @param {Object} params
 * @param {number} params.adminUid
 * @param {string} params.targetUserId
 * @param {number|null} params.oldDob ms epoch, or null for legacy users with no prior DOB.
 * @param {number} params.newDob ms epoch, must be plausible (1900 <= dob <= now).
 * @param {string} params.reason
 * @returns {Promise} Caller MUST await.
 */
async function logVerificationDobModified(db, { adminUid, targetUserId, oldDob, newDob, reason }) {
  if (oldDob !== null) requirePlausibleDob(oldDob, 'oldDob');
  requirePlausibleDob(newDob, 'newDob');
  requireNonBlankString(reason, 'reason');
  return writeEntry(db, DOB_MODIFIED, adminUid, targetUserId, {
    oldDob,
    newDob,
    reason,
  });
}

module.exports = {
  AGE_VERIFICATION_ACTIONS,
  // Re-exported so route handlers can validate DOB bounds BEFORE
  // committing the decision transaction. Catching an out-of-range
  // DOB at the audit-write stage means the user doc is already
  // mutated with the bogus value (silent-failure-hunter HIGH on PR
  // #446). Routes call this up-front instead.
  requirePlausibleDob,
  logVerificationApproved,
  logVerificationRejected,
  logVerificationDobModified,
};
