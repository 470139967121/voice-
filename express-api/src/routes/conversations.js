/**
 * Conversation routes - private messaging.
 *
 * GET  /api/conversations/:id/messages -> Get conversation messages
 * POST /api/conversations/:id/messages -> Send message (with FCM push + RTDB broadcast)
 */

const router = require('express').Router();
const { db, rtdb, messaging, FieldValue } = require('../utils/firebase');
const { generateId, now } = require('../utils/helpers');

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;

/**
 * Build a plain message object from a Firestore message doc.
 */
function buildMessage(doc) {
  return {
    id: doc.id,
    messageId: doc.id,
    senderId: doc.senderId || '',
    senderName: doc.senderName || '',
    text: doc.text || '',
    imageUrls: doc.imageUrls || [],
    type: doc.type || 'TEXT',
    createdAt: doc.createdAt || 0,
    editedAt: doc.editedAt || null,
    editCount: doc.editCount || 0,
    replyToMessageId: doc.replyToId || doc.replyToMessageId || null,
    replyToText: doc.replyToText || null,
    replyToSenderName: doc.replyToSenderName || null,
    stickerUrl: doc.stickerUrl || null,
    roomInviteId: doc.roomInviteId || null,
    roomInviteName: doc.roomInviteName || null,
    reactions: doc.reactions || {},
    isRecalled: !!doc.isRecalled,
    isHidden: !!doc.isHidden,
    hiddenBy: doc.hiddenBy || null,
  };
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
async function removeInvalidFcmTokensFromUser(userId, invalidTokens) {
  if (!invalidTokens || invalidTokens.length === 0) return;
  try {
    await db.doc(`users/${userId}`).update({
      fcmTokens: FieldValue.arrayRemove(...invalidTokens),
    });
    console.log(`Cleaned ${invalidTokens.length} invalid tokens for user ${userId}`);
  } catch (err) {
    console.error(`Failed to clean invalid tokens for user ${userId}:`, err);
  }
}

/**
 * Send FCM push notifications to conversation participants (except sender).
 * Checks DND schedule, muted conversations, and notification preferences.
 */
async function sendMessageNotifications(
  conversationId, senderId, senderName, previewText, type, recipients, isGroup, groupName
) {
  try {
    for (const p of recipients) {
      const recipientId = p.userId;

      // Fetch user doc for notification settings and FCM tokens
      const userSnap = await db.doc(`users/${recipientId}`).get();
      if (!userSnap.exists) continue;
      const user = userSnap.data();
      if (user.pmNotificationsEnabled === false) continue;

      // Check DND schedule
      if (user.dndEnabled) {
        const utcNow = new Date();
        const currentMinutes = utcNow.getUTCHours() * 60 + utcNow.getUTCMinutes();
        const dndStart = (user.dndStartHour || 0) * 60 + (user.dndStartMinute || 0);
        const dndEnd = (user.dndEndHour || 0) * 60 + (user.dndEndMinute || 0);

        if (dndStart <= dndEnd) {
          if (currentMinutes >= dndStart && currentMinutes < dndEnd) continue;
        } else {
          // Wraps past midnight
          if (currentMinutes >= dndStart || currentMinutes < dndEnd) continue;
        }
      }

      // Check if conversation is muted for this recipient
      const settingsSnap = await db.doc(`conversations/${conversationId}/userSettings/${recipientId}`).get();
      if (settingsSnap.exists && settingsSnap.data()?.isMuted) continue;

      // Get FCM tokens from user doc
      const tokens = user.fcmTokens || [];
      if (tokens.length === 0) continue;

      const showPreview = user.pmNotificationPreview !== false;
      const data = {
        type: 'PM',
        senderId,
        senderName: isGroup ? `${senderName} (${groupName || 'Group'})` : senderName,
        messageText: showPreview ? previewText : 'New message',
        conversationId,
        isGroup: String(isGroup),
        showPreview: String(showPreview),
      };

      const invalidTokens = await sendFcmToTokens(tokens, data);
      if (invalidTokens.length > 0) {
        await removeInvalidFcmTokensFromUser(recipientId, invalidTokens);
      }
    }
  } catch (err) {
    console.error('Failed to send message notifications:', err);
  }
}

/** Broadcast a conversation event via RTDB. */
async function broadcastToConversation(conversationId, data) {
  try {
    await rtdb.ref(`conversations/${conversationId}/events/lastEvent`).set({
      type: data.type,
      ts: Date.now(),
    });
  } catch (err) {
    console.error(`Failed to write RTDB event for conversation ${conversationId}:`, err);
  }
}

// -- Get messages --
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const limit = Math.min(
      parseInt(req.query.limit || String(DEFAULT_MESSAGE_LIMIT)),
      MAX_MESSAGE_LIMIT
    );

    const snap = await db.collection(`conversations/${req.params.id}/messages`)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Return in chronological order (oldest first)
    return res.json(messages.reverse().map(buildMessage));
  } catch (err) {
    console.error('Error fetching conversation messages:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Send message --
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const uid = req.auth.uid;
    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Invalid body' });

    const conversationId = req.params.id;
    const messageId = generateId();
    const timestamp = now();
    const type = body.type || 'TEXT';
    const senderId = body.senderId || uid;
    const senderName = body.senderName || '';
    const text = body.text || '';

    // Build preview text for lastMessage
    let previewText = text;
    if (type === 'IMAGE') previewText = '[Image]';
    else if (type === 'STICKER') previewText = '[Sticker]';
    else if (type === 'ROOM_INVITE') previewText = '[Room Invite]';

    // Read conversation to get participant list and group info
    const convSnap = await db.doc(`conversations/${conversationId}`).get();
    if (!convSnap.exists) return res.status(404).json({ error: 'Conversation not found' });
    const convDoc = convSnap.data();

    const participantIds = convDoc.participantIds || [];
    const recipientIds = participantIds.filter(pid => pid !== senderId);
    const isGroup = !!convDoc.isGroup;
    const groupName = convDoc.groupName || null;

    const msgData = {
      senderId,
      senderName,
      text,
      type,
      imageUrls: body.imageUrls || [],
      stickerUrl: body.stickerUrl || null,
      roomInviteId: body.roomInviteId || null,
      roomInviteName: body.roomInviteName || null,
      replyToId: body.replyToMessageId || null,
      replyToText: body.replyToText || null,
      replyToSenderName: body.replyToSenderName || null,
      reactions: {},
      isRecalled: false,
      isHidden: false,
      hiddenBy: null,
      editCount: 0,
      editedAt: null,
      createdAt: timestamp,
    };

    // Batch: write message + update conversation lastMessage + increment unread counts
    const lastMessage = { text: previewText, senderId, senderName, type, timestamp };
    const batch = db.batch();

    batch.set(db.doc(`conversations/${conversationId}/messages/${messageId}`), msgData);
    batch.set(db.doc(`conversations/${conversationId}`), {
      lastMessage,
      lastMessageAt: timestamp,
    }, { merge: true });

    // Increment unread counts for all recipients
    for (const pid of recipientIds) {
      batch.update(db.doc(`conversations/${conversationId}/userSettings/${pid}`), {
        unreadCount: FieldValue.increment(1),
      });
    }

    await batch.commit();

    // Un-hide conversation for all recipients (fire-and-forget)
    Promise.all(
      recipientIds.map(pid =>
        db.doc(`conversations/${conversationId}/userSettings/${pid}`).update({ isHidden: false })
      )
    ).catch(err => console.error('Failed to un-hide conversations for recipients:', err));

    // FCM notifications + RTDB broadcast (fire-and-forget)
    const recipients = recipientIds.map(id => ({ userId: id }));
    sendMessageNotifications(
      conversationId, senderId, senderName, previewText, type, recipients, isGroup, groupName
    ).catch(err => console.error('Failed to send message notifications:', err));

    broadcastToConversation(conversationId, { type: 'new_message' })
      .catch(err => console.error('Failed to broadcast conversation event:', err));

    return res.json(buildMessage({ id: messageId, ...msgData, replyToMessageId: msgData.replyToId }));
  } catch (err) {
    console.error('Error sending conversation message:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
