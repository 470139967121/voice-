const router = require('express').Router();
const crypto = require('node:crypto');
const { authMiddlewareStrict } = require('../middleware/auth');
const { db, auth } = require('../utils/firebase');
const log = require('../utils/log');
const { sendEmail } = require('../utils/email');
const { buildOtpEmail } = require('../utils/email-templates');
const { encryptSecret, decryptSecret } = require('../utils/totp-crypto');
const { generateSecret, generateURI, verifySync } = require('otplib/functional');
const { NobleCryptoPlugin } = require('@otplib/plugin-crypto-noble');
const { ScureBase32Plugin } = require('@otplib/plugin-base32-scure');

// Instantiate otplib plugins once at module load
const otplibPlugins = { crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() };

// All portal routes use authMiddlewareStrict except totp-recovery (unauthenticated)
// Individual endpoints will be added in subsequent tasks

// Avatar URLs must be served from our CDN or localhost (local dev)
const TRUSTED_AVATAR_HOSTS = ['images.shytalk.shyden.co.uk', 'localhost', '127.0.0.1'];

const SUSPENSION_REASONS_ALLOWLIST = [
  'Spamming',
  'Harassment',
  'Inappropriate content',
  'Ban evasion',
  'Terms violation',
  'Other',
];

const TOTP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * GET /portal/me — Returns the authenticated user's portal-relevant data.
 *
 * This is the main portal entry point. Every portal page load calls this
 * endpoint first. It determines what the user sees (dashboard, TOTP prompt,
 * enrollment, suspension screen, or "download the app").
 */
