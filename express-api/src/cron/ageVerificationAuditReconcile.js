/**
 * Cron job: back-fill missing age-verification audit-log entries.
 *
 * The admin decision flow (`admin-age-verification.js`) commits the
 * decision transaction first, then writes the audit-log entry as a
 * post-commit best-effort step. If the audit write fails (Firestore
 * outage, rules misconfig, network drop), the decision is committed
 * but no audit-log row exists — a compliance gap (OSA / GDPR
 * traceability).
 *
 * The route handler returns the failure to the admin via the
 * `auditWritten=false` response flag, but if the admin doesn't notice
 * (or if the failure happens AFTER the response is already sent), the
 * gap silently persists.
 *
 * This job runs daily, scans submissions whose decision committed in
 * the last 7 days, and writes a remediation audit entry for any that
 * still have no matching `auditLog` row. The 7-day window is wide
 * enough to absorb a multi-day Firestore outage but narrow enough that
 * Firestore reads stay cheap.
 *
 * Idempotency: the matching key is the submission ID itself — every
 * remediation entry stores `details.fromSubmissionId` and the query
 * checks for that field before writing. A second run after a
 * successful first-run write is a no-op.
 */

const { db } = require('../utils/firebase');
const { now } = require('../utils/helpers');
const log = require('../utils/log');

const MS_PER_DAY = 86_400_000;
const SCAN_WINDOW_MS = 7 * MS_PER_DAY;

// Maps the submission-doc `status` field (written by the route
// handlers) to the corresponding `action` string used by the audit
// log. The handlers actually write `dob_modified` for the modify-DOB
// path; the other entries are defensive in case the wire format
// changes without an audit-side update.
const STATUS_ACTION_MAP = Object.freeze({
  approved: 'age_verification_approved',
  rejected: 'age_verification_rejected',
  dob_modified: 'age_verification_dob_modified',
  'modify-dob': 'age_verification_dob_modified',
  modifyDob: 'age_verification_dob_modified',
});

// Coerce a stored timestamp value to epoch ms. Submission writers in
// `admin-age-verification.js` use plain `now()` (number), but a future
// migration or backfill could land Firestore `Timestamp` objects or
// the `{seconds, nanoseconds}` plain-object shape. Returning `null`
// for unknown shapes lets callers explicitly choose how to handle the
// gap (skip vs back-fill anyway) instead of silently treating it as
// "no match" and writing a duplicate remediation row.
function toMillis(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v.toMillis === 'function') {
    const ms = v.toMillis();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  }
  if (v && typeof v.seconds === 'number') {
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1_000_000);
  }
  return null;
}

/**
 * Find an existing audit-log row that this submission's decision
 * should have written. Two match paths:
 *   1. Already-reconciled rows tag themselves with `fromSubmissionId`.
 *      That's the cheap idempotency check — `where` query.
 *   2. Original-write rows (from the route handler) have no
 *      `fromSubmissionId` but match on `actionType + targetId +
 *      timestamp ≈ decisionAt`. We accept ±10 min skew to absorb
 *      clock drift between the route's `now()` and Firestore's
 *      server-side timestamp.
 */
async function hasExistingAudit(submission, action) {
  // Path 1: idempotency — already-reconciled tagged rows.
  const tagged = await db
    .collection('auditLog')
    .where('details.fromSubmissionId', '==', submission.id)
    .limit(1)
    .get();
  if (!tagged.empty) return true;

  // Path 2: original write match. We can't index on `timestamp ≈ X`
  // server-side without a composite index, so query on actionType +
  // targetId and filter the timestamp client-side. Bounded by `limit`
  // because age-verification decisions per user are rare (≤2-3 in
  // realistic scenarios).
  const decisionAt = toMillis(submission.decisionAt);
  if (decisionAt === null) return false;

  const candidates = await db
    .collection('auditLog')
    .where('actionType', '==', action)
    .where('targetId', '==', String(submission.userId))
    .limit(20)
    .get();

  const window = 10 * 60_000; // ±10 min
  for (const doc of candidates.docs) {
    const ts = toMillis(doc.data().timestamp);
    if (ts !== null && Math.abs(ts - decisionAt) < window) {
      return true;
    }
  }
  return false;
}

/**
 * Build the remediation audit row for a submission missing its
 * original entry. Mirrors what the route handler would have written,
 * minus the admin's free-text reason (we don't have it on the
 * submission doc — original reason is in the route's request body
 * which is no longer accessible). Reason is replaced with a
 * remediation marker.
 */
