/**
 * User-facing age-verification routes.
 *
 *   POST /api/age-verification/upload-url
 *     Body: { contentType: 'image/jpeg' | 'image/png' | 'image/webp' }
 *     Returns: { uploadUrl, r2Key, expiresInSec }
 *     Generates an R2 signed PUT URL the client can upload the ID
 *     image directly to. Path is forced under
 *     `age-verification/<uniqueId>/` so the server-side `submit`
 *     handler can re-validate ownership.
 *
 *   POST /api/age-verification/submit
 *     Body: { r2Key, idMethod }
 *     Returns: { submissionId, status: 'pending' }
 *     Creates a pending submission doc in
 *     `ageVerificationSubmissions/`. Admin reviews via the routes in
 *     PR 4b. Image is deleted on decision; only metadata persists.
 *
 * Server-side enforcement (in addition to client gates):
 *   - User must be 18+ on the DOB on file. 16-17-y/o cohort sees the
 *     "Contact support" copy; the API refuses regardless of client.
 *   - User must NOT already be verified.
 *   - Only one pending submission at a time (user spec).
 *   - Submitted r2Key MUST be under the user's prefix (defence vs a
 *     hand-rolled API call submitting someone else's image).
 *
 * No image content is read here — the upload happens client → R2
 * directly via the signed PUT URL. The handler only sees the R2 key.
 */

const express = require('express');
const router = express.Router();

const { db } = require('../utils/firebase');
const { getSignedPutUrl } = require('../utils/r2');
const { now, generateId } = require('../utils/helpers');
const log = require('../utils/log');

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_ID_METHODS = ['passport', 'drivers-license', 'national-id'];
const MIN_VERIFY_AGE_YEARS = 18;
const MS_PER_YEAR = 365.25 * 86400 * 1000;

function isAtLeast18(dateOfBirthMs) {
  if (typeof dateOfBirthMs !== 'number' || !Number.isFinite(dateOfBirthMs)) return false;
  return Date.now() - dateOfBirthMs >= MIN_VERIFY_AGE_YEARS * MS_PER_YEAR;
}

async function loadUserGate(uniqueId) {
  const docSnap = await db.doc(`users/${uniqueId}`).get();
  if (!docSnap.exists) {
    return { ok: false, status: 404, error: 'User not found' };
  }
  const data = docSnap.data();
  if (!isAtLeast18(data?.dateOfBirth)) {
    return {
      ok: false,
      status: 403,
      error:
        'Must be 18 or older to start age verification. If you believe this is wrong, contact support.',
    };
  }
  if (data?.ageVerified === true) {
    return { ok: false, status: 409, error: 'Account is already age-verified' };
  }
  return { ok: true };
}

router.post('/age-verification/upload-url', async (req, res) => {
  try {
    const { contentType } = req.body || {};
    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return res
        .status(400)
        .json({ error: 'contentType must be one of image/jpeg, image/png, image/webp' });
    }

    const gate = await loadUserGate(req.auth.uniqueId);
    if (!gate.ok) {
      return res.status(gate.status).json({ error: gate.error });
    }

    const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
    // Random component prevents an attacker who knows the user's
    // uniqueId from guessing past keys (R2 is bucket-private but the
    // signed URL flow returns the key — keep it unguessable).
    const r2Key = `age-verification/${req.auth.uniqueId}/${generateId()}.${ext}`;
    const uploadUrl = await getSignedPutUrl(r2Key, contentType);

    return res.json({ uploadUrl, r2Key, expiresInSec: 300 });
  } catch (err) {
    log.error('age-verification', 'upload-url failed', { error: err?.message });
    return res.status(500).json({ error: 'Failed to issue upload URL' });
  }
});

router.post('/age-verification/submit', async (req, res) => {
  try {
    const { r2Key, idMethod } = req.body || {};
    if (typeof r2Key !== 'string' || r2Key.length === 0) {
      return res.status(400).json({ error: 'r2Key is required' });
    }
    if (!ALLOWED_ID_METHODS.includes(idMethod)) {
      return res
        .status(400)
        .json({ error: `idMethod must be one of ${ALLOWED_ID_METHODS.join(', ')}` });
    }

    // Defence in depth: re-check the prefix even though the signed URL
    // would have forced it. A malicious client could call submit
    // directly with another user's key.
    const expectedPrefix = `age-verification/${req.auth.uniqueId}/`;
    if (!r2Key.startsWith(expectedPrefix)) {
      return res.status(403).json({ error: 'r2Key is not under your user prefix' });
    }

    const gate = await loadUserGate(req.auth.uniqueId);
    if (!gate.ok) {
      return res.status(gate.status).json({ error: gate.error });
    }

    // Only one pending submission at a time (user spec).
    const pendingSnap = await db
      .collection('ageVerificationSubmissions')
      .where('userId', '==', String(req.auth.uniqueId))
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!pendingSnap.empty) {
      return res
        .status(409)
        .json({ error: 'You already have a pending submission. Wait for the admin decision.' });
    }

    const ref = await db.collection('ageVerificationSubmissions').add({
      userId: String(req.auth.uniqueId),
      r2Key,
      idMethod,
      status: 'pending',
      submittedAt: now(),
    });

    log.info('age-verification', 'Submission created', {
      submissionId: ref.id,
      userId: req.auth.uniqueId,
      idMethod,
    });

    return res.json({ submissionId: ref.id, status: 'pending' });
  } catch (err) {
    log.error('age-verification', 'submit failed', { error: err?.message });
    return res.status(500).json({ error: 'Failed to record submission' });
  }
});

module.exports = router;
