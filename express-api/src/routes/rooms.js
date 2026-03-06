/**
 * Room routes — invite sending and seat request creation (FCM push required).
 *
 * POST /api/rooms/:roomId/invites/send  -> Send invite (FCM push to invitee)
 * POST /api/rooms/:roomId/seat-requests -> Create seat request (FCM push to room owner)
 */

const router = require('express').Router();
const { db, rtdb, messaging, FieldValue } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');

// --- Helpers ---

/** Broadcast a room event via RTDB. */
async function broadcastToRoom(roomId, data) {
  try {
    await rtdb.ref(`rooms/${roomId}/events/lastEvent`).set({
      type: data.type,
      ts: Date.now(),
      ...(data.userId ? { userId: data.userId } : {}),
    });
  } catch (err) {
    console.error(`Failed to write RTDB event for room ${roomId}:`, err);
  }
}

/**
 * Send a data-only FCM message to multiple tokens via Firebase Admin SDK.
 * Returns a list of invalid tokens that should be cleaned up.
 */
async function sendFcmToTokens(tokens, data) {
  if (!tokens || tokens.length === 0) return [];

  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  const result = await messaging.sendEachForMulticast({
    tokens,
    data: stringData,
  });

  const invalidTokens = [];
  result.responses.forEach((resp, i) => {
    if (resp.error) {
      const code = resp.error.code;
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        invalidTokens.push(tokens[i]);
      }
    }
  });

  return invalidTokens;
}

/**
 * Remove invalid FCM tokens from a user's doc.
 */
async function cleanupInvalidTokens(invalidTokens, userId) {
  if (!invalidTokens || invalidTokens.length === 0 || !userId) return;
  try {
    await db.doc(`users/${userId}`).update({
      fcmTokens: FieldValue.arrayRemove(...invalidTokens),
    });
    console.log(`Cleaned ${invalidTokens.length} invalid tokens for user ${userId}`);
  } catch (err) {
    console.error(`Failed to clean invalid tokens for user ${userId}:`, err);
  }
}

// --- Route registration ---

// -- Send invite --
router.post('/api/rooms/:roomId/invites/send', async (req, res) => {
  try {
    const body = req.body;
    if (!body?.userId || !body?.invitedBy) {
      return res.status(400).json({ error: 'userId and invitedBy required' });
    }
    const roomId = req.params.roomId;
    const inviteeId = body.userId;

    const roomSnap = await db.doc(`rooms/${roomId}`).get();
    if (!roomSnap.exists) return res.status(404).json({ error: 'Room not found' });
    const room = roomSnap.data();

    // Update pendingInvites on the room doc (matches Android client field name)
    const pendingInvites = room.pendingInvites || {};
    pendingInvites[inviteeId] = {
      invitedBy: body.invitedBy,
      invitedAt: now(),
    };

    await db.doc(`rooms/${roomId}`).update({ pendingInvites });

    // Send FCM push to invitee
    try {
      const inviteeSnap = await db.doc(`users/${inviteeId}`).get();
      const inviteeDoc = inviteeSnap.exists ? inviteeSnap.data() : null;
      const tokens = inviteeDoc?.fcmTokens || [];
      if (tokens.length > 0) {
        const roomName = room.name || 'a room';
        // Look up inviter's display name
        const inviterSnap = await db.doc(`users/${body.invitedBy}`).get();
        const inviterName = inviterSnap.exists ? (inviterSnap.data().displayName || 'Someone') : 'Someone';

        const invalidTokens = await sendFcmToTokens(tokens, {
          type: 'ROOM_INVITE',
          roomId,
          roomName,
          invitedBy: body.invitedBy,
          inviterName,
        });

        if (invalidTokens.length > 0) {
          await cleanupInvalidTokens(invalidTokens, inviteeId);
        }
      }
    } catch (err) {
      console.error('Failed to send room invite FCM:', err);
    }

    await broadcastToRoom(roomId, { type: 'room_updated' });
    return res.json({ success: true });
  } catch (err) {
    console.error('Error sending room invite:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Create seat request --
router.post('/api/rooms/:roomId/seat-requests', async (req, res) => {
  try {
    const uid = req.auth.uid;
    const body = req.body;
    const { userName, seatIndex } = body || {};
    if (seatIndex == null) return res.status(400).json({ error: 'seatIndex required' });
    const roomId = req.params.roomId;

    // Check for existing pending request
    const existingSnap = await db.collection(`rooms/${roomId}/seatRequests`)
      .where('userId', '==', uid)
      .where('status', '==', 'PENDING')
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      const reqId = existingDoc.id;
      await db.doc(`rooms/${roomId}/seatRequests/${reqId}`).update({
        seatIndex,
        createdAt: now(),
      });
      await broadcastToRoom(roomId, { type: 'seat_request_updated' });
      return res.json({ requestId: reqId });
    }

    const reqId = generateId();
    const timestamp = now();

    await db.doc(`rooms/${roomId}/seatRequests/${reqId}`).set({
      requestId: reqId,
      userId: uid,
      userName: userName || '',
      seatIndex,
      status: 'PENDING',
      resolvedBy: null,
      createdAt: timestamp,
      resolvedAt: null,
    });

    // Send FCM push to room owner
    try {
      const roomSnap = await db.doc(`rooms/${roomId}`).get();
      const room = roomSnap.exists ? roomSnap.data() : null;
      if (room?.ownerId) {
        const ownerSnap = await db.doc(`users/${room.ownerId}`).get();
        const ownerDoc = ownerSnap.exists ? ownerSnap.data() : null;
        const tokens = ownerDoc?.fcmTokens || [];
        if (tokens.length > 0) {
          const invalidTokens = await sendFcmToTokens(tokens, {
            type: 'SEAT_REQUEST',
            roomId,
            roomName: room.name || 'a room',
            requesterId: uid,
            requesterName: userName || '',
            seatIndex: String(seatIndex),
          });

          if (invalidTokens.length > 0) {
            await cleanupInvalidTokens(invalidTokens, room.ownerId);
          }
        }
      }
    } catch (err) {
      console.error('Failed to send seat request FCM:', err);
    }

    await broadcastToRoom(roomId, { type: 'seat_request_updated' });
    return res.json({ requestId: reqId });
  } catch (err) {
    console.error('Error creating seat request:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
