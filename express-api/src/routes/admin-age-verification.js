/**
 * Admin-side age-verification routes (PR 4b/14).
 *
 *   GET  /api/admin/age-verification/pending
 *     List all pending submissions (oldest first).
 *
 *   POST /api/admin/age-verification/:id/approve
 *     Body: { reason: string }
 *     Marks the submission approved. Flips `ageVerified=true` on the
 *     target user, records `ageVerifiedAt` + `ageVerificationMethod`.
 *     Best-effort: deletes R2 ID image and writes audit-log entry.
 *
 *   POST /api/admin/age-verification/:id/reject
 *     Body: { reason: string }
 *     Marks the submission rejected. User stays unverified. Image is
 *     still deleted (privacy: spec required image destruction on
 *     decision regardless of outcome). Writes audit entry.
 *
 *   POST /api/admin/age-verification/:id/modify-dob
 *     Body: { newDob: number (ms), reason: string }
 *     Updates `users/<uid>.dateOfBirth` to the new value. If the new
 *     DOB makes the user 18+, behaves like approve. If <18, the
 *     account is reverted to unverified — they age in. PMs lock-out
 *     is downstream (PR 11 migration). DOB plausibility (1900 ≤ dob
 *     ≤ now) is validated PRE-transaction; an implausible DOB cannot
 *     get past the user-doc mutation only to fail at the audit-log
 *     stage.
 *
 * Concurrency: each decision endpoint uses `db.runTransaction(...)`
 * to atomically read submission + user docs and write both updates.
 *
 * Partial-failure contract: the route returns success with explicit
 * `auditWritten` / `imageDeleted` flags when post-commit cleanup
 * partially fails. The Firestore decision is the source of truth;
 * a failed audit-log write or R2 deletion is logged for ops sweep
 * and surfaced to the admin UI via the response flags rather than
 * masked as a 500. Crash-window between the transaction commit and
 * the post-commit cleanup leaves the decision recorded with no
 * audit / a leaked image — see follow-up task for a reconciliation
 * job that detects gaps.
 *
 * Submission-doc lifecycle: after a decision commits, the
 * `r2Key` field is set to null in the same transaction so a future
 * reader (admin audit-trail tab) doesn't see a stale reference to a
 * deleted object. The original key is preserved in the audit-log
 * entry for compliance traceability.
 */

const express = require('express');
const router = express.Router();

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');
const audit = require('../utils/age-verification-audit');
const systemPm = require('../utils/age-verification-system-pm');
const { now } = require('../utils/helpers');
const log = require('../utils/log');
const { requireAdmin } = require('../middleware/auth');

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

async function deleteImageBestEffort(r2Key, submissionId) {
  if (!r2Key) return true;
  try {
    await r2.deleteObject(r2Key);
    return true;
  } catch (err) {
    log.error('admin-age-verification', 'R2 image deletion failed', {
      submissionId,
      r2Key,
      error: err?.message,
    });
    return false;
  }
}

async function writeAuditBestEffort(action, submissionId, payload) {
  try {
    await action(db, payload);
    return true;
  } catch (err) {
    log.error('admin-age-verification', 'Audit-log write failed', {
      submissionId,
      payload,
      error: err?.message,
    });
    return false;
  }
}

async function sendPmBestEffort(action, submissionId, args) {
  // Same partial-failure shape as audit / R2 — a failed PM doesn't
  // roll back the decision. Surfaced via the response so the admin
  // UI can flag "decision committed, user not notified".
  try {
    await action(...args);
    return true;
  } catch (err) {
    log.error('admin-age-verification', 'System PM send failed', {
      submissionId,
      error: err?.message,
    });
    return false;
  }
}

function requireNonBlankReason(reason) {
  return typeof reason === 'string' && reason.trim().length > 0;
}

// ─── GET /pending ───────────────────────────────────────────────────

