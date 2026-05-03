/**
 * User-facing age-verification routes.
 *
 *   POST /api/age-verification/upload-url
 *     Body: { contentType: 'image/jpeg' | 'image/png' | 'image/webp' }
 *     Returns: { uploadUrl, r2Key, expiresInSec }
 *     Generates an R2 signed PUT URL the client uploads the ID image
 *     directly to. Path is forced under
 *     `age-verification/<uniqueId>/<random>.<ext>` so the server-side
 *     `submit` handler can re-validate ownership.
 *
 *   POST /api/age-verification/submit
 *     Body: { r2Key, idMethod }
 *     Returns: { submissionId, status: 'pending' }
 *     Creates a pending submission doc in
 *     `ageVerificationSubmissions/`. Admin reviews via routes shipped
 *     in PR 4b. The R2 image is deleted on admin decision (approve OR
 *     reject) — that responsibility lives in PR 4b's `r2.deleteObject`
 *     call inside the approve/reject handlers. This route's tests pin
 *     that the `r2Key` is preserved on the doc so 4b's handlers can
 *     find and delete it; that contract is intentionally NOT enforced
 *     here (no leak-risk test) because the deletion itself is in 4b.
 *
 * Server-side enforcement (in addition to client gates):
 *   - User must be 18+ on the DOB on file (calendar-aware comparison
 *     mirroring `isAtLeast16` in `shared/.../DateUtils.kt`). 16-17-y/o
 *     cohort sees the "Contact support" copy; the API refuses
 *     regardless of client.
 *   - User must NOT already be verified.
 *   - Only one pending submission at a time. Enforced atomically via
 *     a Firestore transaction (check-then-add was a TOCTOU race
 *     window; two concurrent submits could create two pending docs).
 *   - Submitted r2Key MUST be under the user's prefix AND must NOT
 *     contain `..` / `//` path-traversal segments (defence vs hand-
 *     rolled API caller smuggling another user's image).
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

/**
 * Calendar-aware "user is 18+" check, mirroring `isAtLeast16` in
 * `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/DateUtils.kt`.
 * Doing this with the `365.25 * MS_PER_DAY` approximation drifts the
 * 18th-birthday boundary by ~6 hours per leap window, which is exactly
 * the kind of off-by-one a user would hit on their actual birthday and
 * be told to "contact support" while the client says they're eligible.
 */
function isAtLeast18FromDob(dateOfBirthMs) {
  if (typeof dateOfBirthMs !== 'number' || !Number.isFinite(dateOfBirthMs)) return false;
  const today = new Date();
  const dob = new Date(dateOfBirthMs);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  if (
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= 18;
}

async function loadUserGate(uniqueId) {
  const docSnap = await db.doc(`users/${uniqueId}`).get();
  if (!docSnap.exists) {
    return { ok: false, status: 404, error: 'User not found' };
  }
  const data = docSnap.data();
  if (!isAtLeast18FromDob(data?.dateOfBirth)) {
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
  const errorId = 'AGE_VERIF_UPLOAD_URL';
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
    log.error('age-verification', `${errorId} failed`, {
      uid: req.auth?.uniqueId,
      error: err?.message,
    });
    return res.status(500).json({ error: 'Failed to issue upload URL', errorId });
  }
});

router.post('/age-verification/submit', async (req, res) => {
  const errorId = 'AGE_VERIF_SUBMIT';
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

    // Defence in depth on the R2 key:
    //  1. Must start with the caller's user prefix
    //  2. Must NOT contain `..` or `//` path-traversal sequences (the
    //     literal key would store as-is in R2, but downstream
    //     consumers — admin viewer, signed-GET, CDN — may normalise
    //     and resolve to another user's prefix).
    //  3. The portion after the prefix must be a single segment (no
    //     additional `/`) so a valid prefix can't be extended into
    //     another user's directory.
    const expectedPrefix = `age-verification/${req.auth.uniqueId}/`;
    if (
      !r2Key.startsWith(expectedPrefix) ||
      r2Key.includes('..') ||
      r2Key.includes('//') ||
      r2Key.slice(expectedPrefix.length).indexOf('/') !== -1
    ) {
      return res.status(403).json({ error: 'r2Key is not under your user prefix' });
    }

    const gate = await loadUserGate(req.auth.uniqueId);
    if (!gate.ok) {
      return res.status(gate.status).json({ error: gate.error });
    }

    // Atomic check-and-create — a transaction prevents the
    // check-then-add TOCTOU window where two concurrent submits
    // could both pass the empty check and create duplicate pending
    // docs. The query inside `runTransaction` is a snapshot read; if
    // a concurrent transaction commits a pending doc between the
    // read and the create, our transaction retries.
    const pendingQuery = db
      .collection('ageVerificationSubmissions')
      .where('userId', '==', String(req.auth.uniqueId))
      .where('status', '==', 'pending')
      .limit(1);
    const newDocRef = db.collection('ageVerificationSubmissions').doc();

    let conflict = false;
    await db.runTransaction(async (tx) => {
      const pendingSnap = await tx.get(pendingQuery);
      if (!pendingSnap.empty) {
        conflict = true;
        return;
      }
      tx.set(newDocRef, {
        userId: String(req.auth.uniqueId),
        r2Key,
        idMethod,
        status: 'pending',
        submittedAt: now(),
      });
    });

    if (conflict) {
      return res
        .status(409)
        .json({ error: 'You already have a pending submission. Wait for the admin decision.' });
    }

    log.info('age-verification', 'Submission created', {
      submissionId: newDocRef.id,
      userId: req.auth.uniqueId,
      idMethod,
    });

    return res.json({ submissionId: newDocRef.id, status: 'pending' });
  } catch (err) {
    log.error('age-verification', `${errorId} failed`, {
      uid: req.auth?.uniqueId,
      error: err?.message,
    });
    return res.status(500).json({ error: 'Failed to record submission', errorId });
  }
});

module.exports = router;
