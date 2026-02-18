package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.flow.Flow

interface PrivateMessageRepository {
    fun getConversations(userId: String): Flow<List<Conversation>>
    suspend fun getOrCreateConversation(uid1: String, uid2: String): Resource<Conversation>
    suspend fun getConversationSettings(conversationId: String, userId: String): Resource<ConversationSettings>
    fun observeConversationSettings(conversationId: String, userId: String): Flow<ConversationSettings>
    fun getMessages(conversationId: String, limit: Int): Flow<List<PrivateMessage>>
    suspend fun loadOlderMessages(conversationId: String, beforeTimestamp: Long, limit: Int): Resource<List<PrivateMessage>>
    suspend fun sendTextMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        text: String,
        replyToMessageId: String? = null,
        replyToText: String? = null,
        replyToSenderName: String? = null
    ): Resource<Unit>
    suspend fun sendImageMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        imageUrls: List<String>,
        replyToMessageId: String? = null,
        replyToText: String? = null,
        replyToSenderName: String? = null
    ): Resource<Unit>
    suspend fun editMessage(conversationId: String, messageId: String, newText: String): Resource<Unit>
    suspend fun getEditHistory(conversationId: String, messageId: String): Resource<List<MessageEdit>>
    suspend fun markAsRead(conversationId: String, userId: String, messageId: String): Resource<Unit>
    suspend fun muteConversation(conversationId: String, userId: String, muted: Boolean): Resource<Unit>
    suspend fun silentConversation(conversationId: String, userId: String, silent: Boolean): Resource<Unit>
    suspend fun pinConversation(conversationId: String, userId: String, pinned: Boolean): Resource<Unit>
    suspend fun hideConversation(conversationId: String, userId: String): Resource<Unit>
    suspend fun toggleReaction(conversationId: String, messageId: String, emoji: String, userId: String): Resource<Unit>
    suspend fun searchMessages(conversationId: String, query: String): Resource<List<PrivateMessage>>
    suspend fun createGroupConversation(
        creatorId: String,
        participantIds: List<String>,
        groupName: String
    ): Resource<Conversation>
    suspend fun addGroupParticipant(conversationId: String, userId: String): Resource<Unit>
    suspend fun removeGroupParticipant(conversationId: String, userId: String): Resource<Unit>
    suspend fun updateGroupName(conversationId: String, newName: String): Resource<Unit>
}
