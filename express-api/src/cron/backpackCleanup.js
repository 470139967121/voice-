/**
 * Cron: Delete expired backpack items.
 *
 * Queries all users, for each user checks backpack items with expiresAt <= now,
 * and deletes expired items.
 */

const { db } = require('../utils/firebase');

async function backpackCleanup() {
  const timestamp = Date.now();
  let totalCleaned = 0;

  // Query all users, then check each user's backpack for expired items
  const usersSnapshot = await db.collection('users').limit(1000).get();

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    const backpackSnapshot = await db.collection(`users/${uid}/backpack`).get();

    if (backpackSnapshot.empty) continue;

    const expired = backpackSnapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(item => item.expiresAt && item.expiresAt <= timestamp);

    if (expired.length === 0) continue;

    // Batch delete expired items
    for (let i = 0; i < expired.length; i += 500) {
      const batch = db.batch();
      const chunk = expired.slice(i, i + 500);
      for (const item of chunk) {
        batch.delete(db.doc(`users/${uid}/backpack/${item.giftId || item.id}`));
      }
      await batch.commit();
    }

    totalCleaned += expired.length;
  }

  console.log(`Cleaned ${totalCleaned} expired backpack items`);
}

module.exports = backpackCleanup;
