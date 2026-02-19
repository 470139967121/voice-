package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationPreview
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.MuteInfo
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.PrivateMessageType
import com.shyden.shytalk.core.model.SystemMessageConfig
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.millisToTimestamp
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.tasks.await
import java.util.UUID

class PrivateMessageRepositoryImpl(
    private val firestore: FirebaseFirestore
) : PrivateMessageRepository {

    private fun conversationsCollection() =
        firestore.collection("conversations")

    private fun messagesCollection(conversationId: String) =
        conversationsCollection().document(conversationId).collection("messages")

    private fun settingsCollection(conversationId: String) =
        conversationsCollection().document(conversationId).collection("settings")

    private fun editsCollection(conversationId: String, messageId: String) =
        messagesCollection(conversationId).document(messageId).collection("edits")

    override fun getConversations(userId: String): Flow<List<Conversation>> = callbackFlow {
        val listener = conversationsCollection()
            .whereArrayContains("participantIds", userId)
            .orderBy("lastMessageAt", Query.Direction.DESCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val conversations = snapshot?.documents?.mapNotNull { doc ->
                    doc.data?.let { Conversation.fromMap(it, doc.id) }
                } ?: emptyList()
                trySend(conversations)
            }
        awaitClose { listener.remove() }
    }.distinctUntilChanged()

    override suspend fun getOrCreateConversation(uid1: String, uid2: String): Resource<Conversation> =
        firebaseCall("Failed to get or create conversation") {
            val conversationId = Conversation.generateId(uid1, uid2)
            val docRef = conversationsCollection().document(conversationId)
            val doc = docRef.get().await()
            if (doc.exists()) {
                Conversation.fromMap(doc.data!!, doc.id)
            } else {
                val now = currentTimeMillis()
                val conversation = Conversation(
                    conversationId = conversationId,
                    participantIds = listOf(uid1, uid2).sorted(),
                    lastMessage = null,
                    lastMessageAt = now,
                    createdAt = now
                )
                docRef.set(conversation.toMap()).await()
                // Create default settings for both users
                val defaultSettings1 = ConversationSettings(userId = uid1)
                val defaultSettings2 = ConversationSettings(userId = uid2)
                settingsCollection(conversationId).document(uid1).set(defaultSettings1.toMap()).await()
                settingsCollection(conversationId).document(uid2).set(defaultSettings2.toMap()).await()
                conversation
            }
        }

    override suspend fun getConversationSettings(
        conversationId: String,
        userId: String
    ): Resource<ConversationSettings> = firebaseCall("Failed to get conversation settings") {
        val doc = settingsCollection(conversationId).document(userId).get().await()
        if (doc.exists()) {
            ConversationSettings.fromMap(doc.data!!, userId)
        } else {
            ConversationSettings(userId = userId)
        }
    }

    override fun observeConversationSettings(
        conversationId: String,
        userId: String
    ): Flow<ConversationSettings> = callbackFlow {
        val listener = settingsCollection(conversationId).document(userId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val settings = if (snapshot?.exists() == true) {
                    ConversationSettings.fromMap(snapshot.data!!, userId)
                } else {
                    ConversationSettings(userId = userId)
                }
                trySend(settings)
            }
        awaitClose { listener.remove() }
    }.distinctUntilChanged()

    override fun getMessages(conversationId: String, limit: Int): Flow<List<PrivateMessage>> = callbackFlow {
        val listener = messagesCollection(conversationId)
            .orderBy("createdAt", Query.Direction.ASCENDING)
            .limitToLast(limit.toLong())
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val messages = snapshot?.documents?.mapNotNull { doc ->
                    doc.data?.let { PrivateMessage.fromMap(it, doc.id) }
                } ?: emptyList()
                trySend(messages)
            }
        awaitClose { listener.remove() }
    }.distinctUntilChanged()

    override suspend fun loadOlderMessages(
        conversationId: String,
        beforeTimestamp: Long,
        limit: Int
    ): Resource<List<PrivateMessage>> = firebaseCall("Failed to load older messages") {
        val snapshot = messagesCollection(conversationId)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .whereLessThan("createdAt", millisToTimestamp(beforeTimestamp))
            .limit(limit.toLong())
            .get()
            .await()
        snapshot.documents.mapNotNull { doc ->
            doc.data?.let { PrivateMessage.fromMap(it, doc.id) }
        }.reversed()
    }

    override suspend fun sendTextMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        text: String,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?
    ): Resource<Unit> = firebaseCall("Failed to send message") {
        val messageId = UUID.randomUUID().toString()
        val now = currentTimeMillis()
        val message = PrivateMessage(
            messageId = messageId,
            senderId = senderId,
            senderName = senderName,
            text = text,
            type = PrivateMessageType.TEXT,
            createdAt = now,
            replyToMessageId = replyToMessageId,
            replyToText = replyToText,
            replyToSenderName = replyToSenderName
        )
        val preview = ConversationPreview(
            text = text,
            senderId = senderId,
            senderName = senderName,
            createdAt = now,
            type = "TEXT"
        )
        val batch = firestore.batch()
        batch.set(messagesCollection(conversationId).document(messageId), message.toMap())
        batch.update(
            conversationsCollection().document(conversationId),
            mapOf(
                "lastMessage" to preview.toMap(),
                "lastMessageAt" to millisToTimestamp(now)
            )
        )
        batch.commit().await()
    }

    override suspend fun sendImageMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        imageUrls: List<String>,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?
    ): Resource<Unit> = firebaseCall("Failed to send image message") {
        val messageId = UUID.randomUUID().toString()
        val now = currentTimeMillis()
        val message = PrivateMessage(
            messageId = messageId,
            senderId = senderId,
            senderName = senderName,
            text = "",
            imageUrls = imageUrls,
            type = PrivateMessageType.IMAGE,
            createdAt = now,
            replyToMessageId = replyToMessageId,
            replyToText = replyToText,
            replyToSenderName = replyToSenderName
        )
        val preview = ConversationPreview(
            text = "[Image]",
            senderId = senderId,
            senderName = senderName,
            createdAt = now,
            type = "IMAGE"
        )
        val batch = firestore.batch()
        batch.set(messagesCollection(conversationId).document(messageId), message.toMap())
        batch.update(
            conversationsCollection().document(conversationId),
            mapOf(
                "lastMessage" to preview.toMap(),
                "lastMessageAt" to millisToTimestamp(now)
            )
        )
        batch.commit().await()
    }

    override suspend fun editMessage(
        conversationId: String,
        messageId: String,
        newText: String
    ): Resource<Unit> = firebaseCall("Failed to edit message") {
        firestore.runTransaction { transaction ->
            val messageRef = messagesCollection(conversationId).document(messageId)
            val snapshot = transaction.get(messageRef)
            val oldText = snapshot.getString("text") ?: ""
            val editCount = (snapshot.getLong("editCount") ?: 0) + 1

            // Save old text to edits subcollection
            val editId = UUID.randomUUID().toString()
            val editRef = editsCollection(conversationId, messageId).document(editId)
            transaction.set(editRef, mapOf(
                "previousText" to oldText,
                "editedAt" to millisToTimestamp(currentTimeMillis())
            ))

            // Update message
            transaction.update(messageRef, mapOf(
                "text" to newText,
                "editedAt" to millisToTimestamp(currentTimeMillis()),
                "editCount" to editCount
            ))
        }.await()
    }

    override suspend fun getEditHistory(
        conversationId: String,
        messageId: String
    ): Resource<List<MessageEdit>> = firebaseCall("Failed to get edit history") {
        val snapshot = editsCollection(conversationId, messageId)
            .orderBy("editedAt", Query.Direction.DESCENDING)
            .get()
            .await()
        snapshot.documents.mapNotNull { doc ->
            doc.data?.let { MessageEdit.fromMap(it, doc.id) }
        }
    }

    override suspend fun markAsRead(
        conversationId: String,
        userId: String,
        messageId: String
    ): Resource<Unit> = firebaseCall("Failed to mark as read") {
        val batch = firestore.batch()
        // Update the message's readBy field
        batch.update(
            messagesCollection(conversationId).document(messageId),
            "readBy", FieldValue.arrayUnion(userId)
        )
        // Update user's settings
        batch.update(
            settingsCollection(conversationId).document(userId),
            mapOf(
                "lastReadMessageId" to messageId,
                "lastReadAt" to millisToTimestamp(currentTimeMillis()),
                "unreadCount" to 0
            )
        )
        batch.commit().await()
    }

    override suspend fun muteConversation(
        conversationId: String,
        userId: String,
        muted: Boolean
    ): Resource<Unit> = firebaseCall("Failed to mute conversation") {
        settingsCollection(conversationId).document(userId)
            .update("isMuted", muted)
            .await()
    }

    override suspend fun pinConversation(
        conversationId: String,
        userId: String,
        pinned: Boolean
    ): Resource<Unit> = firebaseCall("Failed to pin conversation") {
        settingsCollection(conversationId).document(userId)
            .update("isPinned", pinned)
            .await()
    }

    override suspend fun hideConversation(
        conversationId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to hide conversation") {
        settingsCollection(conversationId).document(userId)
            .update(mapOf(
                "isHidden" to true,
                "hiddenAt" to millisToTimestamp(currentTimeMillis())
            ))
            .await()
    }

    override suspend fun toggleReaction(
        conversationId: String,
        messageId: String,
        emoji: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to toggle reaction") {
        val messageRef = messagesCollection(conversationId).document(messageId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(messageRef)
            @Suppress("UNCHECKED_CAST")
            val reactions = (snapshot.get("reactions") as? Map<String, List<String>>) ?: emptyMap()
            val users = reactions[emoji] ?: emptyList()
            val updatedUsers = if (userId in users) users - userId else users + userId
            val updatedReactions = if (updatedUsers.isEmpty()) {
                reactions - emoji
            } else {
                reactions + (emoji to updatedUsers)
            }
            transaction.update(messageRef, "reactions", updatedReactions)
        }.await()
    }

    override suspend fun searchMessages(
        conversationId: String,
        query: String
    ): Resource<List<PrivateMessage>> = firebaseCall("Failed to search messages") {
        // Firestore doesn't support full-text search, so we load recent messages and filter client-side
        val snapshot = messagesCollection(conversationId)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(500)
            .get()
            .await()
        val lower = query.lowercase()
        snapshot.documents.mapNotNull { doc ->
            doc.data?.let { PrivateMessage.fromMap(it, doc.id) }
        }.filter { it.text.lowercase().contains(lower) }.reversed()
    }

    override suspend fun createGroupConversation(
        creatorId: String,
        participantIds: List<String>,
        groupName: String,
        groupDescription: String?,
        groupPhotoUrl: String?,
        adminIds: List<String>,
        modIds: List<String>,
        permissions: GroupPermissions,
        systemMessageConfig: SystemMessageConfig
    ): Resource<Conversation> = firebaseCall("Failed to create group conversation") {
        val allParticipants = (participantIds + creatorId).distinct().sorted()
        val conversationId = UUID.randomUUID().toString()
        val now = currentTimeMillis()
        val conversation = Conversation(
            conversationId = conversationId,
            participantIds = allParticipants,
            lastMessageAt = now,
            createdAt = now,
            isGroup = true,
            groupName = groupName,
            groupPhotoUrl = groupPhotoUrl,
            groupAdminIds = (adminIds + creatorId).distinct(),
            groupModIds = modIds,
            groupDescription = groupDescription,
            createdBy = creatorId,
            permissions = permissions,
            systemMessageConfig = systemMessageConfig
        )
        val docRef = conversationsCollection().document(conversationId)
        docRef.set(conversation.toMap()).await()
        // Create default settings for all participants
        val batch = firestore.batch()
        allParticipants.forEach { uid ->
            batch.set(
                settingsCollection(conversationId).document(uid),
                ConversationSettings(userId = uid).toMap()
            )
        }
        batch.commit().await()
        conversation
    }

    override suspend fun addGroupParticipant(
        conversationId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to add participant") {
        conversationsCollection().document(conversationId)
            .update("participantIds", FieldValue.arrayUnion(userId))
            .await()
        settingsCollection(conversationId).document(userId)
            .set(ConversationSettings(userId = userId).toMap())
            .await()
    }

    override suspend fun removeGroupParticipant(
        conversationId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to remove participant") {
        conversationsCollection().document(conversationId)
            .update("participantIds", FieldValue.arrayRemove(userId))
            .await()
    }

    override suspend fun updateGroupName(
        conversationId: String,
        newName: String
    ): Resource<Unit> = firebaseCall("Failed to update group name") {
        conversationsCollection().document(conversationId)
            .update("groupName", newName)
            .await()
    }

    override suspend fun sendStickerMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        stickerUrl: String
    ): Resource<Unit> = firebaseCall("Failed to send sticker") {
        val messageId = UUID.randomUUID().toString()
        val now = currentTimeMillis()
        val message = PrivateMessage(
            messageId = messageId,
            senderId = senderId,
            senderName = senderName,
            text = "",
            type = PrivateMessageType.STICKER,
            stickerUrl = stickerUrl,
            createdAt = now
        )
        val preview = ConversationPreview(
            text = "[Sticker]",
            senderId = senderId,
            senderName = senderName,
            createdAt = now,
            type = "STICKER"
        )
        val batch = firestore.batch()
        batch.set(messagesCollection(conversationId).document(messageId), message.toMap())
        batch.update(
            conversationsCollection().document(conversationId),
            mapOf(
                "lastMessage" to preview.toMap(),
                "lastMessageAt" to millisToTimestamp(now)
            )
        )
        batch.commit().await()
    }

    override suspend fun sendRoomInviteMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        roomId: String,
        roomName: String
    ): Resource<Unit> = firebaseCall("Failed to send room invite") {
        val messageId = UUID.randomUUID().toString()
        val now = currentTimeMillis()
        val message = PrivateMessage(
            messageId = messageId,
            senderId = senderId,
            senderName = senderName,
            text = "",
            type = PrivateMessageType.ROOM_INVITE,
            roomInviteId = roomId,
            roomInviteName = roomName,
            createdAt = now
        )
        val preview = ConversationPreview(
            text = "[Room Invite]",
            senderId = senderId,
            senderName = senderName,
            createdAt = now,
            type = "ROOM_INVITE"
        )
        val batch = firestore.batch()
        batch.set(messagesCollection(conversationId).document(messageId), message.toMap())
        batch.update(
            conversationsCollection().document(conversationId),
            mapOf(
                "lastMessage" to preview.toMap(),
                "lastMessageAt" to millisToTimestamp(now)
            )
        )
        batch.commit().await()
    }

    override suspend fun getModerationConfig(): Resource<List<String>> =
        firebaseCall("Failed to load moderation config") {
            val doc = firestore.collection("config").document("moderation").get().await()
            (doc.get("prohibitedWords") as? List<*>)?.filterIsInstance<String>() ?: emptyList()
        }

    override suspend fun getConversation(conversationId: String): Resource<Conversation> =
        firebaseCall("Failed to get conversation") {
            val doc = conversationsCollection().document(conversationId).get().await()
            if (doc.exists()) {
                Conversation.fromMap(doc.data!!, doc.id)
            } else {
                throw Exception("Conversation not found")
            }
        }

    override suspend fun closeGroupConversation(conversationId: String): Resource<Unit> =
        firebaseCall("Failed to close group conversation") {
            conversationsCollection().document(conversationId)
                .update("isClosed", true)
                .await()
        }

    override suspend fun recallMessage(
        conversationId: String,
        messageId: String
    ): Resource<Unit> = firebaseCall("Failed to recall message") {
        messagesCollection(conversationId).document(messageId)
            .update("isRecalled", true).await()
        // Update conversation preview
        conversationsCollection().document(conversationId)
            .update("lastMessage.text", "[Message recalled]").await()
    }

    // ===== Mod Actions =====

    private fun mutesCollection(conversationId: String) =
        conversationsCollection().document(conversationId).collection("mutes")

    private fun modLogCollection(conversationId: String) =
        conversationsCollection().document(conversationId).collection("mod_log")

    override suspend fun muteGroupMember(
        conversationId: String,
        userId: String,
        duration: Long?,
        reason: String?
    ): Resource<Unit> = firebaseCall("Failed to mute member") {
        val now = currentTimeMillis()
        val muteData = mapOf(
            "mutedBy" to "",
            "mutedByName" to "",
            "reason" to reason,
            "mutedAt" to now,
            "expiresAt" to duration?.let { now + it },
            "isActive" to true
        )
        mutesCollection(conversationId).document(userId).set(muteData).await()
    }

    override suspend fun unmuteGroupMember(
        conversationId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to unmute member") {
        mutesCollection(conversationId).document(userId).delete().await()
    }

    override suspend fun getGroupMutes(
        conversationId: String
    ): Resource<List<MuteInfo>> = firebaseCall("Failed to get mutes") {
        val snapshot = mutesCollection(conversationId)
            .whereEqualTo("isActive", true)
            .get()
            .await()
        snapshot.documents.mapNotNull { doc ->
            doc.data?.let {
                @Suppress("UNCHECKED_CAST")
                MuteInfo.fromMap(it as Map<String, Any?>, doc.id)
            }
        }
    }

    override suspend fun hideMessage(
        conversationId: String,
        messageId: String,
        hiddenBy: String
    ): Resource<Unit> = firebaseCall("Failed to hide message") {
        messagesCollection(conversationId).document(messageId)
            .update(
                mapOf(
                    "isHidden" to true,
                    "hiddenBy" to hiddenBy
                )
            ).await()
    }

    // ===== Role Management =====

    override suspend fun updateGroupRoles(
        conversationId: String,
        adminIds: List<String>,
        modIds: List<String>
    ): Resource<Unit> = firebaseCall("Failed to update roles") {
        conversationsCollection().document(conversationId)
            .update(
                mapOf(
                    "groupAdminIds" to adminIds,
                    "groupModIds" to modIds
                )
            ).await()
    }

    override suspend fun transferOwnership(
        conversationId: String,
        newOwnerId: String
    ): Resource<Unit> = firebaseCall("Failed to transfer ownership") {
        firestore.runTransaction { transaction ->
            val docRef = conversationsCollection().document(conversationId)
            val snapshot = transaction.get(docRef)
            val oldOwnerId = snapshot.getString("createdBy") ?: ""
            @Suppress("UNCHECKED_CAST")
            val currentAdmins = (snapshot.get("groupAdminIds") as? List<String>) ?: emptyList()

            transaction.update(docRef, mapOf(
                "createdBy" to newOwnerId,
                "groupAdminIds" to ((currentAdmins + oldOwnerId) - newOwnerId).distinct()
            ))
        }.await()
    }

    // ===== Permissions =====

    override suspend fun updateGroupPermissions(
        conversationId: String,
        permissions: GroupPermissions
    ): Resource<Unit> = firebaseCall("Failed to update permissions") {
        conversationsCollection().document(conversationId)
            .update("permissions", permissions.toMap()).await()
    }

    override suspend fun updateSystemMessageConfig(
        conversationId: String,
        config: SystemMessageConfig
    ): Resource<Unit> = firebaseCall("Failed to update system message config") {
        conversationsCollection().document(conversationId)
            .update("systemMessageConfig", config.toMap()).await()
    }

    override suspend fun updateModNotifyMode(
        conversationId: String,
        mode: String
    ): Resource<Unit> = firebaseCall("Failed to update mod notify mode") {
        conversationsCollection().document(conversationId)
            .update("modNotifyMode", mode).await()
    }

    // ===== Group Info =====

    override suspend fun updateGroupDescription(
        conversationId: String,
        description: String
    ): Resource<Unit> = firebaseCall("Failed to update description") {
        conversationsCollection().document(conversationId)
            .update("groupDescription", description).await()
    }

    override suspend fun updateGroupPhoto(
        conversationId: String,
        photoUrl: String?
    ): Resource<Unit> = firebaseCall("Failed to update group photo") {
        conversationsCollection().document(conversationId)
            .update("groupPhotoUrl", photoUrl).await()
    }

    // ===== Search =====

    override suspend fun searchUsers(
        query: String,
        currentUserId: String
    ): Resource<List<User>> = firebaseCall("Failed to search users") {
        val results = mutableListOf<User>()

        // Search by displayName prefix
        val nameSnapshot = firestore.collection("users")
            .whereGreaterThanOrEqualTo("displayName", query)
            .whereLessThanOrEqualTo("displayName", query + "\uf8ff")
            .limit(20)
            .get()
            .await()

        nameSnapshot.documents.forEach { doc ->
            doc.data?.let { data ->
                @Suppress("UNCHECKED_CAST")
                val user = User.fromMap(data as Map<String, Any?>, doc.id)
                if (user.uid != currentUserId) {
                    results.add(user)
                }
            }
        }

        // Also search by uniqueId if query is numeric
        val uniqueId = query.toLongOrNull()
        if (uniqueId != null) {
            val idSnapshot = firestore.collection("users")
                .whereEqualTo("uniqueId", uniqueId)
                .limit(5)
                .get()
                .await()

            idSnapshot.documents.forEach { doc ->
                doc.data?.let { data ->
                    @Suppress("UNCHECKED_CAST")
                    val user = User.fromMap(data as Map<String, Any?>, doc.id)
                    if (user.uid != currentUserId && results.none { it.uid == user.uid }) {
                        results.add(user)
                    }
                }
            }
        }

        results
    }

    // ===== Counting =====

    override suspend fun getOwnedGroupCount(
        userId: String
    ): Resource<Int> = firebaseCall("Failed to get owned group count") {
        val snapshot = conversationsCollection()
            .whereEqualTo("createdBy", userId)
            .whereEqualTo("isGroup", true)
            .whereEqualTo("isClosed", false)
            .get()
            .await()
        snapshot.size()
    }
}
