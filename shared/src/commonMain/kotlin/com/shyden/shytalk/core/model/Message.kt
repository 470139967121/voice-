package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.millisToTimestamp
import com.shyden.shytalk.core.util.timestampToMillis

enum class MessageType {
    TEXT,
    SYSTEM,
    JOIN
}

data class Message(
    val messageId: String = "",
    val senderId: String = "",
    val senderName: String = "",
    val text: String = "",
    val createdAt: Long = currentTimeMillis(),
    val type: MessageType = MessageType.TEXT
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "messageId" to messageId,
        "senderId" to senderId,
        "senderName" to senderName,
        "text" to text,
        "createdAt" to millisToTimestamp(createdAt),
        "type" to type.name
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, messageId: String): Message = Message(
            messageId = messageId,
            senderId = map["senderId"] as? String ?: "",
            senderName = map["senderName"] as? String ?: "",
            text = map["text"] as? String ?: "",
            createdAt = timestampToMillis(map["createdAt"]),
            type = (map["type"] as? String)?.let {
                try { MessageType.valueOf(it) } catch (_: Exception) { MessageType.TEXT }
            } ?: MessageType.TEXT
        )
    }
}
