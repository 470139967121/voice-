package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.millisToTimestamp
import com.shyden.shytalk.core.util.timestampToMillis

enum class PrivateMessageType {
    TEXT,
    IMAGE
}

enum class SendStatus {
    SENT,
    SENDING,
    FAILED
}

data class PrivateMessage(
    val messageId: String = "",
    val senderId: String = "",
    val senderName: String = "",
    val text: String = "",
    val imageUrls: List<String> = emptyList(),
    val type: PrivateMessageType = PrivateMessageType.TEXT,
    val createdAt: Long = currentTimeMillis(),
    val editedAt: Long? = null,
    val editCount: Long = 0,
    val readBy: List<String> = emptyList(),
    val replyToMessageId: String? = null,
    val replyToText: String? = null,
    val replyToSenderName: String? = null,
    // Reactions: emoji -> list of user IDs
    val reactions: Map<String, List<String>> = emptyMap(),
    // Client-side only
    val sendStatus: SendStatus = SendStatus.SENT
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "messageId" to messageId,
        "senderId" to senderId,
        "senderName" to senderName,
        "text" to text,
        "imageUrls" to imageUrls,
        "type" to type.name,
        "createdAt" to millisToTimestamp(createdAt),
        "editedAt" to editedAt?.let { millisToTimestamp(it) },
        "editCount" to editCount,
        "readBy" to readBy,
        "replyToMessageId" to replyToMessageId,
        "replyToText" to replyToText,
        "replyToSenderName" to replyToSenderName,
        "reactions" to reactions
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, messageId: String): PrivateMessage = PrivateMessage(
            messageId = messageId,
            senderId = map["senderId"] as? String ?: "",
            senderName = map["senderName"] as? String ?: "",
            text = map["text"] as? String ?: "",
            imageUrls = (map["imageUrls"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            type = (map["type"] as? String)?.let {
                try { PrivateMessageType.valueOf(it) } catch (_: Exception) { PrivateMessageType.TEXT }
            } ?: PrivateMessageType.TEXT,
            createdAt = timestampToMillis(map["createdAt"]),
            editedAt = map["editedAt"]?.let { timestampToMillis(it) },
            editCount = (map["editCount"] as? Long) ?: 0,
            readBy = (map["readBy"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            replyToMessageId = map["replyToMessageId"] as? String,
            replyToText = map["replyToText"] as? String,
            replyToSenderName = map["replyToSenderName"] as? String,
            reactions = (map["reactions"] as? Map<*, *>)?.mapNotNull { (key, value) ->
                val emoji = key as? String ?: return@mapNotNull null
                val users = (value as? List<*>)?.filterIsInstance<String>() ?: return@mapNotNull null
                emoji to users
            }?.toMap() ?: emptyMap()
        )
    }
}
