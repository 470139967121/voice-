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
 */

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

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`age-verification-audit: ${name} is required`);
  }
}

function requireNonBlankString(value, name) {
  requireString(value, name);
  if (value.trim().length === 0) {
    throw new Error(`age-verification-audit: ${name} must not be blank`);
  }
}

function requireNumber(value, name) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`age-verification-audit: ${name} is required`);
  }
}

function writeEntry(db, action, adminUid, targetUserId, details) {
  requireNumber(adminUid, 'adminUid');
  requireString(targetUserId, 'targetUserId');
  return db.collection('auditLog').add({
    adminUid,
    action,
    actionType: action,
    targetType: 'user',
    targetId: targetUserId,
    details,
    timestamp: now(),
  });
}

async function logVerificationApproved(db, { adminUid, targetUserId, method }) {
  if (!APPROVED_METHODS.includes(method)) {
    throw new Error(
      `age-verification-audit: method must be one of ${APPROVED_METHODS.join(', ')}; got "${method}"`,
    );
  }
  return writeEntry(db, APPROVED, adminUid, targetUserId, { method });
}

async function logVerificationRejected(db, { adminUid, targetUserId, reason }) {
  requireNonBlankString(reason, 'reason');
  return writeEntry(db, REJECTED, adminUid, targetUserId, { reason });
}

async function logVerificationDobModified(db, { adminUid, targetUserId, oldDob, newDob, reason }) {
  if (oldDob !== null) requireNumber(oldDob, 'oldDob');
  requireNumber(newDob, 'newDob');
  requireNonBlankString(reason, 'reason');
  return writeEntry(db, DOB_MODIFIED, adminUid, targetUserId, {
    oldDob,
    newDob,
    reason,
  });
}

module.exports = {
  AGE_VERIFICATION_ACTIONS,
  logVerificationApproved,
  logVerificationRejected,
  logVerificationDobModified,
};
