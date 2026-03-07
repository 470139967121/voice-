const cron = require('node-cron');

const archiveReports = require('./archiveReports');
const subscriptions = require('./subscriptions');
const staleRooms = require('./staleRooms');
const backpackCleanup = require('./backpackCleanup');
const backups = require('./backups');
const closedRooms = require('./closedRooms');
const orphanedStorage = require('./orphanedStorage');
const rotateLogs = require('./rotateLogs');

function startCronJobs() {
  // Archive old reports — Sunday 03:00 UTC
  cron.schedule('0 3 * * 0', () => {
    console.log('[CRON] archiveReports');
    archiveReports().catch(err => console.error('[CRON] archiveReports error:', err));
  });

  // Check expired subscriptions + clean expired backpack items — daily midnight UTC
  cron.schedule('0 0 * * *', () => {
    console.log('[CRON] subscriptions + backpackCleanup');
    subscriptions().catch(err => console.error('[CRON] subscriptions error:', err));
    backpackCleanup().catch(err => console.error('[CRON] backpackCleanup error:', err));
  });

  // Close stale OWNER_AWAY rooms — every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    staleRooms().catch(err => console.error('[CRON] staleRooms error:', err));
  });

  // Backup user profiles + cleanup old closed rooms — daily 02:00 UTC
  cron.schedule('0 2 * * *', () => {
    console.log('[CRON] backups + closedRooms');
    backups().catch(err => console.error('[CRON] backups error:', err));
    closedRooms().catch(err => console.error('[CRON] closedRooms error:', err));
  });

  // Cleanup orphaned storage — daily 04:00 UTC
  cron.schedule('0 4 * * *', () => {
    console.log('[CRON] orphanedStorage');
    orphanedStorage().catch(err => console.error('[CRON] orphanedStorage error:', err));
  });

  // Rotate logs from Firestore to R2 — every hour
  cron.schedule('0 * * * *', () => {
    console.log('[CRON] rotateLogs');
    rotateLogs().catch(err => console.error('[CRON] rotateLogs error:', err));
  });

  console.log('Cron jobs scheduled');
}

module.exports = { startCronJobs };
