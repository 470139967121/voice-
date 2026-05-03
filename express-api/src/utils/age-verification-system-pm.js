/**
 * System-PM templates for the three age-verification decision
 * outcomes. Wraps `system-pm.sendSystemPm` so admin-route handlers
 * have one call site per outcome and the message copy lives in one
 * file (easier review, easier i18n in PR 13).
 *
 * Templates use a `{token}` placeholder shape so PR 13's i18n pass
 * only swaps the lookup table — no refactor of the call sites or the
 * helper signatures.
 *
 * Sanitisation: admin-supplied `reason` text is echoed into the PM
 * body. We strip `<` / `>` / `&` characters at template-render time
 * to defend against any current or future client renderer that
 * interprets the text as HTML. Compose / iOS today render as plain
 * text (safe), but the web inbox / future admin-replay surface is an
 * unknown — sanitising once at the source is cheaper than trusting
 * every renderer.
 *
 * Lock-bypass: `sendSystemPm` writes via firebase-admin
 * (`db.doc(...).set(...)`), which bypasses Firestore rules. So the
 * "your PMs are locked" PM in the under-18 variant DOES land in the
 * user's inbox even after PR 11's rules-level lock. Pin this property
 * with a test in PR 11.
 */

const { sendSystemPm } = require('./system-pm');

const FRIENDLY_METHOD_LABEL = Object.freeze({
  passport: 'passport',
  'drivers-license': "driver's licence",
  'national-id': 'national ID card',
});

const TEMPLATES = Object.freeze({
  approved: [
    "Your age verification has been approved. We confirmed your {method} and you now have full access to ShyTalk's 18+ features (private messages and gacha).",
    '',
    'Your ID image has been deleted from our servers. Welcome aboard.',
  ].join('\n'),
  rejected: [
    "Your age verification wasn't approved this time.",
    '',
    'Reason: {reason}',
    '',
    'You can submit a new ID image any time from your profile. Your previous image has been deleted from our servers.',
  ].join('\n'),
  dobModifiedApproved: [
    "An admin has updated your date of birth on file based on the ID you submitted ({method}). Your account is approved for ShyTalk's 18+ features (private messages and gacha).",
    '',
    'Reason for the change: {reason}',
    '',
    'Your ID image has been deleted from our servers.',
  ].join('\n'),
  dobModifiedUnder18: [
    "An admin has adjusted your date of birth on file based on the ID you submitted, and you are under 18. We're keeping you on ShyTalk, but the 18+ features (private messages and gacha) are no longer available to you. Existing private-message threads have been locked.",
    '',
    'Reason for the change: {reason}',
    '',
    "Once you turn 18, full access will be restored automatically. Your ID image has been deleted from our servers. If you believe the date of birth on file is wrong, please contact support — don't submit another ID until you've spoken to us.",
  ].join('\n'),
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

/**
 * Strip the three characters that turn plain text into HTML / entity-
 * encoded markup if a downstream renderer treats the text as HTML.
 * Replaces with a space so word boundaries survive the sanitise.
 */
function sanitiseReason(raw) {
  return raw.replace(/[<>&]/g, ' ');
}

function interpolate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      throw new Error(`age-verification-system-pm: missing template var "${key}"`);
    }
    return vars[key];
  });
}

async function sendAgeVerificationApprovedPm(uid, method) {
  const text = interpolate(TEMPLATES.approved, { method: friendlyMethod(method) });
  return sendSystemPm(uid, text);
}

async function sendAgeVerificationRejectedPm(uid, reason) {
  requireNonBlankReason(reason);
  const text = interpolate(TEMPLATES.rejected, { reason: sanitiseReason(reason) });
  return sendSystemPm(uid, text);
}

async function sendAgeVerificationDobModifiedPm(uid, { ageVerified, method, reason }) {
  requireNonBlankReason(reason);
  // method is informational here — only used in the approved variant
  // copy. We still validate it through `friendlyMethod` to keep the
  // input contract symmetric with the other helpers.
  const label = friendlyMethod(method);
  const safeReason = sanitiseReason(reason);
  const template = ageVerified ? TEMPLATES.dobModifiedApproved : TEMPLATES.dobModifiedUnder18;
  // Both templates accept `{reason}`; only the approved variant uses
  // `{method}`. Pass both so the under-18 template can ignore method
  // without the interpolator throwing.
  const text = interpolate(template, { method: label, reason: safeReason });
  return sendSystemPm(uid, text);
}

module.exports = {
  FRIENDLY_METHOD_LABEL,
  TEMPLATES,
  sanitiseReason,
  interpolate,
  sendAgeVerificationApprovedPm,
  sendAgeVerificationRejectedPm,
  sendAgeVerificationDobModifiedPm,
};
