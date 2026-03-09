/**
 * Cron: Full orphaned storage cleanup.
 *
 * Collects all referenced R2 keys from users, conversations, reports, banners.
 * Lists R2 objects per folder, deletes orphans.
 */

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');
const log = require('../utils/log');

const CDN_PREFIX = 'https://images.shytalk.shyden.co.uk/';

function extractKey(url) {
  if (!url || !url.startsWith(CDN_PREFIX)) return null;
  return url.slice(CDN_PREFIX.length);
}

async function orphanedStorage() {
  const referencedKeys = new Set();
  referencedKeys.add('system/shytalk_icon.webp');

  // Users -> profilePhotoUrl, coverPhotoUrl, preSuspension*
  const usersSnap = await db.collection('users').limit(2000).get();
  for (const doc of usersSnap.docs) {
    const u = doc.data();
    for (const url of [
      u.profilePhotoUrl || u.profile_photo_url,
      u.coverPhotoUrl || u.cover_photo_url,
      u.preSuspensionProfilePhotoUrl || u.pre_suspension_profile_photo_url,
      u.preSuspensionCoverPhotoUrl || u.pre_suspension_cover_photo_url,
    ]) {
      const k = extractKey(url);
      if (k) referencedKeys.add(k);
    }
  }

  // Conversations -> groupPhotoUrl
  const convsSnap = await db.collection('conversations').limit(2000).get();
  for (const doc of convsSnap.docs) {
    const c = doc.data();
    const k = extractKey(c.groupPhotoUrl || c.group_photo_url);
    if (k) referencedKeys.add(k);
  }

  // Conversation messages -> imageUrls (array), stickerUrl
  // Cap at 30 conversations
  const convsToScan = convsSnap.docs.slice(0, 30);
  for (const convDoc of convsToScan) {
    const convId = convDoc.id;

    const imageMessagesSnap = await db.collection(`conversations/${convId}/messages`)
      .where('type', '==', 'IMAGE')
      .limit(200)
      .get();
    for (const msgDoc of imageMessagesSnap.docs) {
      const msg = msgDoc.data();
      const urls = msg.imageUrls || msg.image_urls || [];
      const urlArray = Array.isArray(urls) ? urls : [];
      for (const url of urlArray) {
        const k = extractKey(url);
        if (k) referencedKeys.add(k);
      }
    }

    const stickerMessagesSnap = await db.collection(`conversations/${convId}/messages`)
      .where('type', '==', 'STICKER')
      .limit(200)
      .get();
    for (const msgDoc of stickerMessagesSnap.docs) {
      const msg = msgDoc.data();
      const k = extractKey(msg.stickerUrl || msg.sticker_url);
      if (k) referencedKeys.add(k);
    }
  }

  // Reports + archive -> evidenceUrls (array)
  for (const collection of ['reports', 'reportsArchive']) {
    const snap = await db.collection(collection).limit(1000).get();
    for (const doc of snap.docs) {
      const row = doc.data();
      const urls = row.evidenceUrls || row.evidence_urls || [];
      const urlArray = Array.isArray(urls) ? urls : [];
      for (const url of urlArray) {
        const k = extractKey(url);
        if (k) referencedKeys.add(k);
      }
    }
  }

  // Banners -> imageUrl
  const bannersSnap = await db.collection('banners').limit(500).get();
  for (const doc of bannersSnap.docs) {
    const b = doc.data();
    const k = extractKey(b.imageUrl || b.image_url);
    if (k) referencedKeys.add(k);
  }

  // List and delete orphaned R2 objects
  // Must match ALLOWED_UPLOAD_PATHS in storage.js
  const folders = [
    'profiles/', 'covers/', 'messages/', 'groups/',
    'evidence/', 'stickers/', 'banners/',
  ];
  let totalDeleted = 0;

  for (const folder of folders) {
    const allKeys = await r2.listObjects(folder);
    const toDelete = allKeys.filter(k => !referencedKeys.has(k));

    if (toDelete.length > 0) {
      await r2.deleteObjects(toDelete);
    }

    const folderName = folder.replace('/', '');
    log.info('cron', 'orphanedStorage: folder cleanup', { folder: folderName, deleted: toDelete.length, total: allKeys.length });
    totalDeleted += toDelete.length;
  }

  log.info('cron', 'orphanedStorage: cleanup complete', { totalDeleted });
}

module.exports = orphanedStorage;
