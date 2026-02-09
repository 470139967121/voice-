package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp

enum class MessageType {
    TEXT,
    SYSTEM
}

data class Message(
    val messageId: String = "",
    val senderId: String = "",
    val senderName: String = "",
    val text: String = "",
    val createdAt: Timestamp = Timestamp.now(),
    val type: MessageType = MessageType.TEXT
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "messageId" to messageId,
        "senderId" to senderId,
        "senderName" to senderName,
        "text" to text,
        "createdAt" to createdAt,
        "type" to type.name
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, messageId: String): Message = Message(
            messageId = messageId,
            senderId = map["senderId"] as? String ?: "",
            senderName = map["senderName"] as? String ?: "",
            text = map["text"] as? String ?: "",
            createdAt = map["createdAt"] as? Timestamp ?: Timestamp.now(),
            type = (map["type"] as? String)?.let {
                try { MessageType.valueOf(it) } catch (_: Exception) { MessageType.TEXT }
            } ?: MessageType.TEXT
        )
    }
}
