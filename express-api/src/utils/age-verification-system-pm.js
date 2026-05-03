/**
 * System-PM templates for the three age-verification decision
 * outcomes. Wraps `system-pm.sendSystemPm` so admin-route handlers
 * have one call site per outcome and the message copy lives in one
 * file (easier review, easier i18n in PR 13).
 *
 * i18n: English-only at this PR. PR 13 of the multi-PR plan adds the
 * 20 locales the rest of the app supports.
 */

const { sendSystemPm } = require('./system-pm');

const FRIENDLY_METHOD_LABEL = Object.freeze({
  passport: 'passport',
  'drivers-license': "driver's licence",
  'national-id': 'national ID card',
});

function friendlyMethod(method) {
  if (!Object.prototype.hasOwnProperty.call(FRIENDLY_METHOD_LABEL, method)) {
    throw new Error(
      `age-verification-system-pm: unknown method "${method}" — must be one of ${Object.keys(
        FRIENDLY_METHOD_LABEL,
      ).join(', ')}`,
    );
  }
  return FRIENDLY_METHOD_LABEL[method];
}

function requireNonBlankReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('age-verification-system-pm: reason must be a non-blank string');
  }
}

async function sendAgeVerificationApprovedPm(uid, method) {
  const label = friendlyMethod(method);
  const text = [
    `Your age verification has been approved. We confirmed your ${label} and you now have full access to ShyTalk's 18+ features (private messages and gacha).`,
    '',
    'Your ID image has been deleted from our servers. Welcome aboard.',
  ].join('\n');
  return sendSystemPm(uid, text);
}

async function sendAgeVerificationRejectedPm(uid, reason) {
  requireNonBlankReason(reason);
  const text = [
    "Your age verification wasn't approved this time.",
    '',
    `Reason: ${reason}`,
    '',
    'You can submit a new ID image any time from your profile. Your previous image has been deleted from our servers.',
  ].join('\n');
  return sendSystemPm(uid, text);
}

async function sendAgeVerificationDobModifiedPm(uid, { ageVerified, method, reason }) {
  requireNonBlankReason(reason);
  // method is informational here — only used in the approved variant.
  // We still validate it through `friendlyMethod` to keep the input
  // contract symmetric with the other helpers.
  const label = friendlyMethod(method);

  let text;
  if (ageVerified) {
    text = [
      `An admin has updated your date of birth on file based on the ID you submitted (${label}). Your account is approved for ShyTalk's 18+ features (private messages and gacha).`,
      '',
      `Reason for the change: ${reason}`,
      '',
      'Your ID image has been deleted from our servers.',
    ].join('\n');
  } else {
    text = [
      "An admin has adjusted your date of birth on file based on the ID you submitted, and you are under 18. We're keeping you on ShyTalk, but the 18+ features (private messages and gacha) are no longer available to you. Existing private-message threads have been locked.",
      '',
      `Reason for the change: ${reason}`,
      '',
      "Once you turn 18, full access will be restored automatically. Your ID image has been deleted from our servers. If you believe the date of birth on file is wrong, please contact support — don't submit another ID until you've spoken to us.",
    ].join('\n');
  }
  return sendSystemPm(uid, text);
}

module.exports = {
  FRIENDLY_METHOD_LABEL,
  sendAgeVerificationApprovedPm,
  sendAgeVerificationRejectedPm,
  sendAgeVerificationDobModifiedPm,
};
