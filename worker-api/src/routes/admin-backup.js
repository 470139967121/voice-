/**
 * Admin backup routes — R2-based user profile backups.
 *
 * GET  /api/admin/backups              → List available backups
 * POST /api/admin/backups/trigger      → Trigger immediate backup
 * GET  /api/admin/backups/:date        → Download a backup by date (YYYY-MM-DD)
 * POST /api/admin/backups/restore/:date → Restore all users from a backup
 * POST /api/admin/backups/recover-photos → Scan R2 and restore missing photo URLs
 */

const { json, jsonError } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { queryCollection, updateDoc, getDoc } = require('../utils/firestore');

function registerAdminBackupRoutes(router) {
  // ── List available backups ──
  router.get('/api/admin/backups', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const listed = await env.R2_BUCKET.list({ prefix: 'backups/users/' });
    const backups = listed.objects.map(obj => ({
      key: obj.key,
      date: obj.key.replace('backups/users/', '').replace('.json', ''),
      size: obj.size,
      uploaded: obj.uploaded?.toISOString() ?? null,
      userCount: obj.customMetadata?.userCount ?? null,
    }));

    // Sort newest first
    backups.sort((a, b) => b.date.localeCompare(a.date));
    return json({ backups });
  });

  // ── Trigger immediate backup ──
  router.post('/api/admin/backups/trigger', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const users = await queryCollection(env, 'users', { limit: 5000 });
    if (users.length === 0) return json({ message: 'No users found', userCount: 0 });

    const today = new Date().toISOString().slice(0, 10);
    const key = `backups/users/${today}.json`;
    const payload = JSON.stringify(users, null, 2);

    await env.R2_BUCKET.put(key, payload, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { userCount: String(users.length), createdAt: new Date().toISOString() },
    });

    return json({ message: `Backed up ${users.length} users`, key, bytes: payload.length });
  });

  // ── Download a specific backup ──
  router.get('/api/admin/backups/:date', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const key = `backups/users/${params.date}.json`;
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) return jsonError(`No backup found for ${params.date}`, 404);

    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });

  // ── Restore users from a backup ──
  router.post('/api/admin/backups/restore/:date', async (request, env, params) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const body = await request.json().catch(() => ({}));
    const mode = body.mode || 'missing'; // 'missing' = only fill missing fields, 'full' = overwrite

    const key = `backups/users/${params.date}.json`;
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) return jsonError(`No backup found for ${params.date}`, 404);

    const backupUsers = JSON.parse(await obj.text());
    let restoredCount = 0;

    for (const backupUser of backupUsers) {
      const uid = backupUser.id;
      if (!uid) continue;

      if (mode === 'full') {
        // Full restore — overwrite all fields from backup
        const { id, ...data } = backupUser;
        await updateDoc(env, `users/${uid}`, data);
        restoredCount++;
      } else {
        // Missing-only restore — only fill in fields that are currently null/missing
        const current = await getDoc(env, `users/${uid}`);
        if (!current) continue;

        const { id: _id, ...backupData } = backupUser;
        const fieldsToRestore = {};
        for (const [field, value] of Object.entries(backupData)) {
          if (value != null && (current[field] === null || current[field] === undefined)) {
            fieldsToRestore[field] = value;
          }
        }

        if (Object.keys(fieldsToRestore).length > 0) {
          await updateDoc(env, `users/${uid}`, fieldsToRestore);
          restoredCount++;
        }
      }
    }

    return json({
      message: `Restored ${restoredCount}/${backupUsers.length} users (mode: ${mode})`,
      mode,
      date: params.date,
      restoredCount,
      totalInBackup: backupUsers.length,
    });
  });
  // ── Recover profile/cover photos from R2 ──
  router.post('/api/admin/backups/recover-photos', async (request, env) => {
    const adminCheck = requireAdmin(request);
    if (adminCheck) return adminCheck;

    const CDN_URL = env.CDN_URL || 'https://images.shytalk.shyden.co.uk';
    let recovered = 0;

    // Scan R2 for profile photos and cover photos
    for (const folder of ['profile_photos/', 'cover_photos/']) {
      const field = folder === 'profile_photos/' ? 'profilePhotoUrl' : 'coverPhotoUrl';
      const userPhotos = {}; // uid → latest key

      let cursor;
      do {
        const listed = await env.R2_BUCKET.list({ prefix: folder, cursor, limit: 1000 });
        for (const obj of listed.objects) {
          // Keys are like: profile_photos/{uid}/{filename}
          const parts = obj.key.split('/');
          if (parts.length >= 3) {
            const uid = parts[1];
            // Keep the most recently uploaded photo per user
            if (!userPhotos[uid] || obj.uploaded > userPhotos[uid].uploaded) {
              userPhotos[uid] = { key: obj.key, uploaded: obj.uploaded };
            }
          }
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);

      // For each user with an R2 photo, check if their Firestore doc is missing the URL
      for (const [uid, photo] of Object.entries(userPhotos)) {
        const user = await getDoc(env, `users/${uid}`);
        if (!user) continue;

        const currentUrl = user[field];
        if (!currentUrl) {
          const photoUrl = `${CDN_URL}/${photo.key}`;
          await updateDoc(env, `users/${uid}`, { [field]: photoUrl });
          recovered++;
        }
      }
    }

    return json({ message: `Recovered ${recovered} photo URLs from R2`, recovered });
  });
}

module.exports = { registerAdminBackupRoutes };
