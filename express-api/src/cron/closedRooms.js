/**
 * Cron: Delete closed rooms older than 7 days.
 *
 * Queries rooms with state=='CLOSED', filters by closedAt < 7 days ago (cap 20),
 * deletes room doc + subcollections (messages, seatRequests).
 */

const { db } = require('../utils/firebase');

async function closedRooms() {
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  const snapshot = await db.collection('rooms')
    .where('state', '==', 'CLOSED')
    .limit(200)
    .get();

  if (snapshot.empty) return;

  // Only delete rooms closed more than 7 days ago — cap at 20 per run
  const old = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => r.closedAt && r.closedAt < sevenDaysAgo)
    .slice(0, 20);

  if (old.length === 0) return;

  for (const room of old) {
    // Fetch subcollections
    const [messagesSnap, seatRequestsSnap] = await Promise.all([
      db.collection(`rooms/${room.id}/messages`).limit(500).get(),
      db.collection(`rooms/${room.id}/seatRequests`).limit(100).get(),
    ]);

    // Collect all refs to delete
    const refs = [
      ...messagesSnap.docs.map(d => db.doc(`rooms/${room.id}/messages/${d.id}`)),
      ...seatRequestsSnap.docs.map(d => db.doc(`rooms/${room.id}/seatRequests/${d.id}`)),
      db.doc(`rooms/${room.id}`),
    ];

    // Batch delete in chunks of 500
    for (let i = 0; i < refs.length; i += 500) {
      const batch = db.batch();
      const chunk = refs.slice(i, i + 500);
      for (const ref of chunk) {
        batch.delete(ref);
      }
      await batch.commit();
    }
  }

  console.log(`Cleaned up ${old.length} closed rooms (older than 7 days)`);
}

module.exports = closedRooms;
