/**
 * Admin backup routes — R2-based user profile backups.
 *
 * GET  /api/admin/backups              → List available backups
 * POST /api/admin/backups/trigger      → Trigger immediate backup
 * GET  /api/admin/backups/:date        → Download a backup by date (YYYY-MM-DD)
 * POST /api/admin/backups/restore/:date → Restore all users from a backup
 * POST /api/admin/backups/recover-photos → Scan R2 and restore missing photo URLs
 */

const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const r2 = require('../utils/r2');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// ─── S3 client for listing with metadata (size, lastModified) ────

const accountId = process.env.R2_ACCOUNT_ID;
const bucketName = process.env.R2_BUCKET_NAME || 'shytalk-media';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// ─── Helpers ─────────────────────────────────────────────────────

async function queryDocs(ref) {
  const snap = await ref.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * List R2 objects under a prefix with full metadata (size, lastModified).
 */
async function listObjectsWithMeta(prefix) {
  const objects = [];
  let continuationToken;

  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    }));
    for (const obj of (resp.Contents || [])) {
      objects.push({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified });
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

// ── List available backups ──
router.get('/admin/backups', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const objects = await listObjectsWithMeta('backups/users/');
    const backups = objects.map(obj => ({
      key: obj.key,
      date: obj.key.replace('backups/users/', '').replace('.json', ''),
      size: obj.size,
      uploaded: obj.lastModified ? obj.lastModified.toISOString() : null,
      userCount: null, // custom metadata not available via S3 ListObjects
    }));

    // Sort newest first
    backups.sort((a, b) => b.date.localeCompare(a.date));
    res.json({ backups });
  } catch (err) {
    console.error('GET /api/admin/backups error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Trigger immediate backup ──
router.post('/admin/backups/trigger', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snap = await db.collection('users').limit(5000).get();
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (users.length === 0) return res.json({ message: 'No users found', userCount: 0 });

    const today = new Date().toISOString().slice(0, 10);
    const key = `backups/users/${today}.json`;
    const payload = JSON.stringify(users, null, 2);

    await r2.putObject(key, Buffer.from(payload), 'application/json', {
      userCount: String(users.length),
      createdAt: new Date().toISOString(),
    });

    res.json({ message: `Backed up ${users.length} users`, key, bytes: payload.length });
  } catch (err) {
    console.error('POST /api/admin/backups/trigger error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Download a specific backup ──
router.get('/admin/backups/:date', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const key = `backups/users/${req.params.date}.json`;
    let obj;
    try {
      obj = await r2.getObject(key);
    } catch (err) {
      // S3 GetObject throws NoSuchKey if the object does not exist
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: `No backup found for ${req.params.date}` });
      }
      throw err;
    }

    const stream = obj.Body;
    res.set('Content-Type', 'application/json');
    stream.pipe(res);
  } catch (err) {
    console.error('GET /api/admin/backups/:date error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Restore users from a backup ──
router.post('/admin/backups/restore/:date', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const mode = req.body.mode || 'missing'; // 'missing' = only fill missing fields, 'full' = overwrite

    const key = `backups/users/${req.params.date}.json`;
    let obj;
    try {
      obj = await r2.getObject(key);
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ error: `No backup found for ${req.params.date}` });
      }
      throw err;
    }

    // Read the stream into a string
    const chunks = [];
    for await (const chunk of obj.Body) {
      chunks.push(chunk);
    }
    const backupUsers = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    let restoredCount = 0;

    for (const backupUser of backupUsers) {
      const uid = backupUser.id;
      if (!uid) continue;

      if (mode === 'full') {
        // Full restore — overwrite all fields from backup
        const { id, ...data } = backupUser;
        await db.doc(`users/${uid}`).update(data);
        restoredCount++;
      } else {
        // Missing-only restore — only fill in fields that are currently null/missing
        const snap = await db.doc(`users/${uid}`).get();
        if (!snap.exists) continue;
        const current = snap.data();

        const { id: _id, ...backupData } = backupUser;
        const fieldsToRestore = {};
        for (const [field, value] of Object.entries(backupData)) {
          if (value != null && (current[field] === null || current[field] === undefined)) {
            fieldsToRestore[field] = value;
          }
        }

        if (Object.keys(fieldsToRestore).length > 0) {
          await db.doc(`users/${uid}`).update(fieldsToRestore);
          restoredCount++;
        }
      }
    }

    res.json({
      message: `Restored ${restoredCount}/${backupUsers.length} users (mode: ${mode})`,
      mode,
      date: req.params.date,
      restoredCount,
      totalInBackup: backupUsers.length,
    });
  } catch (err) {
    console.error('POST /api/admin/backups/restore/:date error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Recover profile/cover photos from R2 ──
router.post('/admin/backups/recover-photos', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const CDN_URL = r2.CDN_URL;
    let recovered = 0;

    // Scan R2 for profile photos and cover photos
    for (const folder of ['profile_photos/', 'cover_photos/']) {
      const field = folder === 'profile_photos/' ? 'profilePhotoUrl' : 'coverPhotoUrl';
      const userPhotos = {}; // uid → latest key

      const objects = await listObjectsWithMeta(folder);
      for (const obj of objects) {
        // Keys are like: profile_photos/{uid}/{filename}
        const parts = obj.key.split('/');
        if (parts.length >= 3) {
          const uid = parts[1];
          // Keep the most recently uploaded photo per user
          if (!userPhotos[uid] || (obj.lastModified && obj.lastModified > userPhotos[uid].lastModified)) {
            userPhotos[uid] = { key: obj.key, lastModified: obj.lastModified };
          }
        }
      }

      // For each user with an R2 photo, check if their Firestore doc is missing the URL
      for (const [uid, photo] of Object.entries(userPhotos)) {
        const snap = await db.doc(`users/${uid}`).get();
        if (!snap.exists) continue;
        const user = snap.data();

        const currentUrl = user[field];
        if (!currentUrl) {
          const photoUrl = `${CDN_URL}/${photo.key}`;
          await db.doc(`users/${uid}`).update({ [field]: photoUrl });
          recovered++;
        }
      }
    }

    res.json({ message: `Recovered ${recovered} photo URLs from R2`, recovered });
  } catch (err) {
    console.error('POST /api/admin/backups/recover-photos error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