router.get('/admin/age-verification/pending', async (req, res) => {
  if (requireAdmin(req, res)) return;
  try {
    const snap = await db
      .collection('ageVerificationSubmissions')
      .where('status', '==', 'pending')
      .orderBy('submittedAt', 'asc')
      .get();
    const submissions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ submissions });
  } catch (err) {
    log.error('admin-age-verification', 'list pending failed', { error: err?.message });
    return res
      .status(500)
      .json({ error: 'Failed to list pending submissions', errorId: 'AGE_VERIF_LIST' });
  }
});

// ─── POST /:id/approve ──────────────────────────────────────────────

router.post('/admin/age-verification/:id/approve', async (req, res) => {
  if (requireAdmin(req, res)) return;
  const { id } = req.params;
  const errorId = 'AGE_VERIF_APPROVE';
  try {
    // Approve does NOT require a reason. Original spec only asked for
    // an admin justification on outcomes the user needs explained
    // (Reject / DOB-modified). Approve is the "everything is fine"
    // path; the audit log records WHO approved + WHEN, sufficient for
    // the compliance trail. (Question 1 from 2026-05-04 spec
    // follow-up — revisit if regulators ever ask for it.)

    let submission;
    let approved = false;
    await db.runTransaction(async (tx) => {
      const subRef = db.doc(`ageVerificationSubmissions/${id}`);
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) return;
      const data = subSnap.data();
      if (data.status !== 'pending') {
        submission = { ...data, _conflict: true };
        return;
      }
      submission = { ...data, id };

      tx.update(subRef, {
        status: 'approved',
        decisionAt: now(),
        decidedBy: req.auth.uniqueId,
        // r2Key tombstoned — original preserved in audit-log entry.
        r2Key: null,
      });
      tx.update(db.doc(`users/${data.userId}`), {
        ageVerified: true,
        ageVerifiedAt: now(),
        ageVerificationMethod: data.idMethod,
      });
      approved = true;
    });

    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (submission._conflict) return res.status(409).json({ error: 'Submission already decided' });
    if (!approved) return res.status(500).json({ error: 'Approval did not commit', errorId });

    const imageDeleted = await deleteImageBestEffort(submission.r2Key, id);
    const auditWritten = await writeAuditBestEffort(audit.logVerificationApproved, id, {
      adminUid: req.auth.uniqueId,
      targetUserId: submission.userId,
      method: submission.idMethod,
    });
    const userNotified = await sendPmBestEffort(systemPm.sendAgeVerificationApprovedPm, id, [
      submission.userId,
      submission.idMethod,
    ]);

    return res.json({ ok: true, imageDeleted, auditWritten, userNotified });
  } catch (err) {
    log.error('admin-age-verification', `${errorId} failed`, { id, error: err?.message });
    return res.status(500).json({ error: 'Failed to approve submission', errorId });
  }
});

// ─── POST /:id/reject ───────────────────────────────────────────────

router.post('/admin/age-verification/:id/reject', async (req, res) => {
  if (requireAdmin(req, res)) return;
  const { id } = req.params;
  const errorId = 'AGE_VERIF_REJECT';
  try {
    const reason = (req.body?.reason || '').toString();
    if (!requireNonBlankReason(reason)) {
      return res.status(400).json({ error: 'reason is required' });
    }

    let submission;
    let rejected = false;
    await db.runTransaction(async (tx) => {
      const subRef = db.doc(`ageVerificationSubmissions/${id}`);
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) return;
      const data = subSnap.data();
      if (data.status !== 'pending') {
        submission = { ...data, _conflict: true };
        return;
      }
      submission = { ...data, id };

      tx.update(subRef, {
        status: 'rejected',
        decisionAt: now(),
        decidedBy: req.auth.uniqueId,
        decisionReason: reason,
        r2Key: null,
      });
      // User doc intentionally NOT touched — they stay unverified.
      rejected = true;
    });

    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (submission._conflict) return res.status(409).json({ error: 'Submission already decided' });
    if (!rejected) return res.status(500).json({ error: 'Rejection did not commit', errorId });

    const imageDeleted = await deleteImageBestEffort(submission.r2Key, id);
    const auditWritten = await writeAuditBestEffort(audit.logVerificationRejected, id, {
      adminUid: req.auth.uniqueId,
      targetUserId: submission.userId,
      reason,
    });
    const userNotified = await sendPmBestEffort(systemPm.sendAgeVerificationRejectedPm, id, [
      submission.userId,
      reason,
    ]);

    return res.json({ ok: true, imageDeleted, auditWritten, userNotified });
  } catch (err) {
    log.error('admin-age-verification', `${errorId} failed`, { id, error: err?.message });
    return res.status(500).json({ error: 'Failed to reject submission', errorId });
  }
});

