/**
 * POST /api/users/:uniqueId/pm-lock-check
 *
 * First-of-day auto-unlock check (PR 11). Called by the client right
 * after successful sign-in. Reads the user doc, decides whether the
 * pmLocked state should change, and writes if yes — all server-side
 * because Firestore rules deny client writes to `pmLocked` /
 * `lastPmLockCheck`.
 *
 * Throttling: when `lastPmLockCheck` falls in the same UTC day as
 * `now()`, we skip the Firestore write entirely. Active users only
 * pay the cost once per day; dormant accounts pay nothing.
 *
 * Authorisation: the path uniqueId MUST match the caller's
 * `req.auth.uniqueId`. Defends against a malicious client trying to
 * trigger an unlock check on another user's behalf (would be moot
 * since rules deny direct writes anyway, but gate at the route layer
 * for defence in depth).
 */

const express = require('express');
const router = express.Router();

const { db } = require('../utils/firebase');
const { now } = require('../utils/helpers');
const log = require('../utils/log');

/** UTC midnight (start-of-day) for the timestamp `ms`. */
function utcDayStart(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isAtLeast18FromDob(dobMs, nowMs) {
  if (typeof dobMs !== 'number' || !Number.isFinite(dobMs)) return false;
  const today = new Date(nowMs);
  const dob = new Date(dobMs);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  if (
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= 18;
}

router.post('/users/:uniqueId/pm-lock-check', async (req, res) => {
  const pathUniqueId = parseInt(req.params.uniqueId, 10);
  if (!Number.isFinite(pathUniqueId) || pathUniqueId !== req.auth?.uniqueId) {
    return res.status(403).json({ error: 'You can only check your own pm-lock state' });
  }

  try {
    const nowMs = now();
    const todayStart = utcDayStart(nowMs);
    let result = { pmLocked: false, unlocked: false };

    await db.runTransaction(async (tx) => {
      const userRef = db.doc(`users/${pathUniqueId}`);
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        result = { __notFound: true };
        return;
      }
      const data = snap.data();
      const currentlyLocked = data.pmLocked === true;
      const last = typeof data.lastPmLockCheck === 'number' ? data.lastPmLockCheck : null;
      const lastDay = last !== null ? utcDayStart(last) : null;

      // Already-unlocked user: no-op. Don't bump throttle (no need —
      // next read won't change outcome unless the user gets re-locked
      // by an admin, in which case the lock side sets the stamp).
      if (!currentlyLocked) {
        result = { pmLocked: false, unlocked: false };
        return;
      }

      // Already checked today: idempotent skip.
      if (lastDay === todayStart) {
        result = { pmLocked: true, unlocked: false, alreadyCheckedToday: true };
        return;
      }

      // First check of the day for a locked user. Decide.
      const eligible = isAtLeast18FromDob(data.dateOfBirth, nowMs);
      if (eligible) {
        tx.update(userRef, { pmLocked: false, lastPmLockCheck: nowMs });
        result = { pmLocked: false, unlocked: true };
      } else {
        // Still <18, just bump throttle so we don't re-scan today
        tx.update(userRef, { lastPmLockCheck: nowMs });
        result = { pmLocked: true, unlocked: false };
      }
    });

    if (result.__notFound) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(result);
  } catch (err) {
    // Include err.code + err.stack so Sentry/dashboards can triage by
    // failure class — Firestore SDK errors carry codes like ABORTED
    // (transaction-retry exhaustion), FAILED_PRECONDITION,
    // UNAUTHENTICATED. Without them every failure looks identical.
    log.error('pm-lock-check', 'failed', {
      uid: req.auth?.uniqueId,
      error: err?.message,
      code: err?.code,
      stack: err?.stack,
    });
    return res.status(500).json({ error: 'pm-lock-check failed', errorId: 'PM_LOCK_CHECK' });
  }
});

module.exports = router;
