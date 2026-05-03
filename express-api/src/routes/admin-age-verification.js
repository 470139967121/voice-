/**
 * Admin-side age-verification routes (PR 4b/14).
 *
 *   GET  /api/admin/age-verification/pending
 *     List all pending submissions (oldest first).
 *
 *   POST /api/admin/age-verification/:id/approve
 *     Marks the submission approved. Flips `ageVerified=true` on the
 *     target user, records `ageVerifiedAt` + `ageVerificationMethod`.
 *     Deletes the R2 ID image. Writes an audit-log entry.
 *
 *   POST /api/admin/age-verification/:id/reject
 *     Body: { reason: string }
 *     Marks the submission rejected. User stays unverified. Image is
 *     still deleted (privacy: user spec required image destruction on
 *     decision regardless of outcome). Writes audit entry.
 *
 *   POST /api/admin/age-verification/:id/modify-dob
 *     Body: { newDob: number (ms), reason: string }
 *     Admin found the ID's DOB doesn't match what's on file. Updates
 *     `users/<uid>.dateOfBirth` to the new value. If the new DOB
 *     makes the user 18+, behaves like approve. If <18, the account
 *     is reverted to unverified (ageVerified=false, ageVerifiedAt=null,
 *     method=null) — they age in. Existing PMs locked out is a
 *     follow-on side-effect handled by PR 11 migration logic.
 *
 * Concurrency: each decision endpoint uses `db.runTransaction(...)`
 * to atomically read submission + user docs and write both updates.
 * R2 deletion + audit log run AFTER the transaction commits — the
 * Firestore write is the source of truth for compliance, and a failed
 * post-commit cleanup logs but doesn't roll back the decision.
 *
 * Image deletion is documented as best-effort: if R2 errors out we
 * log the failure with the leaked key + submission id for ops to
 * sweep, rather than rolling back the user-facing decision.
 */

const express = require('express');
const router = express.Router();

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');
const audit = require('../utils/age-verification-audit');
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
  try {
    await r2.deleteObject(r2Key);
  } catch (err) {
    // Do NOT fail the request — the Firestore decision already
    // committed and the user is now (un)verified. A leaked image is a
    // hygiene issue, not a correctness one. Logged so ops can sweep.
    log.error('admin-age-verification', 'R2 image deletion failed', {
      submissionId,
      r2Key,
      error: err?.message,
    });
  }
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
    let submission;
    let approved = false;
    await db.runTransaction(async (tx) => {
      const subRef = db.doc(`ageVerificationSubmissions/${id}`);
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) {
        return; // 404 path — handled below
      }
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

    // Best-effort post-commit cleanup. The Firestore decision is the
    // source of truth; an R2 deletion or audit-log failure is logged
    // but doesn't roll back.
    await deleteImageBestEffort(submission.r2Key, id);
    await audit.logVerificationApproved(db, {
      adminUid: req.auth.uniqueId,
      targetUserId: submission.userId,
      method: submission.idMethod,
    });

    return res.json({ ok: true });
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
    if (!reason.trim()) {
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
      });
      // User doc intentionally NOT touched — they stay unverified.
      rejected = true;
    });

    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (submission._conflict) return res.status(409).json({ error: 'Submission already decided' });
    if (!rejected) return res.status(500).json({ error: 'Rejection did not commit', errorId });

    await deleteImageBestEffort(submission.r2Key, id);
    await audit.logVerificationRejected(db, {
      adminUid: req.auth.uniqueId,
      targetUserId: submission.userId,
      reason,
    });

    return res.json({ ok: true });
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
    if (!reason.trim()) {
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
        // Capture the modification on the submission doc too so the
        // admin audit trail is self-contained even if the auditLog
        // collection is later compacted.
        oldDob,
        newDob,
      });
      tx.update(userRef, {
        dateOfBirth: newDob,
        ageVerified: verifiedNow,
        ageVerifiedAt: verifiedNow ? now() : null,
        ageVerificationMethod: verifiedNow ? data.idMethod : null,
      });
      committed = true;
    });

    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (submission._conflict) return res.status(409).json({ error: 'Submission already decided' });
    if (!committed)
      return res.status(500).json({ error: 'DOB modification did not commit', errorId });

    await deleteImageBestEffort(submission.r2Key, id);
    await audit.logVerificationDobModified(db, {
      adminUid: req.auth.uniqueId,
      targetUserId: submission.userId,
      oldDob,
      newDob,
      reason,
    });

    return res.json({ ok: true, ageVerified: isAtLeast18FromDob(newDob) });
  } catch (err) {
    log.error('admin-age-verification', `${errorId} failed`, { id, error: err?.message });
    return res.status(500).json({ error: 'Failed to modify DOB', errorId });
  }
});

module.exports = router;