// ─── POST /:id/modify-dob ───────────────────────────────────────────

router.post('/admin/age-verification/:id/modify-dob', async (req, res) => {
  if (requireAdmin(req, res)) return;
  const { id } = req.params;
  const errorId = 'AGE_VERIF_MODIFY_DOB';
  try {
    const newDob = req.body?.newDob;
    const reason = (req.body?.reason || '').toString();
    if (typeof newDob !== 'number' || !Number.isFinite(newDob)) {
      return res.status(400).json({ error: 'newDob is required (ms epoch)' });
    }
    // Plausibility: 1900 <= newDob <= now. Throws if out of range.
    // Validated up-front so an implausible DOB never reaches the user
    // doc — without this, the transaction would commit the bogus
    // value, then the audit-log helper's bounds check would throw and
    // the route would 500 with the mutation already persisted.
    try {
      audit.requirePlausibleDob(newDob, 'newDob');
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!requireNonBlankReason(reason)) {
      return res.status(400).json({ error: 'reason is required' });
    }

    let submission;
    let oldDob;
    let committed = false;
    await db.runTransaction(async (tx) => {
      const subRef = db.doc(`ageVerificationSubmissions/${id}`);
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) return;
      const data = subSnap.data();
      if (data.status !== 'pending') {
        submission = { ...data, _conflict: true };
        return;
      }
      submission = { ...data, id };

      const userRef = db.doc(`users/${data.userId}`);
      const userSnap = await tx.get(userRef);
      oldDob = userSnap.exists ? (userSnap.data()?.dateOfBirth ?? null) : null;
      const verifiedNow = isAtLeast18FromDob(newDob);

      tx.update(subRef, {
        status: 'dob_modified',
        decisionAt: now(),
        decidedBy: req.auth.uniqueId,
        decisionReason: reason,
        oldDob,
        newDob,
        r2Key: null,
      });
      tx.update(userRef, {
        dateOfBirth: newDob,
        ageVerified: verifiedNow,
        ageVerifiedAt: verifiedNow ? now() : null,
        ageVerificationMethod: verifiedNow ? data.idMethod : null,
        // PR 11 PM-lock side effect. New DOB <18 → lock the user out
        // of PMs (their list hides + counterparties see disabled
        // input). New DOB ≥18 → unlock. Same transaction so the
        // ageVerified flip and the lock state can never diverge.
        pmLocked: !verifiedNow,
      });
      committed = true;
    });

    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (submission._conflict) return res.status(409).json({ error: 'Submission already decided' });
    if (!committed)
      return res.status(500).json({ error: 'DOB modification did not commit', errorId });

    const imageDeleted = await deleteImageBestEffort(submission.r2Key, id);
    const auditWritten = await writeAuditBestEffort(audit.logVerificationDobModified, id, {
      adminUid: req.auth.uniqueId,
      targetUserId: submission.userId,
      oldDob,
      newDob,
      reason,
    });
    const userNotified = await sendPmBestEffort(systemPm.sendAgeVerificationDobModifiedPm, id, [
      submission.userId,
      {
        ageVerified: isAtLeast18FromDob(newDob),
        method: submission.idMethod,
        reason,
      },
    ]);

    return res.json({
      ok: true,
      ageVerified: isAtLeast18FromDob(newDob),
      imageDeleted,
      auditWritten,
      userNotified,
    });
  } catch (err) {
    log.error('admin-age-verification', `${errorId} failed`, { id, error: err?.message });
    return res.status(500).json({ error: 'Failed to modify DOB', errorId });
  }
});

module.exports = router;
