#!/usr/bin/env node
/**
 * One-shot migration: lock PMs for all sub-18 users in the user
 * collection. Part of PR 11 of the age-verification feature.
 *
 * Background: ShyTalk's old min-signup-age was 13. PR 1 (#436) bumped
 * it to 16 for new accounts, but legacy 13-15 accounts still exist.
 * The age-verification spec gates 18+ features behind the verification
 * flow; for sub-18 users (whether 13-15 legacy or 16-17 new) PMs are
 * inaccessible — their list hides + counterparties see disabled input.
 *
 * This script flips `pmLocked = true` for every user whose
 * `dateOfBirth` indicates they are currently below 18. Idempotent:
 * already-locked users are skipped, 18+ users are skipped, users with
 * null DOB are skipped (those are blocked at sign-in via
 * AGE_VERIF_NO_DOB_E001 if also ageVerified, or routed to the
 * RequiredDOBScreen if not — the migration doesn't need to touch
 * them).
 *
 * Usage:
 *   node scripts/migrate-pm-lock.js --dry-run    # print, don't write
 *   node scripts/migrate-pm-lock.js --apply      # write
 *
 * Fail-safety:
 *   - --apply requires the env var MIGRATION_CONFIRM=yes to actually
 *     touch Firestore. Prevents accidental run.
 *   - Pre-flight: writes a JSON snapshot of every doc that WOULD be
 *     touched to `migration-snapshots/pm-lock-<timestamp>.json` so a
 *     bad run can be reverted.
 *   - Batches writes in chunks of 400 (Firestore's per-batch ceiling
 *     is 500, leaving headroom for rule-side validation overhead).
 *   - Each batch logged with start/end uid range so a partial failure
 *     can be resumed.
 *
 * Counter-party concern: this script does NOT touch conversations or
 * other-user-side state. Counterparties see the lock at READ time via
 * the user-doc field; no fan-out write needed.
 */

const fs = require('fs');
const path = require('path');

// Load Firebase Admin SDK from the project's existing util.
const { db } = require('../src/utils/firebase');
const log = require('../src/utils/log');

const BATCH_SIZE = 400;

function isCurrentlyUnder18(dateOfBirthMs) {
  if (typeof dateOfBirthMs !== 'number' || !Number.isFinite(dateOfBirthMs)) return false;
  // Calendar-aware: matches `isAtLeast18FromDob` in the route handler
  // and `calculateAge` in shared/. Don't approximate with 365.25 ms
  // multiplication — leap years drift the boundary by hours.
  const today = new Date();
  const dob = new Date(dateOfBirthMs);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  if (
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())
  ) {
    age -= 1;
  }
  return age < 18;
}

async function scanCandidates() {
  // Pull every user. The collection isn't huge (a few-thousand at most
  // on dev / a few hundred on prod given current scale). If it ever
  // grows past ~50k users we should switch to a where-filtered query
  // on `dateOfBirth` ranges, but that requires a Firestore index — for
  // the one-time migration the simple full-scan is fine.
  const snap = await db.collection('users').get();
  const candidates = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const dob = typeof data.dateOfBirth === 'number' ? data.dateOfBirth : null;
    if (dob === null) continue; // null DOB is handled by other paths
    if (data.pmLocked === true) continue; // already locked, idempotent
    if (!isCurrentlyUnder18(dob)) continue; // 18+ users not affected
    candidates.push({ id: doc.id, dob, snapshot: data });
  }
  return candidates;
}

async function writeSnapshot(candidates) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(__dirname, '../migration-snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pm-lock-${ts}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        migration: 'pm-lock',
        ranAt: ts,
        candidateCount: candidates.length,
        // Snapshot only the fields we're about to touch + the doc id.
        // Full-doc snapshots leak unrelated data into git-ignored
        // backup files, which is fine for ops but unnecessary.
        candidates: candidates.map((c) => ({
          id: c.id,
          dateOfBirth: c.dob,
          previousPmLocked: c.snapshot.pmLocked === true,
          previousLastPmLockCheck: c.snapshot.lastPmLockCheck ?? null,
        })),
      },
      null,
      2,
    ),
  );
  return file;
}

async function applyBatched(candidates) {
  const stamp = Date.now();
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const slice = candidates.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE);
    const batch = db.batch();
    for (const c of slice) {
      batch.update(db.doc(`users/${c.id}`), {
        pmLocked: true,
        lastPmLockCheck: stamp,
      });
    }
    // Per-batch try/catch so a partial failure logs the exact UID
    // range that died. Without this the outer .catch() at main()
    // surfaces only the error message — operators have no way to
    // resume the migration from the failed batch boundary. The
    // re-throw preserves the existing fail-fast semantics; we just
    // add context first.
    try {
      await batch.commit();
      log.info('migrate-pm-lock', 'Batch committed', {
        batchIndex,
        from: i,
        to: i + slice.length,
        total: candidates.length,
        firstUid: slice[0]?.id,
        lastUid: slice[slice.length - 1]?.id,
      });
    } catch (err) {
      log.error('migrate-pm-lock', 'Batch FAILED', {
        batchIndex,
        from: i,
        to: i + slice.length,
        total: candidates.length,
        firstUid: slice[0]?.id,
        lastUid: slice[slice.length - 1]?.id,
        error: err?.message,
        code: err?.code,
      });
      throw err;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');

  if (!dryRun && !apply) {
    log.error('migrate-pm-lock', 'Specify --dry-run or --apply');
    process.exit(2);
  }

  if (apply && process.env.MIGRATION_CONFIRM !== 'yes') {
    log.error(
      'migrate-pm-lock',
      'Refusing to run --apply without MIGRATION_CONFIRM=yes env var. Pre-flight: run --dry-run first, review the snapshot, then re-run with both flags.',
    );
    process.exit(3);
  }

  log.info('migrate-pm-lock', dryRun ? 'Starting dry-run scan' : 'Starting --apply pass');
  const candidates = await scanCandidates();
  log.info('migrate-pm-lock', `Scan complete: ${candidates.length} sub-18 users to lock`);

  const snapshotFile = await writeSnapshot(candidates);
  log.info('migrate-pm-lock', `Snapshot written: ${snapshotFile}`);

  if (dryRun) {
    log.info('migrate-pm-lock', 'Dry-run complete — no writes performed');
    return;
  }

  await applyBatched(candidates);
  log.info('migrate-pm-lock', 'Migration complete');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      log.error('migrate-pm-lock', 'Migration failed', { error: err.message, stack: err.stack });
      process.exit(1);
    });
}

module.exports = { isCurrentlyUnder18, scanCandidates };