function buildRemediationEntry(submission, action) {
  const details = {
    fromSubmissionId: submission.id,
    reconciledAt: now(),
    originalDecisionAt: toMillis(submission.decisionAt),
    note: 'Reconciled by ageVerificationAuditReconcile cron — original audit write failed at decision time.',
  };
  if (action === 'age_verification_approved') {
    details.method = submission.idMethod || 'unknown';
  }
  if (action === 'age_verification_dob_modified') {
    // Modify-DOB submissions don't store the new/old DOB on the
    // submission doc — the user-doc has the new value but oldDob is
    // lost once the transaction commits. Best-effort: omit and rely
    // on the note + originalDecisionAt for traceability. Operators
    // can cross-reference user-doc history if a real audit gap is
    // discovered, but this remediation entry won't reconstruct the
    // old DOB.
    details.note += ' DOB delta not captured — see user-doc history.';
  }
  return {
    adminUid: typeof submission.decidedBy === 'number' ? submission.decidedBy : 0,
    action,
    actionType: action,
    targetType: 'user',
    targetId: String(submission.userId),
    details,
    timestamp: now(),
  };
}

async function ageVerificationAuditReconcile() {
  const cutoff = now() - SCAN_WINDOW_MS;
  const snap = await db
    .collection('ageVerificationSubmissions')
    .where('decisionAt', '>=', cutoff)
    .get();

  let scanned = 0;
  let reconciled = 0;
  let skippedPending = 0;
  let skippedAlreadyAudited = 0;
  let skippedUnknownStatus = 0;
  let failed = 0;

  // Per-doc isolation: a transient Firestore read failure or a
  // single malformed submission must not abort the whole back-fill.
  // This is a compliance remediation path — failing to remediate
  // doc N+1 because doc N threw means another 23 hours of OSA/GDPR
  // gap. Track failures in a counter so they surface in the summary
  // and the catastrophic-failure alert in `cron/index.js` can still
  // distinguish "everything broke" from "one row had bad data".
  for (const doc of snap.docs) {
    scanned++;
    try {
      const data = doc.data();

      if (data.status === 'pending' || toMillis(data.decisionAt) === null) {
        // Pending docs shouldn't reach this query (filtered by
        // decisionAt) but defend anyway — a doc could be partially-
        // committed if the route crashed mid-transaction.
        skippedPending++;
        continue;
      }

      const action = STATUS_ACTION_MAP[data.status];
      if (!action) {
        skippedUnknownStatus++;
        log.warn('ageVerificationAuditReconcile', 'Unknown submission status', {
          submissionId: doc.id,
          status: data.status,
        });
        continue;
      }

      const submission = { id: doc.id, ...data };
      const exists = await hasExistingAudit(submission, action);
      if (exists) {
        skippedAlreadyAudited++;
        continue;
      }

      const entry = buildRemediationEntry(submission, action);
      await db.collection('auditLog').add(entry);
      reconciled++;
      log.warn('ageVerificationAuditReconcile', 'Back-filled missing audit entry', {
        submissionId: doc.id,
        targetUserId: submission.userId,
        action,
        originalDecisionAt: toMillis(submission.decisionAt),
      });
    } catch (err) {
      failed++;
      log.error(
        'ageVerificationAuditReconcile',
        'Per-doc remediation failed — continuing to next submission',
        {
          submissionId: doc.id,
          error: err && err.message ? err.message : String(err),
        },
      );
    }
  }

  log.info('ageVerificationAuditReconcile', 'Scan complete', {
    scanned,
    reconciled,
    skippedPending,
    skippedAlreadyAudited,
    skippedUnknownStatus,
    failed,
  });

  return {
    scanned,
    reconciled,
    skippedPending,
    skippedAlreadyAudited,
    skippedUnknownStatus,
    failed,
  };
}

module.exports = ageVerificationAuditReconcile;
// Exported for unit-test access — tests stub `db` + `now` and assert
// internal behaviour without exercising the wrapped cron.schedule
// call.
module.exports.STATUS_ACTION_MAP = STATUS_ACTION_MAP;
module.exports.SCAN_WINDOW_MS = SCAN_WINDOW_MS;
module.exports.hasExistingAudit = hasExistingAudit;
module.exports.buildRemediationEntry = buildRemediationEntry;
module.exports.toMillis = toMillis;
