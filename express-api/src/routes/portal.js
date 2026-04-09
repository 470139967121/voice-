const router = require('express').Router();
const { authMiddlewareStrict } = require('../middleware/auth');
const { db, auth } = require('../utils/firebase');
const log = require('../utils/log');
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

module.exports = router;
