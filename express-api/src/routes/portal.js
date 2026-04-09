const router = require('express').Router();
const { authMiddlewareStrict } = require('../middleware/auth');
const { db, auth } = require('../utils/firebase');
const log = require('../utils/log');

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

module.exports = router;