router.get('/portal/me', authMiddlewareStrict, async (req, res) => {
  try {
    const { uniqueId, token } = req.auth;

    // 1. Read user doc from Firestore
    const userSnap = await db.doc('users/' + uniqueId).get();

    // 2. If user doc doesn't exist → 404
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userSnap.data();

    // 3. Avatar URL validation: only allow trusted domains
    let avatarUrl = userData.avatarUrl || null;
    if (avatarUrl && !TRUSTED_AVATAR_HOSTS.some((host) => avatarUrl.includes(host))) {
      avatarUrl = null;
    }

    // 4. Suspension reason sanitization
    let suspensionReason = userData.suspensionReason || null;
    if (suspensionReason && !SUSPENSION_REASONS_ALLOWLIST.includes(suspensionReason)) {
      suspensionReason = null;
    }

    // 5. Convert suspensionEndDate to ISO string
    let suspensionEndDate = null;
    if (userData.suspensionEndDate) {
      if (typeof userData.suspensionEndDate.toDate === 'function') {
        // Firestore Timestamp
        suspensionEndDate = userData.suspensionEndDate.toDate().toISOString();
      } else if (userData.suspensionEndDate instanceof Date) {
        suspensionEndDate = userData.suspensionEndDate.toISOString();
      } else if (typeof userData.suspensionEndDate === 'string') {
        suspensionEndDate = userData.suspensionEndDate;
      }
    }

    // 6. Suspension check first — return early with suspension data
    //    (do NOT check TOTP — suspension takes precedence so user can see appeal screen)
    if (userData.isSuspended) {
      return res.status(200).json({
        uniqueId,
        displayName: userData.displayName || '',
        avatarUrl,
        userType: userData.userType || 'MEMBER',
        isAdmin: token.admin === true,
        isSuspended: true,
        suspensionReason,
        suspensionEndDate,
        totpEnrolled: false, // Don't reveal TOTP status for suspended users
      });
    }

    // 7. Read TOTP doc
    const totpSnap = await db.doc('users/' + uniqueId + '/private/totp').get();
    const totpEnrolled = totpSnap.exists;

    // 8. TOTP enforcement for password users
    const signInProvider = token.firebase?.sign_in_provider;
    if (signInProvider === 'password' && totpEnrolled) {
      if (!token.totpVerified) {
        // Not verified at all
        return res.status(403).json({ error: 'MFA required' });
      }

      // Check if totpVerifiedAt is missing or expired (> 24h)
      const totpVerifiedAt = token.totpVerifiedAt;
      if (!totpVerifiedAt || Date.now() - totpVerifiedAt > TOTP_MAX_AGE_MS) {
        // Clear the expired claim
        try {
          const userRecord = await auth.getUser(req.auth.uid);
          const existingClaims = userRecord.customClaims || {};
          await auth.setCustomUserClaims(req.auth.uid, {
            ...existingClaims,
            totpVerified: false,
            totpVerifiedAt: null,
          });
        } catch (err) {
          log.error('portal', 'Failed to clear expired TOTP claims', { error: err.message });
        }
        return res.status(403).json({ error: 'Re-verify TOTP' });
      }
    }

    // 9. Return success response
    return res.status(200).json({
      uniqueId,
      displayName: userData.displayName || '',
      avatarUrl,
      userType: userData.userType || 'MEMBER',
      isAdmin: token.admin === true,
      isSuspended: false,
      suspensionReason: null,
      suspensionEndDate: null,
      totpEnrolled,
    });
  } catch (err) {
    log.error('portal', 'GET /portal/me failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /portal/totp/setup — Begin TOTP enrollment.
 *
 * Generates a TOTP secret, stores it encrypted in a pending doc,
 * and returns the secret + otpauth URI for QR code rendering.
 * Password provider only. Overwrites any existing pending doc (page refresh).
 */
router.post('/portal/totp/setup', authMiddlewareStrict, async (req, res) => {
  try {
    const { uniqueId, token } = req.auth;

    // 1. Verify password provider
    if (token.firebase?.sign_in_provider !== 'password') {
      return res.status(400).json({ error: 'Password provider required' });
    }

    // 2. Check if already enrolled
    const totpSnap = await db.doc(`users/${uniqueId}/private/totp`).get();
    if (totpSnap.exists) {
      return res.status(409).json({ error: 'Already enrolled' });
    }

    // 3. Generate TOTP secret (length: 20 bytes → 32 BASE32 chars)
    const secret = generateSecret({ length: 20, ...otplibPlugins });

    // 4. Generate otpauth URI (email is URI-encoded in the label by generateURI)
    const userEmail = token.email || '';
    const qrCodeUrl = generateURI({
      issuer: 'ShyTalk',
      label: userEmail,
      secret,
      type: 'totp',
    });

    // 5. Encrypt the secret
    const encryptedSecret = encryptSecret(secret);

    // 6. Store in totp-pending (overwrites if already exists — handles page refresh)
    await db.doc(`users/${uniqueId}/private/totp-pending`).set({
      encryptedSecret,
      expiresAt: Date.now() + 600000, // 10 minutes
      attempts: 0,
    });

    // 7. Return secret and QR code URL
    return res.status(200).json({ secret, qrCodeUrl });
  } catch (err) {
    log.error('portal', 'POST /portal/totp/setup failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /portal/totp/confirm-setup — Confirm TOTP enrollment with a code.
 *
 * Validates the TOTP code against the pending secret, then promotes
 * the secret to permanent storage and sets MFA claims.
 */
router.post('/portal/totp/confirm-setup', authMiddlewareStrict, async (req, res) => {
  try {
    const { uniqueId, uid } = req.auth;
    const { code } = req.body || {};

    // 1. Validate code format: must be exactly 6 digits
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Code must be exactly 6 digits' });
    }

    // 2. Read pending doc
    const pendingSnap = await db.doc(`users/${uniqueId}/private/totp-pending`).get();
    if (!pendingSnap.exists) {
      return res.status(400).json({ error: 'No pending setup session' });
    }

    const pendingData = pendingSnap.data();

    // 3. Check expiry
    if (pendingData.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'Setup session expired' });
    }

    // 4. Check attempts (BEFORE incrementing)
    if (pendingData.attempts >= 5) {
      return res.status(429).json({ error: 'Too many attempts' });
    }

    // 5. Increment attempts
    await db.doc(`users/${uniqueId}/private/totp-pending`).set({
      ...pendingData,
      attempts: pendingData.attempts + 1,
    });

    // 6. Decrypt the secret
    const secret = decryptSecret(pendingData.encryptedSecret);

    // 9. Replay prevention: check if this code was just used
    const totpSnap = await db.doc(`users/${uniqueId}/private/totp`).get();
    if (totpSnap.exists) {
      const totpData = totpSnap.data();
      if (
        totpData.lastUsedCode === code &&
        totpData.lastUsedAt &&
        Date.now() - totpData.lastUsedAt < 30000
      ) {
        return res.status(401).json({ error: 'Code already used' });
      }
    }

    // 7. Verify code
    const result = verifySync({ token: code, secret, ...otplibPlugins });
    if (!result.valid) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    // 10. If valid: store permanent doc, delete pending, set claims, revoke tokens
    const freshEncryptedSecret = encryptSecret(secret);

    await db.doc(`users/${uniqueId}/private/totp`).set({
      encryptedSecret: freshEncryptedSecret,
      createdAt: Date.now(),
      lastUsedCode: code,
      lastUsedAt: Date.now(),
    });

    await db.doc(`users/${uniqueId}/private/totp-pending`).delete();

    const userRecord = await auth.getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    await auth.setCustomUserClaims(uid, {
      ...existingClaims,
      totpVerified: true,
      totpVerifiedAt: Date.now(),
    });

    await auth.revokeRefreshTokens(uid);

    return res.status(200).json({ success: true });
  } catch (err) {
    log.error('portal', 'POST /portal/totp/confirm-setup failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /portal/totp/verify — Verify TOTP code after sign-in.
 *
 * Called when a password user with TOTP enrolled signs in and needs
 * to prove possession of their authenticator app. On success, sets
 * the totpVerified custom claim so portal/me returns full dashboard data.
 */
router.post('/portal/totp/verify', authMiddlewareStrict, async (req, res) => {
  try {
    const { uniqueId, uid, token } = req.auth;
    const { code } = req.body || {};

    // 1. Validate code format: must be exactly 6 digits
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Code must be exactly 6 digits' });
    }

    // 2. Verify password provider
    if (token.firebase?.sign_in_provider !== 'password') {
      return res.status(400).json({ error: 'Password provider required' });
    }

    // 3. Read TOTP doc — must exist (user must be enrolled)
    const totpSnap = await db.doc(`users/${uniqueId}/private/totp`).get();
    if (!totpSnap.exists) {
      return res.status(403).json({ error: 'TOTP not enrolled' });
    }

    const totpData = totpSnap.data();

    // 4. Replay prevention: same code within 30s window
    if (
      totpData.lastUsedCode === code &&
      totpData.lastUsedAt &&
      Date.now() - totpData.lastUsedAt < 30000
    ) {
      return res.status(401).json({ error: 'Code already used' });
    }

    // 5. Decrypt secret
    const secret = decryptSecret(totpData.encryptedSecret);

    // 6. Verify code with otplib
    const result = verifySync({ token: code, secret, ...otplibPlugins });
    if (!result.valid) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    // 7. Update TOTP doc with lastUsedCode/lastUsedAt
    await db.doc(`users/${uniqueId}/private/totp`).set({
      ...totpData,
      lastUsedCode: code,
      lastUsedAt: Date.now(),
    });

    // 8. Set totpVerified claim, preserving existing claims
    const userRecord = await auth.getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    await auth.setCustomUserClaims(uid, {
      ...existingClaims,
      totpVerified: true,
      totpVerifiedAt: Date.now(),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    log.error('portal', 'POST /portal/totp/verify failed', { error: err.message });
    return res.status(503).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /portal/totp — Remove TOTP enrollment (re-enrollment flow).
 *
 * A logged-in user who wants to switch their authenticator app. Requires
 * verifying their current TOTP code first. On success, deletes the TOTP doc,
 * clears the totpVerified claim, and revokes all refresh tokens so the user
 * must re-authenticate and re-enroll.
 */
router.delete('/portal/totp', authMiddlewareStrict, async (req, res) => {
  try {
    const { uniqueId, uid } = req.auth;
    const { totpCode } = req.body || {};

    // 1. Validate totpCode: must be exactly 6 digits
    if (!totpCode || typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) {
      return res.status(400).json({ error: 'Code must be exactly 6 digits' });
    }

    // 2. Read TOTP doc — must exist (user must be enrolled)
    const totpSnap = await db.doc(`users/${uniqueId}/private/totp`).get();
    if (!totpSnap.exists) {
      return res.status(403).json({ error: 'TOTP not enrolled' });
    }

    const totpData = totpSnap.data();

    // 3. Replay prevention: same code within 30s window
    if (
      totpData.lastUsedCode === totpCode &&
      totpData.lastUsedAt &&
      Date.now() - totpData.lastUsedAt < 30000
    ) {
      return res.status(401).json({ error: 'Code already used' });
    }

    // 4. Decrypt secret and verify code with otplib
    const secret = decryptSecret(totpData.encryptedSecret);
    const result = verifySync({ token: totpCode, secret, ...otplibPlugins });
    if (!result.valid) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    // 5. Delete private/totp
    await db.doc(`users/${uniqueId}/private/totp`).delete();

    // 6. Delete private/totp-pending (cleanup, if exists)
    await db.doc(`users/${uniqueId}/private/totp-pending`).delete();

    // 7. Clear totpVerified claim while preserving other claims (e.g. admin)
    const userRecord = await auth.getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    await auth.setCustomUserClaims(uid, {
      ...existingClaims,
      totpVerified: false,
      totpVerifiedAt: null,
    });

    // 8. Revoke all refresh tokens
    await auth.revokeRefreshTokens(uid);

    return res.status(200).json({ success: true });
  } catch (err) {
    log.error('portal', 'DELETE /portal/totp failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /portal/sign-out — Server-side sign-out.
 *
 * Clears the TOTP session claim and revokes all refresh tokens so the
 * client is fully signed out. Other custom claims (e.g. admin) are preserved.
 */
router.post('/portal/sign-out', authMiddlewareStrict, async (req, res) => {
  try {
    const { uid } = req.auth;

    // 1. Get existing claims
    const userRecord = await auth.getUser(uid);
    const existingClaims = userRecord.customClaims || {};

    // 2. Clear TOTP claims while preserving others
    await auth.setCustomUserClaims(uid, {
      ...existingClaims,
      totpVerified: false,
      totpVerifiedAt: null,
    });

    // 3. Revoke all refresh tokens
    await auth.revokeRefreshTokens(uid);

    return res.status(200).json({ success: true });
  } catch (err) {
    log.error('portal', 'POST /portal/sign-out failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /portal/revoke-all-sessions — Sign out of all devices.
 *
 * Password users must provide their current TOTP code to prevent
 * unauthorised session revocation with a stolen token.
 * OAuth users bypass TOTP (their provider handles 2FA).
 */
router.post('/portal/revoke-all-sessions', authMiddlewareStrict, async (req, res) => {
  try {
    const { uniqueId, uid, token } = req.auth;
    const { totpCode } = req.body || {};

    const isPasswordUser = token.firebase?.sign_in_provider === 'password';

    if (isPasswordUser) {
      // 1. Validate totpCode format: must be exactly 6 digits
      if (!totpCode || typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) {
        return res.status(400).json({ error: 'Code must be exactly 6 digits' });
      }

      // 2. Read TOTP doc — must exist (user must be enrolled)
      const totpSnap = await db.doc(`users/${uniqueId}/private/totp`).get();
      if (!totpSnap.exists) {
        return res.status(403).json({ error: 'TOTP not enrolled' });
      }

      const totpData = totpSnap.data();

      // 3. Replay prevention: same code within 30s window
      if (
        totpData.lastUsedCode === totpCode &&
        totpData.lastUsedAt &&
        Date.now() - totpData.lastUsedAt < 30000
      ) {
        return res.status(401).json({ error: 'Code already used' });
      }

      // 4. Decrypt secret and verify code
      const secret = decryptSecret(totpData.encryptedSecret);
      const result = verifySync({ token: totpCode, secret, ...otplibPlugins });
      if (!result.valid) {
        return res.status(401).json({ error: 'Invalid code' });
      }
    }

    // 5. Clear TOTP claims (preserve admin etc.)
    const userRecord = await auth.getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    await auth.setCustomUserClaims(uid, {
      ...existingClaims,
      totpVerified: false,
      totpVerifiedAt: null,
    });

    // 6. Revoke all refresh tokens
    await auth.revokeRefreshTokens(uid);

    return res.status(200).json({ success: true });
  } catch (err) {
    log.error('portal', 'POST /portal/revoke-all-sessions failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// TOTP Recovery Routes (UNAUTHENTICATED)
// ═══════════════════════════════════════════════════════════════════

const RECOVERY_OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const RECOVERY_MAX_ATTEMPTS = 3;

function generateRecoveryOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * POST /portal/totp-recovery/send — Send a recovery OTP to email.
 *
 * UNAUTHENTICATED. For users who have lost their TOTP device.
 * Always returns 200 regardless of whether the email exists or TOTP
 * is enrolled (anti-enumeration).
 */
router.post('/portal/totp-recovery/send', async (req, res) => {
  try {
    const { email } = req.body || {};

    // 1. Validate email field
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // 2. Validate email length
    if (email.trim().length > 254) {
      return res.status(400).json({ error: 'Email is too long' });
    }

    // 3. Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // 4. Look up Firebase user by email
    let firebaseUser;
    try {
      firebaseUser = await auth.getUserByEmail(normalizedEmail);
    } catch (_err) {
      // User not found → return 200 (anti-enumeration)
      return res.status(200).json({ message: 'Recovery code sent' });
    }

    // 5. Check if user has password provider
    const providers = (firebaseUser.providerData || []).map((p) => p.providerId);
    if (!providers.includes('password')) {
      // No password provider → return 200 (same response, no email sent)
      return res.status(200).json({ message: 'Recovery code sent' });
    }

    // 6. Resolve uniqueId from Firebase UID
    const snap = await db
      .collection('users')
      .where('firebaseUid', '==', firebaseUser.uid)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(200).json({ message: 'Recovery code sent' });
    }

    const uniqueId = snap.docs[0].data().uniqueId;

    // 7. Check if TOTP is enrolled
    const totpSnap = await db.doc(`users/${uniqueId}/private/totp`).get();
    if (!totpSnap.exists) {
      return res.status(200).json({ message: 'Recovery code sent' });
    }

    // 8. Generate OTP and store recovery code
    const code = generateRecoveryOtp();
    await db.doc(`totpRecoveryCodes/${normalizedEmail}`).set({
      code,
      expiresAt: Date.now() + RECOVERY_OTP_EXPIRY_MS,
      attempts: 0,
    });

    // 9. Send email with recovery code
    const template = buildOtpEmail(code);
    await sendEmail(normalizedEmail, template.subject, template.html);

    // 10. Return success
    return res.status(200).json({ message: 'Recovery code sent' });
  } catch (err) {
    log.error('portal', 'POST /portal/totp-recovery/send failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /portal/totp-recovery/verify — Verify recovery OTP and remove TOTP.
 *
 * UNAUTHENTICATED. On success, removes TOTP enrollment so the user
 * can sign in with just their password and re-enroll.
 */
router.post('/portal/totp-recovery/verify', async (req, res) => {
  try {
    const { email, code } = req.body || {};

    // 1. Validate fields
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({ error: 'Code is required' });
    }

    // 2. Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // 3. Read recovery code doc
    const recoveryRef = db.doc(`totpRecoveryCodes/${normalizedEmail}`);
    const recoverySnap = await recoveryRef.get();

    if (!recoverySnap.exists) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const recoveryData = recoverySnap.data();

    // 4. Check expiry
    if (recoveryData.expiresAt < Date.now()) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    // 5. Check attempts (rate limit per code)
    if (recoveryData.attempts >= RECOVERY_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many attempts' });
    }

    // 6. Increment attempts
    await recoveryRef.set({
      ...recoveryData,
      attempts: recoveryData.attempts + 1,
    });

    // 7. Check code
    if (recoveryData.code !== code) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    // 8. Code matches — consume it
    await recoveryRef.delete();

    // 9. Look up Firebase user by email
    const firebaseUser = await auth.getUserByEmail(normalizedEmail);

    // 10. Resolve uniqueId from Firebase UID
    const snap = await db
      .collection('users')
      .where('firebaseUid', '==', firebaseUser.uid)
      .limit(1)
      .get();

    if (!snap.empty) {
      const uniqueId = snap.docs[0].data().uniqueId;

      // 11. Delete TOTP enrollment
      await db.doc(`users/${uniqueId}/private/totp`).delete();

      // 12. Delete pending TOTP (cleanup)
      await db.doc(`users/${uniqueId}/private/totp-pending`).delete();
    }

    // 13. Revoke all refresh tokens
    await auth.revokeRefreshTokens(firebaseUser.uid);

    // 14. Return success
    return res.status(200).json({
      success: true,
      message: 'Authenticator removed. Sign in and set up a new one.',
    });
  } catch (err) {
    log.error('portal', 'POST /portal/totp-recovery/verify failed', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
