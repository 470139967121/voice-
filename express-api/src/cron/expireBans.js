/**
 * Cron job: expire bans whose expiresAt has passed.
 *
 * Queries deviceBans and networkBans for docs with a non-null expiresAt
 * that is in the past, deletes them, and optionally notifies admin via FCM.
 */

const { db } = require('../utils/firebase');

async function expireBans() {
  const nowIso = new Date().toISOString();
  let removed = 0;

  // Query expired device bans
  const deviceSnap = await db.collection('deviceBans')
    .where('expiresAt', '!=', null)
    .get();

  const expiredDeviceDocs = deviceSnap.docs.filter(d => {
    const expiresAt = d.data().expiresAt;
    return expiresAt && expiresAt < nowIso;
  });

  // Query expired network bans
  const networkSnap = await db.collection('networkBans')
    .where('expiresAt', '!=', null)
    .get();

  const expiredNetworkDocs = networkSnap.docs.filter(d => {
    const expiresAt = d.data().expiresAt;
    return expiresAt && expiresAt < nowIso;
  });

  const allExpired = [...expiredDeviceDocs, ...expiredNetworkDocs];

  if (allExpired.length === 0) {
    console.log('[CRON] expireBans: no expired bans');
    return;
  }

  // Delete all expired bans
  await Promise.all(allExpired.map(d => d.ref.delete()));
  removed = allExpired.length;

  console.log(`[CRON] expireBans: removed ${removed} expired bans`);

  // Try to send FCM notification to admin users
  try {
    const { messaging } = require('../utils/firebase');
    if (!messaging) return;

    const configSnap = await db.doc('alertConfig/settings').get();
    if (!configSnap.exists) return;

    const config = configSnap.data();
    const recipientUserIds = config.fcmRecipientUserIds || [];
    if (recipientUserIds.length === 0) return;

    // Look up FCM tokens for recipient users
    for (const userId of recipientUserIds) {
      const userSnap = await db.doc(`users/${userId}`).get();
      if (!userSnap.exists) continue;
      const userData = userSnap.data();
      const fcmToken = userData.fcmToken;
      if (!fcmToken) continue;

      await messaging.send({
        notification: {
          title: 'Bans Expired',
          body: `${removed} ban(s) have expired and been removed.`,
        },
        token: fcmToken,
      }).catch(err => console.error('[CRON] expireBans FCM error:', err.message));
    }
  } catch (err) {
    console.error('[CRON] expireBans notification error:', err.message);
  }
}

module.exports = expireBans;
