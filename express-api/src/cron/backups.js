/**
 * Cron: Backup user profiles to R2.
 *
 * Queries all users, writes JSON to `backups/users/YYYY-MM-DD.json` in R2.
 * Prunes backups older than 7 days.
 */

const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');

async function backups() {
  const usersSnapshot = await db.collection('users').limit(5000).get();

  if (usersSnapshot.empty) {
    console.log('Backup: no users to back up');
    return;
  }

  const users = usersSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `backups/users/${today}.json`;
  const jsonStr = JSON.stringify(users, null, 2);

  await r2.putObject(key, Buffer.from(jsonStr), 'application/json', {
    userCount: String(users.length),
    createdAt: new Date().toISOString(),
  });

  console.log(`Backup: saved ${users.length} users to ${key} (${jsonStr.length} bytes)`);

  // Prune backups older than 7 days
  const allKeys = await r2.listObjects('backups/users/');
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  for (const objKey of allKeys) {
    // Parse date from key: backups/users/YYYY-MM-DD.json
    const dateStr = objKey.replace('backups/users/', '').replace('.json', '');
    const backupDate = new Date(dateStr + 'T00:00:00Z');
    if (!isNaN(backupDate.getTime()) && backupDate.getTime() < sevenDaysAgo) {
      await r2.deleteObject(objKey);
      console.log(`Backup: pruned old backup ${objKey}`);
    }
  }
}

module.exports = backups;
